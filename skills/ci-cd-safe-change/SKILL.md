---
name: ci-cd-safe-change
description: >-
  Make safe CI/CD and deployment-adjacent changes while preserving quality and
  security gates, and documenting any required human-only platform steps.
---

# Skill: ci-cd-safe-change

## When to use

- Editing deployment docs or deployment artifacts in `deployment/`.
- Investigating CI parity or release-readiness command requirements.
- Preparing safe instructions for human-applied dashboard updates.

## Do not use for

- Broad application feature implementation unrelated to delivery pipelines.
- Any change that weakens lint/type/test/security gates to make checks pass.

## Primary procedure

Use these as authoritative sources:

- `skills/deployment-readiness/SKILL.md` for release checklists and deploy ordering.
- `skills/architecture-compliance/SKILL.md` for boundary/invariant validation.
- `.github/workflows/ci.yml` and `package.json` as command source of truth.

## Guardrails

1. Never remove or relax required CI checks without explicit human approval.
2. Do not commit secrets or real environment values.
3. Distinguish local verification from human-only cloud dashboard steps.
