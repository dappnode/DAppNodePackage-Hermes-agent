#!/usr/bin/env python3
"""Backport the password-provider auto-SSO guard from upstream main."""
import re
from pathlib import Path


MIDDLEWARE_PATH = Path(
    "/opt/hermes/hermes_cli/dashboard_auth/middleware.py"
)
GUARD_RE = re.compile(
    r'^    if getattr\(provider, "supports_password", False\):\n'
    r"^        return None\n",
    re.MULTILINE,
)
ORIGINAL_RE = re.compile(
    r"(^    provider = providers\[0\]\n)"
    r"(^    prefix = prefix_from_request\(request\)\n)",
    re.MULTILINE,
)


def add_password_guard(match: re.Match[str]) -> str:
    return (
        match.group(1)
        + '    if getattr(provider, "supports_password", False):\n'
        + "        return None\n\n"
        + match.group(2)
    )


def main() -> None:
    source = MIDDLEWARE_PATH.read_text(encoding="utf-8")
    if GUARD_RE.search(source):
        print("[dappnode] Dashboard password-provider SSO fix already present")
        return
    patched, count = ORIGINAL_RE.subn(add_password_guard, source, count=1)
    if count != 1:
        print("[dappnode] Dashboard auth middleware changed; skipping obsolete backport")
        return
    MIDDLEWARE_PATH.write_text(patched, encoding="utf-8")
    print("[dappnode] Applied dashboard password-provider SSO fix")


if __name__ == "__main__":
    main()
