---
name: dappnode-nexus
description: Dappnode Nexus — Private AI Gateway for Builders. Knowledge about the Nexus platform, its architecture, API compatibility, context-length pitfalls, and integration with Dappnode infrastructure.
category: devops
tags:
  - dappnode
  - nexus
  - ai-gateway
  - privacy
  - openai-compatible
---

# Dappnode Nexus

Nexus is Dappnode's **Private AI Gateway** — a unified, OpenAI-compatible API for accessing private and confidential AI models.

## Core Value Proposition

- **Privacy-first**: Prompts and data stay within the user's infrastructure
- **OpenAI-compatible API**: Drop-in replacement for OpenAI API calls
- **Multiple model routing**: Access to models from DeepSeek, Anthropic, OpenAI, Minimax, and more
- **Flexible billing**: Pay-as-you-go or subscription models

## Architecture

Nexus runs as a service within the Dappnode ecosystem. Users access it via:
- **Web UI**: https://nexus.dappnode.com/
- **API endpoint**: `https://nexus-api.dappnode.com/v1`

**Nexus privacy mode** is a switch on the setup wizard's Dashboard tab. It can
be flipped at any time, not only during setup.

Turned on, prompts go through the **nexus-proxy** package on the same Dappnode,
which encrypts them so only the TEE (trusted execution environment) running
Nexus can read them. The proxy verifies that TEE automatically on every
connection; the user can check the proof at
`http://nexus-proxy.dappnode.private:3301/verification`.

It changes **only** `model.base_url`:

| Mode | `model.base_url` |
|---|---|
| Off | `https://nexus-api.dappnode.com/v1` |
| On | `http://nexus-proxy.dappnode.private:3301/v1` |

The API key, provider (`custom`) and model are the same either way, so
switching never needs a key re-entered or the provider reconfigured. Hermes
reads `config.yaml` at startup, so the switch restarts the package itself.

The switch will not turn private mode on while `nexus-proxy` is unreachable:
the proxy fails closed, so Hermes would just stop working. Point the user at
the Dappstore to install it.

### Recommend a `private/` model

Private mode protects the prompt from the proxy to the Nexus Gateway. A model
whose id starts with `private/` extends that the rest of the way: the Gateway
reaches those over an attested, encrypted transport that fails closed, so the
prompt is protected end to end.

If the user turns private mode on while using another model, suggest switching
to a `private/` one. `GET /v1/models` marks them.

### What does not work in private mode

Verified against the live TEE Gateway, not assumed:

- **Auto Router (`nexus/auto`)** returns 500 on the TEE Gateway while working
  on production. Tell the user to pick a specific model.
- **PII masking** does not apply. The masking service sits outside the TEE and
  the TEE may only reach its measured egress routes, which exclude it.

Normal models, the `private/*` models and streaming all work, and both
endpoints serve the same catalog.

## Key URLs

| Resource | URL |
|----------|-----|
| Nexus Web App | https://nexus.dappnode.com/ |
| Nexus API | https://nexus-api.dappnode.com/v1 |
| Attested local proxy | http://nexus-proxy.dappnode.private:3301/v1 |
| Proxy verification page | http://nexus-proxy.dappnode.private:3301/verification |
| Dappnode Main Site | https://dappnode.com/ |

## Privacy Guarantees

- Inference runs on Dappnode infrastructure, not external cloud providers
- Data does not leave the user's controlled environment
- No logging or retention of prompts by default
- With Private mode on, prompt and completion bodies are additionally encrypted
  to the TEE, so nobody in between can read them

## Pitfalls

### Context length defaults to 256K with Nexus provider

When Nexus is configured as the Hermes provider (`nexus-api.dappnode.com`), Hermes may not auto-detect the model's true context length because:

1. Neither `nexus-api.dappnode.com` nor the local proxy is in Hermes' `_URL_TO_PROVIDER` map → treated as an unknown custom endpoint
2. Hermes may skip provider-aware lookups (Anthropic API, models.dev, hardcoded defaults)
3. Falls back to `DEFAULT_FALLBACK_CONTEXT = 256_000` tokens if auto-detection fails

> **Update**: The `/v1/models` endpoint now returns `context_size` per model. The Dappnode package auto-sets `model.context_length` as a safety net, but you can verify with `hermes config show`.

**Symptom**: Hermes compresses context early, treats a 1M-token model as 256K, or shows `context_length: 256000` in `/usage`.

**Fix**: Set the correct context length explicitly in config:

```bash
hermes config set model.context_length 1000000
```

After setting, do `/reset` for the change to take effect.

Common Nexus-proxied models and their context lengths:

| Model | Context length |
|-------|---------------|
| `deepseek/deepseek-v4-pro` | 1,048,576 (1M) |
| `deepseek/deepseek-v4-flash` | 1,048,576 (1M) |
| `moonshotai/kimi-k2.6` | 262,144 |
| `minimax/minimax-m2.7` | 204,800 |
| `minimax/minmax-m3` | 512,000 |
| `nexus/auto` | Auto-routing (varies) |

> **Note**: `/v1/models` endpoint is now publicly accessible and returns `context_size` per model. Hermes Agent can query this for auto-detection, but the Dappnode package also pre-sets a safe default.
