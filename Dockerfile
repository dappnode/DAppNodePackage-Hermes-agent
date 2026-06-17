ARG UPSTREAM_VERSION="latest"

FROM nousresearch/hermes-agent:${UPSTREAM_VERSION}

USER root

# Install ttyd for web terminal (static binary from GitHub releases)
ADD --chmod=755 https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64 /usr/local/bin/ttyd

# Pre-install WhatsApp bridge dependencies (upstream ships the script but not node_modules)
RUN cd /opt/hermes/scripts/whatsapp-bridge && npm install --omit=dev --no-audit --no-fund

# Copy setup wizard into the image
COPY setup-wizard/ /opt/setup-wizard/

# Copy DAppNode context files (seeded into HERMES_HOME on first boot)
COPY dappnode/ /opt/dappnode/

# DAppNode s6-overlay customizations: a cont-init bootstrap hook plus the
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

# Health check for DAppNode monitoring
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# ENTRYPOINT is inherited from the upstream image (s6-overlay /init +
# docker/main-wrapper.sh). main-wrapper routes the CMD below to
# `s6-setuidgid hermes hermes gateway run`.
CMD ["gateway", "run"]
