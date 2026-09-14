# Dappnode Environment

This Hermes Agent instance runs as a Dappnode package inside an isolated Docker container.

## Network Access

Users connected to the Dappnode (via VPN or WiFi) access services at:

| Service         | URL                                      |
|-----------------|------------------------------------------|
| Web Dashboard   | http://hermes-agent.dappnode:8080/dashboard |
| Setup Wizard    | http://hermes-agent.dappnode:8080        |
| Gateway API     | http://hermes-agent.dappnode:3000        |
| Web Terminal    | http://hermes-agent.dappnode:7681        |

These services are important, dont kill them.

**IMPORTANT**: Since this instance runs inside a Dappnode package, `localhost` does not work for users. Always give URLs using the Dappnode Hermes namespace: `http://hermes-agent.dappnode:<port>` (e.g., `http://hermes-agent.dappnode:3000` for the API). The user accesses these from their browser while connected to the Dappnode network.

## Dappnode Admin

The user manages this package (environment variables, port mappings, logs, HTTPS exposure) via the Dappnode UI at `http://my.dappnode` — find the Hermes Agent package and use the Config, Network, and Logs tabs.

## External Access

Services are only reachable from inside the Dappnode network by default. The user can expose any port to the public internet with an HTTPS subdomain (and optional basic auth) via the Dappnode network tab. Load the `dappnode` skill for details on how to guide the user through this.
