# Hermes Agent

Self-hosted AI agent for DappNode — by [Nous Research](https://nousresearch.com).

## Quick Start

1. Open the **[Dashboard](http://hermes-agent.dappnode:8080)** for an overview of agent status and quick links.
2. Use the **Setup** tab to configure your AI provider, API key, and preferred model.
3. Use the **Terminal** tab to run hermes CLI commands directly in your browser.

## Web UI (port 8080)

The main web interface at `http://hermes-agent.dappnode:8080` has three tabs:

| Tab | Description |
|-----|-------------|
| **Dashboard** | Agent status, current provider/model, and quick links |
| **Setup** | Guided wizard to configure provider, model, API keys, and messaging integrations |
| **Terminal** | Embedded web terminal for running `hermes` CLI commands |

### Useful Terminal Commands

| Command | Description |
|---------|-------------|
| `hermes model` | Interactively change provider and model |
| `hermes doctor` | Diagnose configuration and dependency issues |
| `hermes config show` | View current configuration |
| `hermes config set KEY VALUE` | Change a config value |
| `hermes setup` | Run the full CLI setup wizard |
| `hermes status` | Show agent, auth, and platform status |

## API Server (port 3000)

The API server exposes OpenAI-compatible endpoints — there is no built-in web chat UI:

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET /v1/models` | List available models |
| `POST /v1/chat/completions` | Chat completions (stateless) |
| `POST /v1/responses` | Responses API (server-side state) |

Connect any OpenAI-compatible frontend (Open WebUI, LobeChat, etc.) pointing at `http://hermes-agent.dappnode:3000`.

## Messaging Integrations

Hermes supports Telegram, Discord, Slack, WhatsApp, and Signal. Configure bot tokens in the Setup tab to enable messaging platforms.

## Configuration

All configuration lives in `/opt/data/` (persisted volume):
- `.env` — API keys and secrets
- `config.yaml` — All settings (model, terminal, compression, etc.)
- `SOUL.md` — Agent personality

You can edit these via the Setup wizard, the Terminal tab, or by accessing the files directly.

## Documentation

Full documentation is available at [hermes-agent.nousresearch.com/docs](https://hermes-agent.nousresearch.com/docs/).
