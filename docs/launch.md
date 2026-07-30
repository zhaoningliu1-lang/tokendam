# TokenDam — launch notes (Product Hunt)

Live: https://tokendam.vercel.app · CLI: `npx tokendam`

## Name check (2026-07-28)

- **npm**: `tokendam`, `token-dam`, `@tokendam/core` all 404 → **name is free to publish**.
- **Web/product**: zero exact hits for "TokenDam" / "Token Dam" — no existing product,
  company, or crypto token by the name.
- Only faint proximity: `TokenD` (tokend.io — enterprise blockchain tokenization) and DeFi
  "DAM" tokens. Different string, different space — **not a real conflict**.

## Tagline options (<60 chars)

1. A linter for your LLM token spend.
2. Paste a trace. See where your agent burns money.
3. Find wasted tokens. Nothing leaves your browser.
4. Your agent is leaking $. Here's the line item.
5. Stop resending the same 2k-token prompt at full price.
6. Token waste, in dollars, with the fix. Zero upload.
7. The $ your agent wastes on every call — quantified.
8. 100% in-browser. We never see your prompts.

## PH description

> TokenDam is a linter for your LLM token spend: paste an OpenAI or Anthropic trace and it
> flags where your agent is burning money — uncached static prefixes, bloated context,
> redundant tools, duplicated content, ever-growing history, and unbudgeted reasoning tokens —
> each with a dollar estimate and a concrete fix. It runs 100% in your browser (or as a local
> CLI via `npx tokendam`), so nothing is ever uploaded. Built for teams running agents in
> production who suspect their token bill is bigger than it should be.

## First comment (founder note, draft)

> I kept staring at agent bills that felt too high but couldn't see *why*. Turns out the waste
> is boringly consistent: the same 2–3k-token system prompt resent at full price every call, a
> whole scraped page dumped into context, 30 MCP tools the model never touches. TokenDam reads
> a trace and points at each one with a dollar figure and a fix. It's fully client-side — your
> prompts never leave the tab — and source-available (FSL-1.1-MIT). Would love to know what waste it finds
> in *your* traces.

## Detectors (what it catches)

1. **Unused prompt cache** — static prefix resent uncached (biggest lever)
2. **Bloated context** — oversized page/file/API dumps
3. **Redundant tools** — tool/MCP schemas defined but never called
4. **Uncompacted history** — growing agent history resent every turn
5. **Duplicate content** — same doc pasted more than once in a call
6. **Reasoning-token waste** — uncontrolled hidden reasoning spend on reasoning models

## Reads (paste any of)

OpenAI / Anthropic request bodies · LangSmith runs · Langfuse observations ·
OpenAI Batch output · Vercel AI SDK (onFinish + UIMessage[]) · generic {request,response}
JSONL · OpenAI Usage Admin API.

## Pre-launch checklist

- [ ] Eyeball the live site on desktop + mobile (guide, examples, a real paste)
- [ ] Record a 20–30s GIF: paste example → report → dollar number
- [ ] Publish repo to GitHub (README already written) + verify `npx tokendam` after `npm publish`
- [ ] Decide handle/name final; grab tokendam.dev domain if wanted (optional — .vercel.app is fine)
- [ ] Ship the standing-agents fleet dormant (already deployed) — optionally switch on PM/CTO
- [ ] Schedule PH launch (Tue–Thu tend to be busier); prep the first comment above
