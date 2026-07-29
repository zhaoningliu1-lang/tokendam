# TokenDam Inc. — the AI-native company

TokenDam is run by a tiny standing crew of agents. Unlike a consumer app (which
needs marketing/community/ops agents), a **developer tool** lives or dies on
*building the right thing* and *keeping the numbers correct* — so the crew is
built around a **Product Manager** and a **CTO**, plus a free uptime sentinel.

Everything follows the proven Khotan pattern: Vercel serverless function + cron
trigger + `CRON_SECRET` guard + Resend email digest + **graceful no-op when env
is missing** + **advisory only** (agents draft; the human decides).

```
        You (CEO / only human — holds the approve gate)
                 │
   ┌─────────────┼──────────────┐
   PM agent      CTO agent       Ops sentinel
 (what to build) (keep it correct) (is it up)
```

## The crew

| Agent | File | Cron | LLM | Job |
|---|---|---|---|---|
| **Product Manager** | `api/pm-agent.js` | Mon 16:00 UTC | ✅ | Pulls real signal (Hacker News LLM-cost threads + the repo's GitHub issues) → drafts a ranked backlog + "the one thing to ship this week". |
| **CTO** | `api/cto-agent.js` | Thu 16:00 UTC | ✅ | Watches drift (model prices / new models / tokenizers / new trace formats), flags accuracy risks, proposes the next detector. Reads live `pricing.ts` from GitHub if configured. |
| **Ops sentinel** | `api/ops-sentinel.js` | every 15 min | ❌ | Fetches the live site + its JS asset; emails **only on failure** (silence = healthy). No LLM, effectively free. |

Shared helpers live in `api/_shared.js` (auth, Resend email, Anthropic client).

## Guardrails (inherited from the Khotan fleet)

- **Advisory only.** Agents email a draft; they never edit code, post, or spend
  on your behalf beyond their own LLM call.
- **Fail closed on auth.** Without `CRON_SECRET`, endpoints return 503 — a public
  endpoint that spends tokens on every hit is worse than a silent one.
- **No-op without creds.** Missing `ANTHROPIC_API_KEY` / `RESEND_API_KEY` →
  the agent returns `{skipped:true}` instead of crashing. Ship dormant, switch on later.

## Activation (currently dormant)

The agents are deployed but asleep. To switch the fleet on, set these in Vercel
project env (Settings → Environment Variables), then redeploy:

| Env var | Needed by | Notes |
|---|---|---|
| `CRON_SECRET` | all | random string; Vercel Cron sends it as `Authorization: Bearer` |
| `RESEND_API_KEY` | PM, CTO, ops | reuse the verified `khotanstudios.com` Resend key |
| `AGENT_TO_EMAIL` | all | where digests go (default `hello@avantia2a.com`) |
| `AGENT_FROM_EMAIL` | all | e.g. `TokenDam Agents <agents@khotanstudios.com>` |
| `ANTHROPIC_API_KEY` | PM, CTO | drafting; **this is the only recurring cost** |
| `ANTHROPIC_MODEL` | PM, CTO | optional, defaults to a Sonnet |
| `GITHUB_REPO` | PM, CTO | `owner/name` — enables issue signal + live pricing review |
| `TOKENDAM_URL` | ops | defaults to `https://tokendam.vercel.app` |

Manual trigger for testing: `GET /api/pm-agent?secret=<CRON_SECRET>`.

## Cost discipline

With **0 users, keep the fleet dormant** (cost ≈ $0 — Vercel free tier). The only
recurring spend when switched on is the PM + CTO weekly Anthropic calls (a few
cents/week). Ops sentinel is free. Scale the crew only if TokenDam gets traction —
see the phased plan in the project notes.
