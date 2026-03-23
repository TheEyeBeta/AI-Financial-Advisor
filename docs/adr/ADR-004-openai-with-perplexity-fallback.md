# ADR-004: OpenAI With Perplexity Fallback
## Status
Accepted

## Context
The backend performs chat completion, query classification, title generation, and quantitative analysis. It needs a primary model provider that is strong at reasoning and tool-like instruction following, but it also needs a fallback when the primary provider is unavailable, rate-limited, or quota-constrained. The codebase already routes primary chat traffic through OpenAI and has a Perplexity fallback path.

## Decision
Use OpenAI as the primary provider and Perplexity as the fallback provider instead of relying on a single LLM vendor.

## Consequences
This reduces single-vendor outage risk and gives the backend a second path for user-facing AI responses when OpenAI is degraded. It also lets us keep the main prompt and model strategy tuned for OpenAI while preserving a practical fallback for web-connected answers.

The cost is more integration complexity. Prompt behavior will not be identical across providers, token accounting differs, and fallback responses may vary in tone or citation style. We also need careful error handling so fallback behavior does not hide real configuration problems.

The single-provider alternative would be simpler, but it would create a brittle user experience for a service that is already exposed to external API failures. The current design accepts heterogeneity in exchange for availability.
