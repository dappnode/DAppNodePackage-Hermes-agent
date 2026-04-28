#!/bin/bash
# DAppNode Hermes Agent entrypoint
# Based on upstream docker/entrypoint.sh (v2026.4.23) with DAppNode additions.
set -e

HERMES_HOME="${HERMES_HOME:-/opt/data}"
INSTALL_DIR="/opt/hermes"

# --- Activate virtualenv ---
source "${INSTALL_DIR}/.venv/bin/activate"

# Make `hermes` discoverable inside the ttyd web terminal.
# ttyd spawns `bash -l`, which resets PATH. Drop a profile.d snippet so
# login shells re-add the venv and start in HERMES_HOME.
if [ -d /etc/profile.d ] && [ ! -f /etc/profile.d/hermes-venv.sh ]; then
    cat > /etc/profile.d/hermes-venv.sh <<'PROFILE'
# DAppNode Hermes Agent: expose venv + HERMES_HOME to login shells (ttyd)
if [ -d "/opt/hermes/.venv/bin" ]; then
    export PATH="/opt/hermes/.venv/bin:$PATH"
    export VIRTUAL_ENV="/opt/hermes/.venv"
fi
export HERMES_HOME="${HERMES_HOME:-/opt/data}"
cd "$HERMES_HOME"
PROFILE
    chmod 0644 /etc/profile.d/hermes-venv.sh
fi

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
with open(config_path, 'w') as f:
    yaml.dump(config, f, default_flow_style=False, sort_keys=False)
print('Patched config.yaml for DAppNode (port=3000, bind=lan)')
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
