#!/usr/bin/env python3
"""Read and flip which Nexus endpoint Hermes talks to.

Nexus is reachable two ways, and the only difference between them is
``model.base_url`` in config.yaml:

  direct   https://nexus-api.dappnode.com/v1
           TLS terminates at Cloudflare, so prompts are readable there.

  private  http://nexus-local-proxy.dappnode.private:3301/v1
           The nexus-local-proxy package on this DAppNode verifies the
           Gateway's AWS Nitro attestation and encrypts request and response
           bodies with EHBP, so the TLS terminator cannot read them.

Both endpoints serve the same OpenAI-compatible catalog under the same model
ids and accept the same Nexus API key, so switching is only ever a base_url
change: the provider, the key and the selected model all stay put. That is
what makes this safe to flip at runtime rather than only at setup.

Used as a module by patch-config.py and as a CLI by the setup wizard:

    nexus_mode.py get          -> {"mode": ..., "base_url": ..., ...}
    nexus_mode.py set private  -> flips config.yaml, prints the new state
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

import yaml

NEXUS_DIRECT_HOST = "nexus-api.dappnode.com"
NEXUS_PROXY_HOST = "nexus-local-proxy.dappnode.private"
NEXUS_DIRECT_BASE_URL = f"https://{NEXUS_DIRECT_HOST}/v1"
NEXUS_PROXY_BASE_URL = f"http://{NEXUS_PROXY_HOST}:3301/v1"
NEXUS_PROXY_VERIFICATION_URL = f"http://{NEXUS_PROXY_HOST}:3301/verification"

MODE_DIRECT = "direct"
MODE_PRIVATE = "private"
# The configured endpoint is not Nexus at all (Ollama, OpenRouter, ...), so
# there is no Nexus mode to report and nothing this module may rewrite.
MODE_NOT_NEXUS = "not_nexus"

BASE_URL_FOR_MODE = {
    MODE_DIRECT: NEXUS_DIRECT_BASE_URL,
    MODE_PRIVATE: NEXUS_PROXY_BASE_URL,
}


def config_path() -> Path:
    return Path(os.environ.get("HERMES_HOME", "/opt/data")) / "config.yaml"


def endpoint_host(base_url: str) -> str:
    """Return the lowercased hostname of base_url, or "" if there isn't one.

    Modes are decided on an exact hostname, never on a substring. Substring
    matching would classify https://nexus-api.dappnode.com.example.net/v1 as
    Nexus, and worse, would let a host merely *containing* the proxy name be
    reported as private mode -- so the dashboard would promise the prompt was
    encrypted to an attested enclave while it went somewhere else entirely.
    """
    try:
        # A base_url written without a scheme still has a host worth reading;
        # the "//" prefix makes urlsplit treat it as an authority rather than
        # a path. The comparison below stays exact either way.
        candidate = base_url if "//" in base_url else "//" + base_url.lstrip("/")
        return (urlsplit(candidate).hostname or "").lower()
    except ValueError:
        return ""


def detect_mode(base_url: str) -> str:
    host = endpoint_host(base_url)
    if host == NEXUS_PROXY_HOST:
        return MODE_PRIVATE
    if host == NEXUS_DIRECT_HOST:
        return MODE_DIRECT
    return MODE_NOT_NEXUS


def is_nexus_base_url(base_url: str) -> bool:
    return detect_mode(base_url) != MODE_NOT_NEXUS


def load_config(path: Path) -> dict:
    try:
        with open(path) as handle:
            return yaml.safe_load(handle) or {}
    except FileNotFoundError:
        return {}
    except Exception:
        return {}


def read_state(path: Path | None = None) -> dict:
    """Return the current Nexus endpoint state. Never raises."""
    path = path or config_path()
    config = load_config(path)
    model = config.get("model") or {}
    base_url = str(model.get("base_url") or "")
    mode = detect_mode(base_url)
    return {
        "mode": mode,
        "base_url": base_url,
        "is_nexus": mode != MODE_NOT_NEXUS,
        "model": model.get("default") or model.get("model") or "",
        "provider": model.get("provider") or "",
        "direct_base_url": NEXUS_DIRECT_BASE_URL,
        "private_base_url": NEXUS_PROXY_BASE_URL,
        "verification_url": NEXUS_PROXY_VERIFICATION_URL,
    }


def set_mode(mode: str, path: Path | None = None) -> dict:
    """Point model.base_url at the requested Nexus endpoint.

    Only base_url is touched. The API key, provider and selected model are
    left exactly as they are, which is the whole point: flipping modes must
    never look like reconfiguring the provider.
    """
    if mode not in BASE_URL_FOR_MODE:
        raise ValueError(f"unknown mode {mode!r}, want 'direct' or 'private'")

    path = path or config_path()
    config = load_config(path)
    model = config.get("model")
    if not isinstance(model, dict):
        raise ValueError("config.yaml has no model section to switch")

    current = str(model.get("base_url") or "")
    if detect_mode(current) == MODE_NOT_NEXUS:
        # Refuse to hijack a non-Nexus provider. Without this, toggling the
        # switch while Hermes points at Ollama would silently repoint it at
        # Nexus with whatever key happened to be in config.
        raise ValueError(
            "the configured endpoint is not Nexus; change provider in the "
            "wizard before switching Nexus modes"
        )

    target = BASE_URL_FOR_MODE[mode]
    if current == target:
        return read_state(path)

    model["base_url"] = target
    config["model"] = model
    # Write through a temporary file in the same directory so an interrupted
    # write cannot leave Hermes with a truncated config.yaml.
    temporary = path.with_suffix(path.suffix + ".tmp")
    with open(temporary, "w") as handle:
        yaml.dump(config, handle, default_flow_style=False, sort_keys=False)
    os.replace(temporary, path)
    return read_state(path)


def main(argv: list[str]) -> int:
    if len(argv) >= 1 and argv[0] == "get":
        print(json.dumps(read_state()))
        return 0
    if len(argv) == 2 and argv[0] == "set":
        try:
            print(json.dumps(set_mode(argv[1])))
            return 0
        except ValueError as error:
            print(json.dumps({"error": str(error)}))
            return 1
    print(json.dumps({"error": "usage: nexus_mode.py get | set <direct|private>"}))
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
