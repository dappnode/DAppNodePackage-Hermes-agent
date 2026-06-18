---
name: dappnode-nexus
description: DAppNode Nexus — Private AI Gateway for Builders. Knowledge about the Nexus platform, its architecture, API compatibility, context-length pitfalls, and integration with DAppNode infrastructure.
category: devops
tags:
  - dappnode
  - nexus
  - ai-gateway
  - privacy
  - openai-compatible
---

# DAppNode Nexus

Nexus is DAppNode's **Private AI Gateway** — a unified, OpenAI-compatible API for accessing private and confidential AI models.

## Core Value Proposition

- **Privacy-first**: Prompts and data stay within the user's infrastructure
- **OpenAI-compatible API**: Drop-in replacement for OpenAI API calls
- **Multiple model routing**: Access to models from DeepSeek, Anthropic, OpenAI, Minimax, and more
- **Flexible billing**: Pay-as-you-go or subscription models

## Architecture

Nexus runs as a service within the DAppNode ecosystem. Users access it via:
- **Web UI**: https://nexus.dappnode.com/
- **API endpoint**: `https://nexus-api.dappnode.com/v1`

## Key URLs

| Resource | URL |
|----------|-----|
| Nexus Web App | https://nexus.dappnode.com/ |
| Nexus API | https://nexus-api.dappnode.com/v1 |
| DAppNode Main Site | https://dappnode.com/ |

## Privacy Guarantees

- Inference runs on DAppNode infrastructure, not external cloud providers
- Data does not leave the user's controlled environment
- No logging or retention of prompts by default

## Pitfalls

### Context length defaults to 256K with Nexus provider

When Nexus is configured as the Hermes provider (`nexus-api.dappnode.com`), Hermes may not auto-detect the model's true context length because:

1. `nexus-api.dappnode.com` is not in Hermes' `_URL_TO_PROVIDER` map → treated as an unknown custom endpoint
2. Hermes may skip provider-aware lookups (Anthropic API, models.dev, hardcoded defaults)
3. Falls back to `DEFAULT_FALLBACK_CONTEXT = 256_000` tokens if auto-detection fails

> **Update**: The `/v1/models` endpoint now returns `context_size` per model. The DAppNode package auto-sets `model.context_length` as a safety net, but you can verify with `hermes config show`.

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

> **Note**: `/v1/models` endpoint is now publicly accessible and returns `context_size` per model. Hermes Agent can query this for auto-detection, but the DAppNode package also pre-sets a safe default.
