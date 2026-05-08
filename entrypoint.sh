#!/bin/bash
# DAppNode Hermes Agent entrypoint
# Based on upstream docker/entrypoint.sh (v2026.5.7) with DAppNode additions.
set -e

HERMES_HOME="${HERMES_HOME:-/opt/data}"
INSTALL_DIR="/opt/hermes"

# Make `hermes` discoverable inside the ttyd web terminal. This must be
# installed before dropping privileges because /etc/profile.d is root-owned.
install_terminal_profile() {
    if [ ! -d /etc/profile.d ] || [ -f /etc/profile.d/hermes-venv.sh ]; then
        return
    fi

    cat > /etc/profile.d/hermes-venv.sh <<'PROFILE'
# DAppNode Hermes Agent: expose venv + HERMES_HOME to login shells (ttyd)
if [ -d "/opt/hermes/.venv/bin" ]; then
    export PATH="/opt/hermes/.venv/bin:$PATH"
    export VIRTUAL_ENV="/opt/hermes/.venv"
fi
export HERMES_HOME="${HERMES_HOME:-/opt/data}"
export HOME="$HERMES_HOME/home"
mkdir -p "$HOME" 2>/dev/null || true
cd "$HERMES_HOME"
PROFILE
    chmod 0644 /etc/profile.d/hermes-venv.sh
}

# --- Root preflight and privilege drop ---
# Upstream Hermes starts the official image as root only long enough to repair
# the mounted data volume and then re-enters as the non-root `hermes` user.
if [ "$(id -u)" = "0" ]; then
    install_terminal_profile

    if [ -n "${HERMES_UID:-}" ] && [ "$HERMES_UID" != "$(id -u hermes)" ]; then
        echo "Changing hermes UID to $HERMES_UID"
        usermod -u "$HERMES_UID" hermes
    fi

    if [ -n "${HERMES_GID:-}" ] && [ "$HERMES_GID" != "$(id -g hermes)" ]; then
        echo "Changing hermes GID to $HERMES_GID"
        groupmod -o -g "$HERMES_GID" hermes 2>/dev/null || true
    fi

    mkdir -p "$HERMES_HOME"

    actual_hermes_uid="$(id -u hermes)"
    needs_chown=false
    if [ -n "${HERMES_UID:-}" ] && [ "$HERMES_UID" != "10000" ]; then
        needs_chown=true
    elif [ "$(stat -c %u "$HERMES_HOME" 2>/dev/null)" != "$actual_hermes_uid" ]; then
        needs_chown=true
    elif find "$HERMES_HOME" -xdev -maxdepth 3 ! -uid "$actual_hermes_uid" -print -quit 2>/dev/null | grep -q .; then
        needs_chown=true
    fi

    if [ "$needs_chown" = true ]; then
        echo "Fixing ownership of $HERMES_HOME to hermes ($actual_hermes_uid)"
        chown -R hermes:hermes "$HERMES_HOME" 2>/dev/null || \
            echo "Warning: chown failed (rootless container?) — continuing anyway"
    fi

    if [ -f "$HERMES_HOME/config.yaml" ]; then
        chown hermes:hermes "$HERMES_HOME/config.yaml" 2>/dev/null || true
        chmod 640 "$HERMES_HOME/config.yaml" 2>/dev/null || true
    fi

    echo "Dropping root privileges"
    exec env HOME="$HERMES_HOME/home" USER=hermes LOGNAME=hermes gosu hermes "$0" "$@"
fi

# If this script is PID 1 after the privilege drop, insert tini while still
# running as `hermes`. That keeps signal forwarding/zombie reaping without
# making the setup wizard signal a root-owned PID 1 on restart.
if [ "${DAPPNODE_TINI_WRAPPED:-}" != "1" ] && [ "$$" = "1" ] && command -v tini >/dev/null 2>&1; then
    export DAPPNODE_TINI_WRAPPED=1
    exec tini -g -- "$0" "$@"
fi

# --- Running as hermes from here ---
export HOME="$HERMES_HOME/home"
export USER="${USER:-hermes}"
export LOGNAME="${LOGNAME:-hermes}"

# --- Activate virtualenv ---
source "${INSTALL_DIR}/.venv/bin/activate"

# Clean stale runtime files from previous container runs
rm -f "$HERMES_HOME"/gateway.lock "$HERMES_HOME"/gateway.pid

# --- Bootstrap config files (mirrors upstream entrypoint) ---
mkdir -p "$HERMES_HOME"/{cron,sessions,logs,hooks,memories,skills,skins,plans,workspace,home}

if [ ! -f "$HERMES_HOME/.env" ]; then
    cp "$INSTALL_DIR/.env.example" "$HERMES_HOME/.env"
fi
if [ ! -f "$HERMES_HOME/config.yaml" ]; then
    cp "$INSTALL_DIR/cli-config.yaml.example" "$HERMES_HOME/config.yaml"
fi

if [ ! -f "$HERMES_HOME/SOUL.md" ]; then
    cp "$INSTALL_DIR/docker/SOUL.md" "$HERMES_HOME/SOUL.md"
fi

# --- DAppNode: seed context files (first boot only) ---
if [ ! -f "$HERMES_HOME/.hermes.md" ] && [ -f /opt/dappnode/hermes.md ]; then
    cp /opt/dappnode/hermes.md "$HERMES_HOME/.hermes.md"
    echo "Seeded .hermes.md with DAppNode context"
fi
if [ ! -d "$HERMES_HOME/skills/devops/dappnode" ] && [ -d /opt/dappnode/dappnode ]; then
    mkdir -p "$HERMES_HOME/skills/devops/dappnode"
    cp -r /opt/dappnode/dappnode/* "$HERMES_HOME/skills/devops/dappnode/"
    echo "Seeded DAppNode skill"
fi

# --- DAppNode: patch config.yaml for network access ---
python3 -c "
import yaml
config_path = '$HERMES_HOME/config.yaml'
try:
    with open(config_path) as f:
        config = yaml.safe_load(f) or {}
except Exception:
    config = {}
gw = config.setdefault('gateway', {})
gw['port'] = 3000
gw['bind'] = 'lan'
cui = gw.setdefault('controlUi', {})
cui.setdefault('dangerouslyAllowHostHeaderOriginFallback', True)
cui.setdefault('allowInsecureAuth', True)
cui.setdefault('dangerouslyDisableDeviceAuth', True)
term = config.setdefault('terminal', {})
term['cwd'] = '$HERMES_HOME'
platforms = config.setdefault('platforms', {})
if isinstance(platforms, dict):
    whatsapp = platforms.setdefault('whatsapp', {})
    if isinstance(whatsapp, dict):
        extra = whatsapp.setdefault('extra', {})
        if isinstance(extra, dict) and extra.get('bridge_port') in (None, 3000, '3000'):
            extra['bridge_port'] = 3010
with open(config_path, 'w') as f:
    yaml.dump(config, f, default_flow_style=False, sort_keys=False)
print('Patched config.yaml for DAppNode (api_port=3000, whatsapp_bridge_port=3010)')
" || echo "Warning: Could not patch config.yaml, continuing with defaults"

# --- Sync bundled skills (matches upstream — no || true) ---
if [ -d "$INSTALL_DIR/skills" ]; then
    python3 "$INSTALL_DIR/tools/skills_sync.py"
fi

# --- Start DAppNode background services ---
node /opt/setup-wizard/server.cjs &
echo "Setup wizard started on port 8080"

hermes dashboard --port 8081 --host 0.0.0.0 --no-open --insecure &
echo "Web dashboard started on port 8081"

ttyd -p 7681 -W bash -l &
echo "Web terminal started on port 7681"

# --- Run hermes (matches upstream exec logic) ---
# If $1 is an executable on PATH, run it directly; otherwise wrap with `hermes`.
if [ $# -gt 0 ] && command -v "$1" >/dev/null 2>&1; then
    exec "$@"
fi
exec hermes "$@"
