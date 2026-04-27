ARG UPSTREAM_VERSION="latest"

FROM nousresearch/hermes-agent:${UPSTREAM_VERSION}

# Install ttyd for web terminal (static binary from GitHub releases)
ADD https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64 /usr/local/bin/ttyd
RUN chmod +x /usr/local/bin/ttyd

# Copy setup wizard into the image
COPY setup-wizard/ /opt/setup-wizard/

# Copy entrypoint script
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Persistent data directory
ENV HERMES_HOME=/opt/data

# Expose API server, web UI, setup wizard, and web terminal ports
EXPOSE 3000 8080 8081 7681

# Health check for DAppNode monitoring
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["hermes", "gateway", "run"]
