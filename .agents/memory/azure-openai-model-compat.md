---
name: Azure OpenAI model compatibility
description: GPT-4 family retired; how the extraction code talks to current Azure OpenAI models
---

As of mid-2026 the GPT-4o/4.1 family is deprecated on Azure (no new deployments); GPT-5 family (gpt-5.1, gpt-5-mini, etc.) is current. GPT-5 models reject `temperature: 0`.

The extraction client tries the version-free `/openai/v1/chat/completions` endpoint (model = deployment name, no temperature) first, then falls back to the legacy deployment-scoped URL with api-version + temperature:0 on 400/404/405. Auth/429 errors are terminal, no fallback.

**Why:** User could only deploy GPT-5-family models; old code hardcoded the legacy endpoint + temperature and would 400.
**How to apply:** Don't reintroduce temperature or a pinned api-version for the primary path; keep the deployment name fully user-configurable.
