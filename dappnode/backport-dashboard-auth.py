#!/usr/bin/env python3
"""Backport the password-provider auto-SSO guard from upstream main."""
from pathlib import Path


MIDDLEWARE_PATH = Path(
    "/opt/hermes/hermes_cli/dashboard_auth/middleware.py"
)
ORIGINAL = """    provider = providers[0]
    prefix = prefix_from_request(request)
"""
PATCHED = """    provider = providers[0]
    if getattr(provider, "supports_password", False):
        return None
    prefix = prefix_from_request(request)
"""


def main() -> None:
    source = MIDDLEWARE_PATH.read_text(encoding="utf-8")
    if PATCHED in source:
        print("[dappnode] Dashboard password-provider SSO fix already present")
        return
    if source.count(ORIGINAL) != 1:
        raise SystemExit(
            "Could not apply dashboard auth backport: upstream middleware changed"
        )
    MIDDLEWARE_PATH.write_text(
        source.replace(ORIGINAL, PATCHED), encoding="utf-8"
    )
    print("[dappnode] Applied dashboard password-provider SSO fix")


if __name__ == "__main__":
    main()
