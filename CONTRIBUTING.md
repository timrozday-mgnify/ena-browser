# Contributing

## Setup

```bash
npm install
pip install pre-commit && pre-commit install
```

## Checks

| Command | What it does | Runs on |
|---|---|---|
| `pre-commit run --all-files` | whitespace/EOF/YAML/JSON hygiene, secret detection, Prettier, `tsc --noEmit` | commit + CI |
| `npm run lint` | `tsc --noEmit` | CI |
| `npm test` | Vitest unit tests | CI |
| `npm run build` | ESM + IIFE + CSS artefacts | CI |
| `npm run test:browser` | Playwright against `demo/` | CI |

The `tsc` pre-commit hook needs `npm install` to have run; CI skips it there and
typechecks in the `build` job instead.

## Pull requests

- Branch off `main`; no direct pushes to `main`.
- One phase of [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) per PR where possible.
- Both CI jobs (`pre-commit`, `build`) must be green before merge.
- Squash merge.

### Branch protection

Set once, by a repo admin:

```bash
gh api -X PUT repos/timrozday-mgnify/ena-browser/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f 'required_status_checks[strict]=true' \
  -f 'required_status_checks[contexts][]=pre-commit' \
  -f 'required_status_checks[contexts][]=build' \
  -f 'required_pull_request_reviews[required_approving_review_count]=1' \
  -f 'enforce_admins=false' -f 'restrictions=null'
```
