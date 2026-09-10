# DAppNodePackage-Hermes-agent

[![DAppNode](https://img.shields.io/badge/DAppNode-Package-blue)](https://dappnode.io)
[![Upstream](https://img.shields.io/badge/Upstream-NousResearch%2Fhermes--agent-blueviolet)](https://github.com/NousResearch/hermes-agent)

DAppNode package for [Hermes Agent](https://hermes-agent.nousresearch.com/) by [Nous Research](https://nousresearch.com/) — a self-improving AI agent with multi-LLM support, messaging gateway, persistent memory, and skills system.

## Features

- **Multi-LLM Support**: DAppNode Nexus (private AI), OpenRouter (200+ models), OpenAI, Anthropic, Google Gemini, Ollama (local), Groq, Mistral AI, DeepSeek, Hugging Face, GitHub Copilot, and custom endpoints
- **Messaging Gateway**: Telegram, WhatsApp, Discord, Slack, Signal — all from a single process
- **Self-Improving Skills**: Agent creates and refines skills from experience
- **Persistent Memory**: Cross-session recall with user modeling
- **Cron Scheduling**: Automated tasks delivered to any platform
- **Setup Wizard & Dashboard**: Web-based configuration with live model discovery, auto-login proxy, and built-in system diagnostics
- **Web Terminal**: Built-in browser terminal (`ttyd`) for running `hermes` CLI commands

## Network Services & Ports

| Service | Container Port | URL | Description |
|---|---|---|---|
| **Setup Wizard** | `8080` | `http://hermes-agent.dappnode:8080` | Web UI for provider configuration & overview |
| **Hermes Dashboard** | `8081` | `http://hermes-agent.dappnode:8080/dashboard` | Web dashboard for sessions, memory, & skills |
| **Gateway API** | `3000` | `http://hermes-agent.dappnode:3000` | OpenAI-compatible HTTP API & web interface |
| **Web Terminal** | `7681` | `http://hermes-agent.dappnode:7681` | Browser terminal for `hermes` CLI commands |

## Getting Started

1. Install the package from the DAppNode Package Store.
2. Open the **Setup Wizard** at `http://hermes-agent.dappnode:8080` to configure your AI provider and integrations.
3. Open the **Hermes Dashboard** at `http://hermes-agent.dappnode:8080/dashboard` or run `hermes chat` in the **Web Terminal**.

## Development & Testing

Run unit tests for both Node.js and Python hooks:

```bash
# Run all tests
npm test

# Run Node.js tests
npm run test:node

# Run Python bootstrapping & config tests
npm run test:python
```

## Building

```bash
npx @dappnode/dappnodesdk build
```

## Links

- [Hermes Agent Documentation](https://hermes-agent.nousresearch.com/docs/)
- [Nous Research](https://nousresearch.com/)
- [Upstream Repository](https://github.com/NousResearch/hermes-agent)
- [DAppNode SDK](https://docs.dappnode.io/docs/dev/sdk/overview)
- [DAppNode Nexus](https://nexus.dappnode.com/)

## License

This DAppNode package wrapper is provided under the same license as DAppNode packages (Apache-2.0).
Hermes Agent itself is licensed under [MIT](https://github.com/NousResearch/hermes-agent/blob/main/LICENSE).
