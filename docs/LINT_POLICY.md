# ESLint Policy

## Zero Tolerance Rules

**Must be zero before merge:**
- All ESLint errors (severity: 2)
- `@typescript-eslint/no-explicit-any`
- `react-hooks/exhaustive-deps`
- `react-hooks/rules-of-hooks`

## Acceptable Warnings (with justification)

Warnings should be fixed whenever possible and may be suppressed only with clear justification comments.

- `react-hooks/exhaustive-deps`: allowed only for intentional one-time effects with rationale.
- `no-console`: allowed for `console.warn` and `console.error`; avoid `console.log` in production paths.

## Suppression Guidelines

```ts
// ✅ GOOD - clear reason for suppression
// Intentionally run only once on mount; future changes are handled in another effect
// eslint-disable-next-line react-hooks/exhaustive-deps
useEffect(() => {
  initialize();
}, []);

// ❌ BAD - missing explanation
// eslint-disable-next-line react-hooks/exhaustive-deps
useEffect(() => {
  initialize();
}, []);
```

## Enforcement

- `npm run lint:ci` must pass with zero warnings.
- CI rejects pull requests with lint/type failures.
- Keep project-wide `eslint-disable` comments minimal and justified.
