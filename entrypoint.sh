#!/bin/bash
set -e

HERMES_HOME="${HERMES_HOME:-/opt/data}"
INSTALL_DIR="/opt/hermes"

# Activate virtualenv if present (upstream images after v2026.4.8 use one)
if [ -f "${INSTALL_DIR}/.venv/bin/activate" ]; then
    source "${INSTALL_DIR}/.venv/bin/activate"
fi

# Make `hermes` discoverable inside the ttyd web terminal.
# ttyd spawns `bash -l`, which resets PATH from /etc/profile and loses the
# venv we activated above. Drop a profile.d snippet so login shells re-add it.
if [ -d /etc/profile.d ] && [ ! -f /etc/profile.d/hermes-venv.sh ]; then
    cat > /etc/profile.d/hermes-venv.sh <<EOF
# Added by DAppNode Hermes Agent package: expose the upstream venv to login shells
if [ -d "${INSTALL_DIR}/.venv/bin" ]; then
    export PATH="${INSTALL_DIR}/.venv/bin:\$PATH"
    export VIRTUAL_ENV="${INSTALL_DIR}/.venv"
fi
export HERMES_HOME="${HERMES_HOME}"
EOF
    chmod 0644 /etc/profile.d/hermes-venv.sh
fi

# --- Bootstrap config files (mirrors upstream entrypoint) ---
# Layout matches upstream docker/entrypoint.sh in v2026.4.23 (Hermes v0.11.0).
mkdir -p "$HERMES_HOME"/{cron,sessions,logs,hooks,memories,skills,skins,plans,workspace,home}

if [ ! -f "$HERMES_HOME/.env" ]; then
    cp "$INSTALL_DIR/.env.example" "$HERMES_HOME/.env"
fi
if [ ! -f "$HERMES_HOME/config.yaml" ]; then
    cp "$INSTALL_DIR/cli-config.yaml.example" "$HERMES_HOME/config.yaml"
fi
if [ ! -f "$HERMES_HOME/SOUL.md" ]; then
    cp "$INSTALL_DIR/docker/SOUL.md" "$HERMES_HOME/SOUL.md" 2>/dev/null || touch "$HERMES_HOME/SOUL.md"
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
with open(config_path, 'w') as f:
    yaml.dump(config, f, default_flow_style=False, sort_keys=False)
print('Patched config.yaml for DAppNode (port=3000, bind=lan)')
" || echo "Warning: Could not patch config.yaml, continuing with defaults"

# --- Sync bundled skills ---
if [ -d "$INSTALL_DIR/skills" ] && [ -f "$INSTALL_DIR/tools/skills_sync.py" ]; then
    python3 "$INSTALL_DIR/tools/skills_sync.py" || true
fi

# --- Start background services ---
node /opt/setup-wizard/server.cjs &
echo "Setup wizard started on port 8080"

# Start the web dashboard (serves pre-built UI from HERMES_WEB_DIST)
hermes dashboard --port 8081 --host 0.0.0.0 --no-open --insecure &
echo "Web dashboard started on port 8081"

ttyd -p 7681 -W bash -l &
echo "Web terminal started on port 7681"

# --- Run hermes ---
exec "$@"
