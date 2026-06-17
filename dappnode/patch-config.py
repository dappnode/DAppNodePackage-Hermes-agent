#!/usr/bin/env python3
"""Patch a freshly-seeded Hermes config.yaml for the DAppNode environment.

Run as the `hermes` user from the 10-dappnode-setup cont-init hook, AFTER
upstream's stage2-hook has seeded config.yaml from cli-config.yaml.example
and run its schema migration. Idempotent: safe to run on every boot.
"""
import json
import os
import urllib.request

import yaml

config_path = os.path.join(os.environ.get("HERMES_HOME", "/opt/data"), "config.yaml")


def fetch_nexus_context_size(base_url, model_id):
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

platforms = config.setdefault("platforms", {})
if isinstance(platforms, dict):
    whatsapp = platforms.setdefault("whatsapp", {})
    if isinstance(whatsapp, dict):
        extra = whatsapp.setdefault("extra", {})
        if isinstance(extra, dict) and extra.get("bridge_port") in (None, 3000, "3000"):
            extra["bridge_port"] = 3010

with open(config_path, "w") as f:
    yaml.dump(config, f, default_flow_style=False, sort_keys=False)
print("Patched config.yaml for DAppNode (api_port=3000, whatsapp_bridge_port=3010)")

# --- Nexus context length: source the real value from /v1/models ---
# nexus-api.dappnode.com is not in Hermes' URL-to-provider map, so the agent
# cannot auto-detect a model's context window and falls back to 256K. Rather
# than hardcode a single number (wrong for the smaller models -- e.g. Kimi is
# 262K, MiniMax M2.7 is 205K), query the endpoint Nexus already exposes:
# GET /v1/models returns `context_size` per model. Set model.context_length to
# that authoritative value for the configured model.
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
        # Endpoint unreachable or model not listed. Leave context_length alone:
        # Hermes' own 256K fallback is safe (under-, never over-estimating).
        print(f"Nexus: could not resolve context_size for '{model_id}'; using Hermes default")
