#!/usr/bin/env python3
"""Unit tests for dappnode/bootstrap-env.py."""
import sys
import tempfile
import unittest
from pathlib import Path

# Add repository root to path
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "dappnode"))

from importlib import import_module
bootstrap_env_mod = import_module("bootstrap-env")


class TestBootstrapEnv(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.hermes_home = Path(self.temp_dir.name)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_has_usable_secret(self):
        self.assertFalse(bootstrap_env_mod.has_usable_secret(""))
        self.assertFalse(bootstrap_env_mod.has_usable_secret("short"))
        self.assertFalse(bootstrap_env_mod.has_usable_secret("changeme"))
        self.assertFalse(bootstrap_env_mod.has_usable_secret("your-token-here"))
        self.assertTrue(bootstrap_env_mod.has_usable_secret("a" * 32))

    def test_repair_default_env_generates_api_key(self):
        env_path = self.hermes_home / ".env"
        env_path.write_text("API_SERVER_KEY=changeme\n")

        env = bootstrap_env_mod.repair_profile_env(self.hermes_home, is_default=True)
        self.assertTrue(bootstrap_env_mod.has_usable_secret(env["API_SERVER_KEY"]))
        self.assertNotEqual(env["API_SERVER_KEY"], "changeme")

    def test_repair_profile_env_disables_api_server(self):
        profile_home = self.hermes_home / "profiles" / "work"
        profile_home.mkdir(parents=True, exist_ok=True)
        env_path = profile_home / ".env"
        env_path.write_text("API_SERVER_ENABLED=true\nAPI_SERVER_KEY=secret-key-123456789\n")

        env = bootstrap_env_mod.repair_profile_env(profile_home, is_default=False)
        self.assertEqual(env["API_SERVER_ENABLED"], "false")
        self.assertEqual(env["API_SERVER_KEY"], "")

    def test_repair_whatsapp_disabled_without_creds(self):
        env_path = self.hermes_home / ".env"
        env_path.write_text("WHATSAPP_ENABLED=true\nAPI_SERVER_KEY=valid-secret-key-123456789\n")

        env = bootstrap_env_mod.repair_profile_env(self.hermes_home, is_default=True)
        self.assertEqual(env["WHATSAPP_ENABLED"], "false")


if __name__ == "__main__":
    unittest.main()
