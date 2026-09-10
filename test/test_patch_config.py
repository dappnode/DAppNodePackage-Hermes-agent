#!/usr/bin/env python3
"""Unit tests for dappnode/patch-config.py."""
import sys
import tempfile
import unittest
from pathlib import Path

import yaml

# Add repository root to path
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "dappnode"))

from importlib import import_module
patch_config_mod = import_module("patch-config")


class TestPatchConfig(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.hermes_home = Path(self.temp_dir.name)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_parse_env_line(self):
        self.assertEqual(patch_config_mod.parse_env_line("FOO=bar"), ("FOO", "bar"))
        self.assertEqual(patch_config_mod.parse_env_line("export BAZ=\"qux\""), ("BAZ", "qux"))
        self.assertEqual(patch_config_mod.parse_env_line("# Comment"), (None, None))
        self.assertEqual(patch_config_mod.parse_env_line("   "), (None, None))

    def test_patch_initial_config(self):
        config_path = self.hermes_home / "config.yaml"
        initial_config = {
            "model": {"default": "openai/gpt-4o", "provider": "openai"},
            "gateway": {"port": 8000, "bind": "localhost"},
            "platforms": {"whatsapp": {"enabled": True, "extra": {"bridge_port": 3000}}},
        }
        with open(config_path, "w") as f:
            yaml.dump(initial_config, f)

        patched = patch_config_mod.patch_config(self.hermes_home, skip_dashboard_auth=False)

        # Check gateway settings
        self.assertEqual(patched["gateway"]["port"], 3000)
        self.assertEqual(patched["gateway"]["bind"], "lan")
        self.assertTrue(patched["gateway"]["controlUi"]["dangerouslyAllowHostHeaderOriginFallback"])

        # Check whatsapp settings (no creds, so disabled and bridge_port 3010)
        self.assertFalse(patched["platforms"]["whatsapp"]["enabled"])
        self.assertEqual(patched["platforms"]["whatsapp"]["extra"]["bridge_port"], 3010)

        # Check dashboard credentials generated and written
        dashboard_login = self.hermes_home / "dashboard-login.txt"
        self.assertTrue(dashboard_login.is_file())
        content = dashboard_login.read_text()
        self.assertIn("Username: dappnode", content)
        self.assertIn("Password:", content)

    def test_patch_with_custom_dashboard_env(self):
        config_path = self.hermes_home / "config.yaml"
        env_path = self.hermes_home / ".env"

        with open(config_path, "w") as f:
            yaml.dump({"model": {"default": "deepseek-chat"}}, f)

        env_path.write_text(
            "HERMES_DASHBOARD_BASIC_AUTH_USERNAME=admin\n"
            "HERMES_DASHBOARD_BASIC_AUTH_PASSWORD=custom-secret-pass-123\n"
        )

        patched = patch_config_mod.patch_config(self.hermes_home, skip_dashboard_auth=False)

        self.assertEqual(patched["dashboard"]["basic_auth"]["username"], "admin")
        dashboard_login = self.hermes_home / "dashboard-login.txt"
        self.assertTrue(dashboard_login.is_file())
        content = dashboard_login.read_text()
        self.assertIn("Username: admin", content)
        self.assertIn("Password: custom-secret-pass-123", content)

    def test_skip_dashboard_auth(self):
        config_path = self.hermes_home / "config.yaml"
        with open(config_path, "w") as f:
            yaml.dump({"model": {"default": "gpt-4o"}}, f)

        patched = patch_config_mod.patch_config(self.hermes_home, skip_dashboard_auth=True)
        self.assertNotIn("dashboard", patched)
        dashboard_login = self.hermes_home / "dashboard-login.txt"
        self.assertFalse(dashboard_login.exists())

    def test_whatsapp_creds_detection(self):
        session_file = self.hermes_home / "platforms" / "whatsapp" / "session" / "creds.json"
        session_file.parent.mkdir(parents=True, exist_ok=True)
        session_file.write_text("{}")
        self.assertTrue(patch_config_mod.has_whatsapp_creds(self.hermes_home))

    def test_missing_config_returns_empty(self):
        patched = patch_config_mod.patch_config(self.hermes_home / "nonexistent")
        self.assertEqual(patched, {})


if __name__ == "__main__":
    unittest.main()
