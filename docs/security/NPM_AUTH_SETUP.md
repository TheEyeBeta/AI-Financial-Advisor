# CI npm Auth Setup

To use private packages or avoid registry 403s in GitHub Actions:

1. Create an npm access token (read-only is enough for CI installs/audit).
2. Add it to GitHub repository secrets as `NPM_TOKEN`.
3. Workflows use `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` with `actions/setup-node` and npmjs registry URL.

## Workflows configured
- `.github/workflows/e2e.yml`
- `.github/workflows/security.yml` (`node-audit` job)

If your org uses a different npm registry, update `registry-url` in the workflow(s).
