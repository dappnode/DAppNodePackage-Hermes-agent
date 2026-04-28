---
name: dappnode
description: >
  DAppNode package operations — HTTPS exposure, port mapping, inter-package
  connectivity, Nexus provider setup, and troubleshooting.
  Use when the user asks about networking, exposing services, connecting
  to other packages, or configuring AI providers on DAppNode.
version: 1.0.0
author: DAppNode Association
license: MIT
metadata:
  hermes:
    tags: [dappnode, networking, infrastructure, https, nexus, provider]
    category: devops
    related_skills: [webhook-subscriptions]
---

# DAppNode Package Operations

This Hermes Agent runs as a DAppNode package. This skill covers DAppNode-specific procedures.

## Exposing a Service via HTTPS

By default, services are only reachable from inside the DAppNode network. To make a service publicly accessible:

1. Direct the user to open the DAppNode UI (`http://my.dappnode`), find the Hermes Agent package, and go to its **Network** tab.
2. They configure:
   - **Subdomain**: a name they choose (e.g., `hermes-api`)
   - **Port**: which container port to expose (8081 for dashboard, 3000 for API, etc.)
   - **Basic auth** (optional but recommended): username and password
3. The resulting public URL will be: `https://<subdomain>.<dyndns-domain>`

This is powered by the `https.dnp.dappnode.eth` package — an Nginx reverse proxy with automatic TLS via DAppNode's dyndns wildcard certificates.

### Security Notes
- Always recommend basic auth when exposing the dashboard (port 8081)
- The API server (port 3000) has its own key (`API_SERVER_KEY` env var), but basic auth adds a second layer
- Some webhook providers (Telegram, Discord) don't support basic auth in callback URLs — for those, rely on the API key alone and skip basic auth

### For Webhooks (Telegram, Discord, Slack, etc.)
If the user needs a publicly reachable webhook URL:
1. They must expose port 3000 via HTTPS first (see above)
2. The webhook callback URL will be `https://<subdomain>.<dyndns-domain>/...`
3. Configure this URL in the messaging platform's bot settings

## Port Mapping to Host

Users can map container ports directly to the host machine's network via the **Network** tab of the Hermes Agent package in the DAppNode UI (`http://my.dappnode`).

This allows access from the local network without VPN — useful for LAN-only setups.

## Inter-Package Connectivity

All DAppNode packages share the `dncore_network` Docker bridge network. Packages are reachable via DNS aliases.

### DNS Pattern
- Mono-service packages: `<shortname>.dappnode`
- Multi-service packages: `<service>.<shortname>.dappnode`

### Testing Connectivity
```bash
# Test if another package is reachable (not all packages expose /health)
curl -sf http://<package-alias>.dappnode:<port>/ -o /dev/null && echo "reachable" || echo "unreachable"
```

### Using DAppNode Nexus (Recommended)
DAppNode Nexus (`https://nexus.dappnode.com`) is DAppNode's own privacy-focused LLM gateway. It is OpenAI-compatible and prompts are never logged, stored, or used for training. Check the Nexus website for available models and pricing.

To configure, use the Setup Wizard at `http://hermes-agent.dappnode:8080` and select Nexus as the provider. Or manually:
1. Sign up at `https://nexus.dappnode.com` and create an API key
2. In the Setup Wizard or `config.yaml`, set the provider to Nexus with base URL `https://nexus-api.dappnode.com/v1`

## Troubleshooting

### Package Not Reachable
- The target package may not be installed or may be stopped — direct the user to the DAppNode UI (`http://my.dappnode`) to check
- Hermes cannot install or manage other DAppNode packages

### Configuration
- Environment variables: editable in the **Config** tab of the Hermes Agent package in the DAppNode UI
- Config file: `/opt/data/config.yaml`
- API keys: `/opt/data/.env`
- Logs: viewable in the **Logs** tab of the Hermes Agent package in the DAppNode UI
