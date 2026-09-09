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

There are two ways to reach the API, chosen by the **Nexus privacy mode** switch
on the setup wizard's Dashboard tab. It can be flipped at any time, not only
during setup:

| Route | `model.base_url` | Who can read the prompt in transit |
|---|---|---|
| Direct | `https://nexus-api.dappnode.com/v1` | TLS terminates at Cloudflare, so prompts are visible there |
| Private mode | `http://nexus-proxy.dappnode.private:3301/v1` | Nobody between the proxy and the TEE |

Private mode routes through the **nexus-proxy** package on the same
Dappnode. That proxy verifies that the Nexus Gateway is running in a TEE
(trusted execution environment) and encrypts request and response bodies, so
nobody in between — including whoever terminates TLS — can read them. The
verification happens automatically on every connection; the user does not have
to do anything, but can check the proof themselves.

It **fails closed**: if the Gateway cannot be verified the proxy refuses to
run, and Hermes gets connection errors rather than a silent downgrade to the
unprotected path. The verification page at
`http://nexus-proxy.dappnode.private:3301/verification` shows the current
verdict, the checks performed, and the raw attestation evidence for independent
re-checking.

Switching modes changes **only** `model.base_url`. The Nexus API key, the
provider (`custom`) and the selected model are identical on both routes, so
turning privacy on or off never requires re-entering a key or reconfiguring the
provider. Hermes reads `config.yaml` at startup, so the package restarts itself
to apply the change; the switch does that automatically.

The switch refuses to turn private mode on while `nexus-proxy` is
unreachable, because the proxy fails closed and Hermes would simply stop
working. Install and start that package first.

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
