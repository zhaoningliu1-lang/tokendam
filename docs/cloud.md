# TokenDam Cloud — the hosted GitHub App (Pro)

The free tier makes _you_ wire a GitHub Action. **Pro** is zero-setup: install the
TokenDam GitHub App and our servers audit token cost on every PR automatically —
$/month projection, findings, and a fix pack, posted as one PR comment.

Backend: `api/github/webhook.js` (Vercel function) + `api/github/_gh.js` (auth).
It runs the SAME engine as the CLI/web (`dist/core`), so numbers match everywhere.

## Flow

```
PR opened/updated  ──▶  GitHub App webhook  ──▶  our server:
                                                  1. auth as the app (installation token)
                                                  2. fetch the repo's traces/*.json at the PR head
                                                  3. run the TokenDam engine
                                                  4. upsert one audit comment (with fix pack)
```

The customer commits representative request payloads to `traces/*.json` (via the
`tokendam/capture` helper) — nothing else to set up.

## Create the GitHub App (one-time)

1. github.com → **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. **Name**: TokenDam · **Homepage**: https://tokendam.dev
3. **Webhook**: Active. **URL**: `https://tokendam.dev/api/github/webhook` · **Secret**: generate a random string (save it).
4. **Permissions** (Repository): **Pull requests: Read & write** · **Contents: Read & write** (needed to open the auto-fix PR; use Read-only if you only want comments) · **Metadata: Read-only**.
5. **Subscribe to events**: **Pull request**.
6. **Where can this be installed**: Any account (for Marketplace) or Only this account (to start).
7. Create → note the **App ID** → **Generate a private key** (downloads a `.pem`).

## Wire the credentials (Vercel env)

Set on the tokendam Vercel project (Settings → Environment Variables), then redeploy:

| Env var | Value |
|---|---|
| `GITHUB_APP_ID` | the App ID |
| `GITHUB_APP_PRIVATE_KEY` | contents of the `.pem` (paste as-is; `\n`-escaped is also handled) |
| `GITHUB_WEBHOOK_SECRET` | the webhook secret from step 3 |
| `TOKENDAM_TRACE_DIR` | optional, default `traces` |

The webhook verifies the signature and no-ops safely without these set.

## Test it

Install the app on a test repo that has `traces/agent.json`, open a PR → a TokenDam
comment appears within seconds. GitHub App settings → Advanced → **Recent Deliveries**
shows each webhook + our response.

## Billing — subscription gating (Phase 2)

Gating is an **env allowlist**, `TOKENDAM_PRO_ACCOUNTS` (comma-separated GitHub
logins, case-insensitive) — see `api/github/_pro.js`:

- **Pro account** → full PR comment: findings table + copy-paste fix pack + trend link.
- **Everyone else** → a one-line free preview: headline `$/month` waste + issue count
  + an upgrade CTA to `tokendam.dev/pricing`. A funnel, not a wall.

Onboarding is manual-first (right for this stage): a customer pays via the Stripe
link → add their GitHub org/user to `TOKENDAM_PRO_ACCOUNTS` → redeploy. Swap that one
function for a DB/Stripe lookup once volume justifies it — the webhook doesn't change.

## Cost-trend dashboard (Phase 2)

Each audit is recorded to **Vercel KV (Upstash)** via `api/_store.js` (plain REST, no
deps). The dashboard at **`/dashboard`** (`public/dashboard.html` + `api/history.js`)
charts a repo's waste `$/month` per PR over time, with a summary + per-PR table.

**Graceful**: if no KV store is attached, recording no-ops and the webhook still works
— the dashboard just says "enable storage". To turn it on:

1. Vercel → the tokendam project → **Storage → Create → KV (Upstash)** → connect.
   Vercel injects `KV_REST_API_URL` + `KV_REST_API_TOKEN` automatically.
2. Redeploy. New PR audits start accumulating; view at `/dashboard?repo=owner/name`.
