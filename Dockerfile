ARG UPSTREAM_VERSION="latest"

FROM nousresearch/hermes-agent:${UPSTREAM_VERSION}

USER root

# Install ttyd for web terminal (static binary from GitHub releases)
ADD --chmod=755 https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64 /usr/local/bin/ttyd

# Copy setup wizard into the image
COPY setup-wizard/ /opt/setup-wizard/

# Copy DAppNode context files (seeded into HERMES_HOME on first boot)
COPY dappnode/ /opt/dappnode/

# Copy entrypoint script
COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

# Persistent data directory
ENV HERMES_HOME=/opt/data

# Expose API server, web UI, setup wizard, and web terminal ports
EXPOSE 3000 8080 8081 7681

# Health check for DAppNode monitoring
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["hermes", "gateway", "run"]
