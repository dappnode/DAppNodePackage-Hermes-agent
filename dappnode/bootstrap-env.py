#!/usr/bin/env python3
"""Repair DAppNode-specific Hermes .env settings before services start."""
from __future__ import annotations

import os
import secrets
from pathlib import Path


HERMES_HOME = Path(os.environ.get("HERMES_HOME", "/opt/data"))
ENV_NAME = ".env"
PLACEHOLDER_VALUES = {
    "",
    "changeme",
    "change-me",
    "default",
    "dappnode",
    "example",
    "none",
    "null",
    "password",
    "placeholder",
    "secret",
    "todo",
    "your-token-here",
}
TRUE_VALUES = {"1", "true", "yes", "on"}


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


def read_env(path: Path) -> tuple[list[str], dict[str, str]]:
    try:
        lines = path.read_text(encoding="utf-8-sig", errors="replace").splitlines()
    except FileNotFoundError:
        lines = []

    env: dict[str, str] = {}
    for line in lines:
        key, value = parse_env_line(line)
        if key:
            env[key] = value or ""
    return lines, env


def write_env(path: Path, lines: list[str], updates: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    written: set[str] = set()
    out: list[str] = []

    for line in lines:
        key, _ = parse_env_line(line)
        if key and key in updates:
            out.append(f"{key}={updates[key]}")
            written.add(key)
        else:
            out.append(line)

    for key, value in updates.items():
        if key not in written:
            out.append(f"{key}={value}")

    path.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass


def has_usable_secret(value: str, min_length: int = 16) -> bool:
    cleaned = (value or "").strip()
    if len(cleaned) < min_length:
        return False
    return cleaned.lower() not in PLACEHOLDER_VALUES


def has_whatsapp_creds(profile_home: Path) -> bool:
    candidates = [
        profile_home / "platforms" / "whatsapp" / "session" / "creds.json",
        profile_home / "whatsapp" / "session" / "creds.json",
    ]
    return any(path.is_file() for path in candidates)


def repair_profile_env(profile_home: Path, *, is_default: bool) -> dict[str, str]:
    env_path = profile_home / ENV_NAME
    lines, env = read_env(env_path)
    updates: dict[str, str] = {}

    if is_default:
        if not has_usable_secret(env.get("API_SERVER_KEY", "")):
            updates["API_SERVER_KEY"] = secrets.token_hex(32)
    else:
        # DAppNode exposes a single API server on port 3000. Named profile
        # gateways can still run messaging/cron, but must not each bind 3000.
        if env.get("API_SERVER_ENABLED", "").strip().lower() not in {"false", "0", "no"}:
            updates["API_SERVER_ENABLED"] = "false"
        if env.get("API_SERVER_KEY", ""):
            updates["API_SERVER_KEY"] = ""

    whatsapp_enabled = env.get("WHATSAPP_ENABLED", "").strip().lower()
    if whatsapp_enabled in TRUE_VALUES and not has_whatsapp_creds(profile_home):
        updates["WHATSAPP_ENABLED"] = "false"

    if updates:
        write_env(env_path, lines, updates)
        changed = ", ".join(sorted(updates))
        label = "default" if is_default else profile_home.name
        print(f"[dappnode] Repaired {label} .env: {changed}")

    env.update(updates)
    return env


def iter_profile_homes(hermes_home: Path = HERMES_HOME) -> list[Path]:
    profiles_root = hermes_home / "profiles"
    if not profiles_root.is_dir():
        return []
    return sorted(path for path in profiles_root.iterdir() if path.is_dir())


def bootstrap_all(hermes_home: Path = HERMES_HOME) -> None:
    repair_profile_env(hermes_home, is_default=True)
    for profile_home in iter_profile_homes(hermes_home):
        repair_profile_env(profile_home, is_default=False)


def main() -> None:
    bootstrap_all(HERMES_HOME)


if __name__ == "__main__":
    main()
