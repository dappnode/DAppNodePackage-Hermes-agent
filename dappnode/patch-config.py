#!/usr/bin/env python3
"""Patch a freshly-seeded Hermes config.yaml for the DAppNode environment.

Run as the `hermes` user from the 10-dappnode-setup cont-init hook, AFTER
upstream's stage2-hook has seeded config.yaml from cli-config.yaml.example
and run its schema migration. Idempotent: safe to run on every boot.
"""
from __future__ import annotations

import json
import os
import secrets
import urllib.request
from pathlib import Path

import yaml


def parse_env_line(line: str) -> tuple[str | None, str | None]:
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
        return None, None
    if stripped.startswith("export "):
        stripped = stripped[7:].lstrip()
    key, _, value = stripped.partition("=")
    key = key.strip()
    value = value.strip()
    if (value.startswith('"') and value.endswith('"')) or (
        value.startswith("'") and value.endswith("'")
    ):
        value = value[1:-1]
    return key, value


def read_env(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    env: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8-sig", errors="replace").splitlines():
        key, value = parse_env_line(line)
        if key:
            env[key] = value or ""
    return env


def fetch_nexus_context_size(base_url: str, model_id: str) -> int | None:
    """Return the context_size Nexus reports for model_id, or None.

    Queries the OpenAI-compatible ``{base_url}/models`` listing, which Nexus
    serves publicly with a ``context_size`` field per model.
    """
    url = base_url.rstrip("/") + "/models"
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.load(resp)
    except Exception:
        return None
    for m in data.get("data", []):
        if m.get("id") == model_id:
            size = m.get("context_size")
            return int(size) if size else None
    return None


def read_dashboard_password(dashboard_login_path: Path, username: str) -> str | None:
    try:
        values: dict[str, str] = {}
        for line in dashboard_login_path.read_text(encoding="utf-8").splitlines():
            key, _, value = line.partition(":")
            values[key.strip().lower()] = value.strip()
        if values.get("username") == username and values.get("password"):
            return values["password"]
    except Exception:
        return None
    return None


def write_dashboard_password(dashboard_login_path: Path, username: str, password: str) -> None:
    dashboard_login_path.write_text(
        "\n".join(
            [
                "Hermes dashboard login",
                "URL: http://hermes-agent.dappnode:8080/dashboard",
                f"Username: {username}",
                f"Password: {password}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    try:
        dashboard_login_path.chmod(0o600)
    except OSError:
        pass


def has_whatsapp_creds(profile_home: Path) -> bool:
    candidates = [
        profile_home / "platforms" / "whatsapp" / "session" / "creds.json",
        profile_home / "whatsapp" / "session" / "creds.json",
    ]
    return any(path.is_file() for path in candidates)


def configure_dashboard_auth(
    config: dict,
    hermes_home: Path,
    dashboard_login_path: Path,
    skip_dashboard_auth: bool = False,
) -> bool:
    if skip_dashboard_auth:
        return False

    dashboard = config.setdefault("dashboard", {})
    basic = dashboard.setdefault("basic_auth", {})

    env = read_env(hermes_home / ".env")
    env_username = env.get("HERMES_DASHBOARD_BASIC_AUTH_USERNAME", "").strip()
    env_password = env.get("HERMES_DASHBOARD_BASIC_AUTH_PASSWORD", "").strip()
    env_secret = env.get("HERMES_DASHBOARD_BASIC_AUTH_SECRET", "").strip()

    username = env_username or str(basic.get("username") or "").strip() or "dappnode"
    basic["username"] = username

    if env_secret:
        basic["secret"] = env_secret
    elif not str(basic.get("secret") or "").strip():
        basic["secret"] = secrets.token_urlsafe(32)

    saved_password = read_dashboard_password(dashboard_login_path, username)
    has_config_password = bool(
        str(basic.get("password_hash") or "").strip()
        or str(basic.get("password") or "").strip()
    )

    # If the user explicitly provided a new password in .env (e.g. via Setup Wizard),
    # treat it as authoritative and sync both config.yaml and dashboard-login.txt.
    if env_password:
        if has_config_password and saved_password == env_password and basic.get("username") == username:
            return False
        password = env_password
    elif saved_password and has_config_password and basic.get("username") == username:
        return False
    else:
        # If Hermes already has only a password hash but DAppNode has no saved
        # plaintext credential, the setup wizard cannot perform its auto-login
        # handoff. Generate a new DAppNode-managed password and keep both files in
        # sync so users are not stranded at the raw dashboard login screen.
        password = saved_password or secrets.token_urlsafe(24)

    try:
        from plugins.dashboard_auth.basic import hash_password

        basic["password_hash"] = hash_password(password)
        basic["password"] = ""
    except Exception:
        # The bundled provider can hash plaintext at load time. This fallback
        # keeps the dashboard gated even if the helper import moves upstream.
        basic["password_hash"] = ""
        basic["password"] = password

    write_dashboard_password(dashboard_login_path, username, password)
    return True


def patch_config(hermes_home: Path, skip_dashboard_auth: bool = False) -> dict:
    config_path = hermes_home / "config.yaml"
    dashboard_login_path = hermes_home / "dashboard-login.txt"

    try:
        with open(config_path) as f:
            config = yaml.safe_load(f) or {}
    except FileNotFoundError:
        # Nothing to patch — upstream seeding should have created it, but don't
        # fail the boot if it hasn't.
        return {}
    except Exception:
        config = {}

    # --- Network access: bind the gateway to the LAN on the DAppNode port ---
    gw = config.setdefault("gateway", {})
    gw["port"] = 3000
    gw["bind"] = "lan"
    cui = gw.setdefault("controlUi", {})
    cui.setdefault("dangerouslyAllowHostHeaderOriginFallback", True)
    cui.setdefault("allowInsecureAuth", True)
    cui.setdefault("dangerouslyDisableDeviceAuth", True)

    term = config.setdefault("terminal", {})
    term["cwd"] = str(hermes_home)

    generated_dashboard_auth = configure_dashboard_auth(
        config, hermes_home, dashboard_login_path, skip_dashboard_auth
    )

    platforms = config.setdefault("platforms", {})
    if isinstance(platforms, dict):
        whatsapp = platforms.setdefault("whatsapp", {})
        if isinstance(whatsapp, dict):
            if not has_whatsapp_creds(hermes_home):
                whatsapp["enabled"] = False
            else:
                whatsapp.setdefault("enabled", False)
            extra = whatsapp.setdefault("extra", {})
            if isinstance(extra, dict) and extra.get("bridge_port") in (None, 3000, "3000"):
                extra["bridge_port"] = 3010

    with open(config_path, "w") as f:
        yaml.dump(config, f, default_flow_style=False, sort_keys=False)

    dashboard_auth_status = "skipped" if skip_dashboard_auth else "basic"
    msg = f"Patched config.yaml for DAppNode (api_port=3000, dashboard_auth={dashboard_auth_status}, whatsapp_bridge_port=3010)"
    if generated_dashboard_auth:
        msg += f"; dashboard credentials saved to {dashboard_login_path}"
    print(msg)

    # --- Nexus context length: source the real value from /v1/models ---
    model_section = config.setdefault("model", {})
    provider = model_section.get("provider", "")
    base_url = str(model_section.get("base_url", ""))
    model_id = model_section.get("default") or model_section.get("model") or ""

    if provider == "custom" and "nexus-api.dappnode.com" in base_url and model_id:
        ctx = fetch_nexus_context_size(base_url, model_id)
        if ctx and model_section.get("context_length") != ctx:
            model_section["context_length"] = ctx
            with open(config_path, "w") as f:
                yaml.dump(config, f, default_flow_style=False, sort_keys=False)
            print(f"Nexus: set model.context_length={ctx} for '{model_id}' (from /v1/models)")
        elif ctx:
            print(f"Nexus: model.context_length already {ctx} for '{model_id}', leaving as-is")
        else:
            print(f"Nexus: could not resolve context_size for '{model_id}'; using Hermes default")

    return config


def main() -> None:
    hermes_home = Path(os.environ.get("HERMES_HOME", "/opt/data"))
    skip_dashboard_auth = os.environ.get("DAPPNODE_SKIP_DASHBOARD_AUTH") == "1"
    patch_config(hermes_home, skip_dashboard_auth=skip_dashboard_auth)


if __name__ == "__main__":
    main()
