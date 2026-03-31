#!/bin/bash
set -e

HERMES_HOME="${HERMES_HOME:-/opt/data}"
INSTALL_DIR="/opt/hermes"

# Create essential directory structure
mkdir -p "$HERMES_HOME"/{cron,sessions,logs,hooks,memories,skills}

# Bootstrap .env from example if not present
if [ ! -f "$HERMES_HOME/.env" ]; then
    cp "$INSTALL_DIR/.env.example" "$HERMES_HOME/.env"
fi

# Bootstrap config.yaml from example if not present
if [ ! -f "$HERMES_HOME/config.yaml" ]; then
    cp "$INSTALL_DIR/cli-config.yaml.example" "$HERMES_HOME/config.yaml"
fi

# Bootstrap SOUL.md if not present
if [ ! -f "$HERMES_HOME/SOUL.md" ]; then
    if [ -f "$INSTALL_DIR/docker/SOUL.md" ]; then
        cp "$INSTALL_DIR/docker/SOUL.md" "$HERMES_HOME/SOUL.md"
    else
        touch "$HERMES_HOME/SOUL.md"
    fi
fi

# ---------------------------------------------------------------------------
# Patch config.yaml for DAppNode: set gateway port to 3000 and bind to lan
# This ensures the gateway is accessible from the DAppNode network
# ---------------------------------------------------------------------------
python3 -c "
import yaml, sys

config_path = '$HERMES_HOME/config.yaml'
try:
    with open(config_path, 'r') as f:
        config = yaml.safe_load(f) or {}
except Exception:
    config = {}

# Ensure gateway section exists and is set for DAppNode access
if 'gateway' not in config or not isinstance(config.get('gateway'), dict):
    config['gateway'] = {}

config['gateway']['port'] = 3000
config['gateway']['bind'] = 'lan'

# Ensure controlUi allows DAppNode HTTP access (non-loopback)
if 'controlUi' not in config['gateway'] or not isinstance(config['gateway'].get('controlUi'), dict):
    config['gateway']['controlUi'] = {}

cui = config['gateway']['controlUi']
cui.setdefault('dangerouslyAllowHostHeaderOriginFallback', True)
cui.setdefault('allowInsecureAuth', True)
cui.setdefault('dangerouslyDisableDeviceAuth', True)

with open(config_path, 'w') as f:
    yaml.dump(config, f, default_flow_style=False, sort_keys=False)

print('Patched config.yaml for DAppNode (port=3000, bind=lan)')
" || echo "Warning: Could not patch config.yaml, continuing with defaults"

# Sync bundled skills (manifest-based so user edits are preserved)
if [ -d "$INSTALL_DIR/skills" ] && [ -f "$INSTALL_DIR/tools/skills_sync.py" ]; then
    python3 "$INSTALL_DIR/tools/skills_sync.py" || true
fi

# ---------------------------------------------------------------------------
# Start setup wizard web UI in the background on port 8080
# ---------------------------------------------------------------------------
echo "Starting setup wizard on port 8080..."
node /opt/setup-wizard/server.cjs &
WIZARD_PID=$!
echo "Setup wizard started (PID: ${WIZARD_PID})"

# ---------------------------------------------------------------------------
# Start ttyd web terminal in the background on port 7681
# ---------------------------------------------------------------------------
echo "Starting web terminal on port 7681..."
ttyd -p 7681 -W bash -l &
TTYD_PID=$!
echo "Web terminal started (PID: ${TTYD_PID})"

# Execute the main command (hermes gateway run)
exec "$@"
