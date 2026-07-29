# TokenDam — self-optimization log

A compounding ledger, modeled on the Khotan self-improvement cycle. Each round:
adversarial multi-lens critique (read real code + live site) → synthesized,
scored backlog → implement the high-leverage items → verify → record here so the
next round builds on this one instead of repeating it.

Loop: `Critique (5 lenses) → Synthesize (rank by impact ÷ effort) → Implement → Verify → Log → next round`

---

<!-- Rounds are appended below, newest last. -->

## Round 1 — 2026-07-28 · lens: correctness & honesty (commercial: CI-gate)

5 critics (LLM-infra eng, adversarial staff eng, product, target-user, positioning) read the
real code + live site. They **independently converged** on the same core issue: the headline
and per-finding dollar figures — the whole value prop — were the numbers that broke under a
knowledgeable dev's scrutiny. Prioritized through the CI-gate north star (a build-failing gate
must be accurate) + the "toy→tool" lever.

**Shipped (7):**
1. **JSONL/stdin ingestion was dead code** — both entry points `JSON.parse`d before `analyze()`, so the advertised `cat trace.json | tokendam` + JSONL path never ran. Now: try JSON, else pass the raw string to `normalize()`. (`cli.ts`, `web/main.ts`)
2. **Frontier reasoning models were missing from the price table** — the flagship reasoning detector named gpt-5/o3/o4-mini but they hit `FALLBACK_PRICE` ($12/1M), fabricating the headline $. Added gpt-5(+mini/nano), o3, o4-mini, gemini-2.5 with real prices + cache rates + a `PRICES_AS_OF` stamp. (`pricing.ts`)
3. **Reasoning-detector honesty** — when the reasoning estimate is synthesized (no usage data), it now caps severity at **low** and shows **$0** ("estimated — no usage data") instead of a confident fabricated dollar figure; gated "uncontrolled" to models that actually have an effort knob; fixed deepseek-reasoner advice (route to deepseek-chat). (`reasoningTokenWaste.ts`)
4. **Reasoning tokens counted toward output cost** so no finding can save more than the trace costs. (`analyze.ts`)
5. **Production-scale projection** — `perCallSavableUSD` on the Report; web shows an interactive "N calls/day → $/month saved"; CLI shows `$/call · at N calls/day ≈ $/month` + `--calls-per-day`. The biggest toy→tool lever. (`types.ts`, `analyze.ts`, `web/main.ts`, `format.ts`, `cli.ts`)
6. **redundant-tools noise** — now requires multi-call/observed-tool-use evidence before firing (no false alarm on a single request body), and is marked `secondary` so its tokens (already counted in unused-cache's prefix) are **excluded from the headline sum** → top-line is now a conservative floor. (`redundantTools.ts`, `types.ts`, `analyze.ts`)
7. **Positioning** — hero reframed around the read-only / zero-integration wedge ("see where your agent burns tokens — without a proxy") + a "How this fits" competitor table (TokenDam vs proxies/gateways). (`index.html`, `style.css`)

Effect: agent-example headline $0.041(59%)→$0.036(51%) — the drop is the removed double-count.
All tests green (detectors/formats/web-smoke), typecheck clean, redeployed.

**Deferred to later rounds:** #6 price cached-input tokens (fix "spend as-is" + unused-cache on
already-cached OpenAI traces) · #9 content-aware bloated-context trimmable fraction · #10 teaching
empty/single-call state · #11 full token-level dedup across detectors (range, not point) · **#12 CI
mode (`--ci --max-waste`, non-zero exit, PR-comment/Markdown)** — the commercial payment surface,
park for a workflow-focused round · #13 unused-cache severity by share-of-spend · #14 bare
usage-only record + CJK caveat · #15 cache write-premium + TTL range.

## Round 2 — 2026-07-28 · theme: the commercial surface (CI gate) + cached-token honesty

Scope was pre-decided (no critique army needed): ship the two highest-value deferred items and
**adversarially verify** what was built (the right agent use for a scoped round).

**Shipped:**
- **Cached-token pricing (#6a)** — `analyze.ts` now prices each call as `(in−cached)·input + cached·cachedInput + out·output` using `usage.cachedInputTokens`, so "spend as-is" is right for traces that report cache hits (previously overcounted all input at full rate).
- **Cache-aware unused-cache (#6b)** — the detector now reads observed cache-read tokens: if usage shows the prefix is already ≥80% served from cache (e.g. OpenAI auto-caching, no marker), it stops billing "waste" and flips to the "verify coverage" advisory; partial caching discounts the estimate. No more telling already-cached users to "add caching."
- **CI gate (#12) — the paid surface prototype.** New `src/core/ci.ts`: `evaluateCi(report, cfg)` → pass/fail + exit code, plus `renderMarkdown` (PR comment / share) and `renderGithub` (`::error::` annotations). CLI: `--ci --max-waste <pct> --max-waste-per-call <usd> --fail-on <sev> --format human|markdown|github|json`, reads `.tokendam.json`. Exit codes 0/1/2. Docs: `docs/ci.md` (GitHub Action snippet) + `.tokendam.example.json`.
- **Web** — "Copy audit as Markdown" button (same output as `--format markdown`), for pasting into a PR/issue.

**Adversarial verify (1 agent):** confirmed the two pricing/detector changes are **correct** (no double-discount, `savableUSD ≤ totalUSD`, no negatives). Found + fixed 3 CLI robustness bugs, the worst being **FAIL-DANGER**: an invalid `--fail-on` value silently emptied the severity list and let the gate PASS — the opposite of a safety gate. Now all bad flags hard-error (exit 2); flag values matched by index (a file named like a flag value isn't eaten); `NaN` budgets rejected. A CI gate must fail safe.

All 4 test suites green (detectors/formats/ci/web-smoke), typecheck clean, redeployed.

**Still deferred:** #9 content-aware bloat fraction · #10 teaching single-call state · #11 full
token-level dedup (range) · #13 severity by share-of-spend · #14 CJK caveat · #15 cache
write-premium/TTL range · **NEW: real `tokendam init` + capture helper**, and a hosted PR-comment
GitHub App (the actual SaaS packaging) once the gate proves useful.

## Round 3 — 2026-07-28 · theme: close the loop — hand fixes back to the user's coding agent

The value chain is: ① get the trace out → ② diagnose → ③ apply the fix. We had ①/② but ③ was
human-only ("here's written advice, go edit"). Round 3 builds ③ as a **fix pack**: TokenDam is the
brain (precise diagnosis + instructions), the user's own coding agent (Claude Code/Cursor) is the
hands (it has their code; it applies the change). We never see their codebase — trust intact.

**Shipped:**
- `src/core/fixPrompt.ts` — `renderFixPrompt(report)` turns findings into a paste-ready prompt for a coding agent: goal + guardrails ("cost only, keep behavior identical, minimal diff, ask before output-changing edits") + numbered fixes (title + fix + exact evidence like the tool names to delete) + projected $/mo motivation. Skips the "already caching — good" advisory (not a fix); clean "nothing to fix" on a lean trace.
- **CLI**: `--fix-prompt` emits the pack.
- **Web**: primary "Copy fix prompt →" button (+ the existing "Copy audit as Markdown"), with a flash telling the user to paste it into Claude Code / Cursor.

This is the concrete mechanism behind the chosen payment point (auto-fix→apply): in the free tool
the user copies the pack; in the paid CI gate the same pack becomes an auto-generated PR (CI runs in
their repo, so it can actually edit code). Zero-upload holds throughout — the fix is always applied
by *their* agent, not ours.

All 4 suites green, typecheck clean, redeployed. Domain: `tokendam.dev` looks available; Vercel
(correctly) blocks agents from purchasing — user completes it interactively.

## Round 4 — 2026-07-28 · theme: kill the capture friction (step ①)

The whole loop is worthless if users can't get their trace out. Step ① was the biggest friction.
This round makes it a one-liner and teaches it in-product.

**Shipped:**
- **Capture helper** `src/capture.ts` (shipped as `tokendam/capture`): `tap(requestArgs)` records a deep copy and returns the args unchanged (drops into any SDK call, zero behavior change); `getTrace()`/`writeTrace(path)`/`resetTrace()`; `wrapFetch()` captures OpenAI/Anthropic bodies with zero call-site edits; `installExitDump()`. Added `exports` map (`.` and `./capture`).
- **`tokendam init`** — scaffolds `.tokendam.json` (budget) + `traces/.gitkeep` + `.github/workflows/tokendam.yml`, and prints the capture snippet. One command to be CI-ready.
- **Web teaching state** — when the user pastes ONE call, a banner explains that cross-call waste (caching/history/duplicates) needs several calls, with a copy-paste `tap` snippet. Removes the "it found nothing / it's weak" bounce.
- **In-app guide + README** now lead with the capture helper (then the manual `console.log` fallback).

5 test suites green (added capture.test), typecheck clean, redeployed.

**Next candidates:** hosted PR-comment GitHub App (real SaaS packaging) · npm publish so
`npx tokendam` + `tokendam/capture` actually resolve · demo GIF + GitHub push (launch prep) ·
detector-precision round (#9/#11/#13/#14/#15).

## Round 5 — 2026-07-28 · theme: answer "why not just a one-line LLM?" with product

Two strategic questions drove this round. **Q1 (moat):** a one-line LLM gives an *opinion*; we
give a *measurement* — exact tokenizer × current price = a trustworthy dollar figure, the same
answer every time, free, local, and CI-enforceable ("ESLint, not ask-an-AI"). **Q2 (gaps vs the
research):** the biggest missing lever was **model selection** (using a flagship for a simple task —
10-20× price gap, often > any prompt-side saving). Built into both.

**Shipped:**
- **model-overkill detector** (`src/core/detectors/modelOverkill.ts`) — flags a flagship model
  (Opus/GPT-4o/GPT-5/o3) on a simple task, suggests the cheaper sibling, and prices the delta.
  `secondary` (different lever than token-cutting, kept out of the headline floor); heavy "A/B the
  quality first" framing. We DETECT + recommend; we never route (that's a proxy's job — Q2 boundary).
- **`tokendam diff <before> <after>`** (`src/core/diff.ts`) — deterministic before/after cost
  regression with an exit code. The thing a one-line LLM can't do: repeatable, exact, CI-gateable
  ("did this PR make token cost worse?"). Verdict improved/regressed/unchanged.
- **Positioning** — a "Why not just ask an LLM 'where am I wasting tokens?'" section on the site
  (measurement vs opinion; ESLint analogy).

**Adversarial verify (1 agent):** math/keys/`secondary` all confirmed correct. Found + fixed 3
false-positive bugs — the exact thing that would kill the "trustworthy, no false positives" moat:
(1) reasoning models (o1/o3) flagged via the short-output path — short answers are normal for hard
reasoning, so now they need an explicit simple-task hint; (2) heavy agent calls (tools + long output)
qualifying via `structuredOutput`/keyword alone — now short-output + not-heavy is required; (3) `diff`
gave a confident verdict across DIFFERENT models — now flagged `crossModel` with a "not comparable"
warning. Regression tests added for all three.

6 test suites green, typecheck clean, redeployed, pushed to GitHub.
