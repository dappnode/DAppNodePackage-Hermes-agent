# Hermes Agent

A **self-hosted AI agent** by [Nous Research](https://nousresearch.com) that runs on your DAppNode. Hermes learns from experience, remembers you across sessions, and connects to Telegram, Discord, Slack, and more — all from a single process.

## Getting started

1. **Set up a provider** — Open the [Setup Wizard](http://hermes-agent.dappnode:8080) and pick an AI provider.
2. **Talk to Hermes** — Message your bot on Telegram/Discord, run `hermes chat` in the [Web Terminal](http://hermes-agent.dappnode:7681), or connect any OpenAI-compatible client to `http://hermes-agent.dappnode:3000`.
3. **Manage your agent** — Open the [Dashboard](http://hermes-agent.dappnode:8081) (login: `dappnode` / `dappnode`) to view sessions, manage API keys, configure skills, set up scheduled tasks, and check logs. Change the credentials via the `HERMES_DASHBOARD_BASIC_AUTH_USERNAME`/`_PASSWORD` environment variables (or `dashboard.basic_auth` in `config.yaml`) if you want a private login.
