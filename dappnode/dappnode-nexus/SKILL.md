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

When Nexus is configured as the Hermes provider (`nexus-api.dappnode.com`), Hermes cannot auto-detect the model's true context length because:

1. `nexus-api.dappnode.com` is not in Hermes' `_URL_TO_PROVIDER` map → treated as an unknown custom endpoint
2. The `/v1/models` endpoint returns `403 Forbidden` (Nexus does not expose model metadata publicly)
3. Hermes skips all provider-aware lookups and falls back to `DEFAULT_FALLBACK_CONTEXT = 256_000` tokens

**Symptom**: Hermes compresses context early, treats a 1M-token model as 256K, or shows `context_length: 256000` in `/usage`.

**Fix**: Set the correct context length explicitly in config:

```bash
hermes config set model.context_length 1000000
```

After setting, do `/reset` for the change to take effect.

Common Nexus-proxied models and their context lengths:

| Model | Context length |
|-------|---------------|
| `deepseek/deepseek-v4-pro` | 1,000,000 |
| `deepseek/deepseek-v4-flash` | 1,000,000 |
| `deepseek/deepseek-r1-0528` | 1,000,000 |
| `anthropic/claude-sonnet-4` | 200,000 |
| `anthropic/claude-opus-4` | 200,000 |
| `openai/gpt-5` | 400,000 |
| `openai/gpt-5.4` | 1,050,000 |
| `minimax/minimax-m2.7` | 1,000,000 |

For the full resolution chain and root-cause analysis, see `references/nexus-context-length-resolution.md`.
