# DAppNodePackage-Hermes-agent

[![DAppNode](https://img.shields.io/badge/DAppNode-Package-blue)](https://dappnode.io)
[![Upstream](https://img.shields.io/badge/Upstream-NousResearch%2Fhermes--agent-blueviolet)](https://github.com/NousResearch/hermes-agent)

DAppNode package for [Hermes Agent](https://hermes-agent.nousresearch.com/) by [Nous Research](https://nousresearch.com/) — a self-improving AI agent with multi-LLM support, messaging gateway, persistent memory, and skills system.

## Features

- **Multi-LLM Support**: OpenRouter (200+ models), OpenAI, Anthropic, Google Gemini, Ollama (local), Groq, DeepSeek, and more
- **Messaging Gateway**: Telegram, Discord, Slack, WhatsApp, Signal — all from a single process
- **Self-Improving Skills**: Agent creates and refines skills from experience
- **Persistent Memory**: Cross-session recall with user modeling
- **Cron Scheduling**: Automated tasks delivered to any platform
- **Setup Wizard**: Web-based configuration for providers, models, and integrations

## Getting Started

1. Install the package from the DAppNode Package Store
2. Open the **Setup Wizard** at `http://hermes-agent.dappnode:8080` to configure your AI provider and API key
3. Open the **Gateway Web UI** at `http://hermes-agent.dappnode:3000` to start chatting

## Building

```bash
npx @dappnode/dappnodesdk build
```

## Links

- [Hermes Agent Documentation](https://hermes-agent.nousresearch.com/docs/)
- [Nous Research](https://nousresearch.com/)
- [Upstream Repository](https://github.com/NousResearch/hermes-agent)
- [DAppNode SDK](https://docs.dappnode.io/docs/dev/sdk/overview)

## License

This DAppNode package wrapper is provided under the same license as DAppNode packages (Apache-2.0).
Hermes Agent itself is licensed under [MIT](https://github.com/NousResearch/hermes-agent/blob/main/LICENSE).
