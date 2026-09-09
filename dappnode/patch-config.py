#!/usr/bin/env python3
"""Patch a freshly-seeded Hermes config.yaml for the DAppNode environment.

Run as the `hermes` user from the 10-dappnode-setup cont-init hook, AFTER
upstream's stage2-hook has seeded config.yaml from cli-config.yaml.example
and run its schema migration. Idempotent: safe to run on every boot.
"""
import json
import os
import secrets
import urllib.request
from pathlib import Path

import yaml

hermes_home = Path(os.environ.get("HERMES_HOME", "/opt/data"))
config_path = hermes_home / "config.yaml"
dashboard_login_path = hermes_home / "dashboard-login.txt"
skip_dashboard_auth = os.environ.get("DAPPNODE_SKIP_DASHBOARD_AUTH") == "1"


# Nexus is reachable either directly or through the attested local proxy. Both
# expose the same OpenAI-compatible catalog, and the model ids are identical.
# The endpoints and the direct/private distinction live in nexus_mode so the
# boot-time patch and the runtime switch cannot drift apart.
from nexus_mode import (  # noqa: E402
    NEXUS_DIRECT_BASE_URL,
    is_nexus_base_url,
)


# Cloudflare fronts nexus-api.dappnode.com and 403s the default
# ``Python-urllib/<ver>`` User-Agent, so this fetch silently failed and every
# Nexus user fell back to Hermes' 256K default. Upstream Hermes guards against
# the same WAF behaviour in providers/base.py. Send a real UA.
CATALOG_USER_AGENT = "hermes-agent-dappnode/1.0"


def _context_size_from(base_url, model_id):
    """Return the context_size the catalog at base_url reports, or None."""
    url = base_url.rstrip("/") + "/models"
    try:
        req = urllib.request.Request(
            url,
            headers={"Accept": "application/json", "User-Agent": CATALOG_USER_AGENT},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.load(resp)
    except Exception:
        return None
    for m in data.get("data", []):
        if m.get("id") == model_id:
            size = m.get("context_size")
            return int(size) if size else None
    return None


def fetch_nexus_context_size(base_url, model_id):
    """Return the context_size Nexus reports for model_id, or None.

    Tries the configured endpoint first, then the public Nexus catalog. The
    fallback matters when Hermes points at the local proxy: proxy releases
    before 0.1.1 serve only chat completions and 404 on ``/models``, and the
    catalog is public either way, so there is nothing private to lose by
    asking the direct endpoint for it.
    """
    size = _context_size_from(base_url, model_id)
    if size:
        return size
    if base_url.rstrip("/") == NEXUS_DIRECT_BASE_URL:
        return None
    return _context_size_from(NEXUS_DIRECT_BASE_URL, model_id)


def read_dashboard_password(username):
    try:
        values = {}
        for line in dashboard_login_path.read_text(encoding="utf-8").splitlines():
            key, _, value = line.partition(":")
            values[key.strip().lower()] = value.strip()
        if values.get("username") == username and values.get("password"):
            return values["password"]
    except Exception:
        return None
    return None


def write_dashboard_password(username, password):
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
    dashboard_login_path.chmod(0o600)


def has_whatsapp_creds(profile_home):
    candidates = [
        profile_home / "platforms" / "whatsapp" / "session" / "creds.json",
        profile_home / "whatsapp" / "session" / "creds.json",
    ]
    return any(path.is_file() for path in candidates)


def configure_dashboard_auth(config):
    if skip_dashboard_auth:
        return False

    dashboard = config.setdefault("dashboard", {})
    basic = dashboard.setdefault("basic_auth", {})

    username = str(basic.get("username") or "").strip() or "dappnode"
    basic["username"] = username

    if not str(basic.get("secret") or "").strip():
        basic["secret"] = secrets.token_urlsafe(32)

    password = read_dashboard_password(username)
    has_config_password = bool(str(basic.get("password_hash") or "").strip() or str(basic.get("password") or "").strip())
    if password and has_config_password:
        return False

    # If Hermes already has only a password hash but DAppNode has no saved
    # plaintext credential, the setup wizard cannot perform its auto-login
    # handoff. Generate a new DAppNode-managed password and keep both files in
    # sync so users are not stranded at the raw dashboard login screen.
    password = password or secrets.token_urlsafe(24)

    try:
        from plugins.dashboard_auth.basic import hash_password

        basic["password_hash"] = hash_password(password)
        basic["password"] = ""
    except Exception:
        # The bundled provider can hash plaintext at load time. This fallback
        # keeps the dashboard gated even if the helper import moves upstream.
        basic["password_hash"] = ""
        basic["password"] = password

    write_dashboard_password(username, password)
    return True

try:
    with open(config_path) as f:
        config = yaml.safe_load(f) or {}
except FileNotFoundError:
    # Nothing to patch — upstream seeding should have created it, but don't
    # fail the boot if it hasn't.
    raise SystemExit(0)
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
term["cwd"] = os.environ.get("HERMES_HOME", "/opt/data")

generated_dashboard_auth = configure_dashboard_auth(config)

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
    msg += "; dashboard credentials saved to /opt/data/dashboard-login.txt"
print(msg)

# --- Nexus context length: source the real value from /v1/models ---
# Neither Nexus endpoint is in Hermes' URL-to-provider map, so the agent cannot
# auto-detect a model's context window and falls back to 256K. Rather than
# hardcode a single number (wrong for the smaller models -- e.g. Kimi is 262K,
# MiniMax M2.7 is 205K), query the endpoint Nexus already exposes:
# GET /v1/models returns `context_size` per model. Set model.context_length to
# that authoritative value for the configured model.
model_section = config.setdefault("model", {})
provider = model_section.get("provider", "")
base_url = str(model_section.get("base_url", ""))
model_id = model_section.get("default") or model_section.get("model") or ""

if provider == "custom" and is_nexus_base_url(base_url) and model_id:
    ctx = fetch_nexus_context_size(base_url, model_id)
    if ctx and model_section.get("context_length") != ctx:
        model_section["context_length"] = ctx
        with open(config_path, "w") as f:
            yaml.dump(config, f, default_flow_style=False, sort_keys=False)
        print(f"Nexus: set model.context_length={ctx} for '{model_id}' (from /v1/models)")
    elif ctx:
        print(f"Nexus: model.context_length already {ctx} for '{model_id}', leaving as-is")
    else:
        # Endpoint unreachable or model not listed. Leave context_length alone:
        # Hermes' own 256K fallback is safe (under-, never over-estimating).
        print(f"Nexus: could not resolve context_size for '{model_id}'; using Hermes default")
