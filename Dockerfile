ARG UPSTREAM_VERSION="latest"

FROM nousresearch/hermes-agent:${UPSTREAM_VERSION}

USER root

# Hermes v0.23.1 checks its managed tools at startup and reports the runtime as
# out of sync when pnpm is absent. Install it through Hermes' package manager,
# then merge only its payload and inventory entry into the sealed store. The
# normal writable store is under /opt/data and would be hidden by the volume.
RUN python3 -c 'from pm import ensure; ensure("pnpm", explicit=True)' && \
    python3 -c 'import json, shutil; from pathlib import Path; base_path=Path("/opt/hermes/tools/facts.json"); extra_path=Path("/opt/data/tools/facts.json"); base=json.loads(base_path.read_text()); extra=json.loads(extra_path.read_text()); fact=extra["packages"]["pnpm"]; base["packages"]["pnpm"]=fact; base_path.write_text(json.dumps(base, sort_keys=True, separators=(",", ":"))+"\n"); payload=base_path.parent/fact["entry"]; shutil.copytree(extra_path.parent/fact["entry"], payload); Path("/usr/local/bin/pnpm").symlink_to(payload/"pnpm"); shutil.rmtree(extra_path.parent)'

# Install ttyd for web terminal (static binary from GitHub releases)
ADD --chmod=755 https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64 /usr/local/bin/ttyd

# Pre-install WhatsApp bridge dependencies (upstream ships the script but not node_modules)
RUN cd /opt/hermes/scripts/whatsapp-bridge && npm install --omit=dev --no-audit --no-fund

# Copy setup wizard into the image
COPY setup-wizard/ /opt/setup-wizard/

# Copy Dappnode context files (seeded into HERMES_HOME on first boot)
COPY dappnode/ /opt/dappnode/

# Dappnode's boot-time config patch uses upstream's YAML compatibility layer.
# Fail the image build if a future release stops providing it instead of
# silently starting with unpatched defaults.
RUN /opt/hermes/.venv/bin/python -c "from hermes_yaml import safe_dump, safe_load"

# v2026.7.1 auto-starts OAuth when BasicAuthProvider is the only dashboard
# provider, even though that provider only supports the password form. This
# narrow backport is already present upstream and can be removed after the
# package moves to a release containing it.
RUN python3 /opt/dappnode/backport-dashboard-auth.py

# Dappnode s6-overlay customizations: a cont-init bootstrap hook plus the
# setup-wizard and ttyd long-run services. We deliberately do NOT override the
# image ENTRYPOINT — the upstream image runs s6-overlay's /init (which handles
# UID remap, chown, config seeding, schema migration, skills sync and drops to
# the hermes user via main-wrapper.sh). Overriding it and re-dropping privileges
# ourselves crash-looped the container (tini is symlinked to /init upstream).
COPY rootfs/ /
RUN chmod 0755 /etc/cont-init.d/10-dappnode-setup \
      /etc/s6-overlay/s6-rc.d/setup-wizard/run \
      /etc/s6-overlay/s6-rc.d/ttyd/run

# Persistent data directory
ENV HERMES_HOME=/opt/data

# Expose API server, web UI, setup wizard, and web terminal ports
EXPOSE 3000 8080 8081 7681

# Health check for Dappnode monitoring
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# ENTRYPOINT is inherited from the upstream image (s6-overlay /init +
# docker/main-wrapper.sh). main-wrapper routes the CMD below to
# `s6-setuidgid hermes hermes gateway run`.
CMD ["gateway", "run"]
