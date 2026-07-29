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
4. **Permissions** (Repository): **Pull requests: Read & write** · **Contents: Read-only** · **Metadata: Read-only**.
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

## Billing (next)

MVP: the app audits any repo it's installed on. **Phase 2**: gate on an active Stripe
subscription (match the installing org to a `TokenDam Pro` subscription) + a trends
dashboard (store each audit) — see the roadmap. For now, onboarding is manual-first:
a customer pays via the Stripe link, we install/enable them by hand.
