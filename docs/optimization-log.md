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

## Round 6 — 2026-07-28 · fresh 5-lens critique of the grown product

The product grew from 4 → 7 detectors + CI + diff + capture + fix-prompt across R2-R5 (all
pre-scoped), so a holistic critique army swept the whole thing. It cut deep — the dollar figures
are the moat, and several newer ones were individually wrong. Top concerns: per-finding $ on the
new detectors could exceed the whole trace cost 7-17×; the headline only stayed <100% via a blunt
clamp (real cross-detector overlap); and single-model pricing breaks on mixed-model traces (parked
as an L-effort rearchitecture). See Round 7 for what shipped.

## Round 7 — 2026-07-28 · fix the Round 6 correctness bugs (protect the moat)

Implemented the ship list; big rearchitectures (full token-level dedup, per-call mixed-model
pricing) parked. All are correctness/trust fixes — a linter whose numbers lie is worthless.

- **CI failing OPEN (#1, the scary one)** — the CLI read only ONE file, but `docs/ci.md` + the
  scaffolded GitHub Action use `traces/*.json` (shell-expanded to many). So a real CI gate saw only
  the first file and silently passed. Fixed: the CLI now aggregates all file args/globs into one
  trace (`toElements` + flatMap). (`cli.ts`)
- **modelOverkill cache-blind pricing (#3)** — it priced full input at the uncached rate, ignoring
  `cachedInputTokens`, so it could claim a saving 7× the trace cost. Now cache-aware for both
  current and target model. (`modelOverkill.ts`)
- **modelOverkill over-firing (#4)** — required only "short output" for non-reasoning models. Now
  needs an explicit simple-task hint (structured output / classify-extract-route prompt) for ALL
  models. (`modelOverkill.ts`)
- **CI gate punished good behavior (#5)** — `--fail-on low` failed the build on a zero-waste
  "caching already active" advisory. Now only findings with `wastedUSD > 0` can fail a gate. (`ci.ts`)
- **diff cross-model contradiction (#6)** — it warned "not comparable" yet still exited 1 on the
  model price gap. Now cross-model is neutral (verdict NOT COMPARABLE, exit 0). (`diff.ts`)
- **capture ESM dead path (#8)** — `installExitDump` used `eval("require")` (broken in ESM); now
  uses `beforeExit` with the async write. (`capture.ts`)

7 test suites green (added round7.test), typecheck clean.

## Round 8 — 2026-07-29 · positioning, principle, UI, legal, CI-into-dev-flow

Driven by four founder questions: (1) does the zero-upload principle limit the "reduce tokens"
mission? (2) make "detect vs actually-reduce" an option? (3) legal/privacy for a prod-touching
tool? (4) a cool-CLI UI + a UI/UX agent.

**Answers → decisions:** the zero-upload/read-only line is a *wedge & default*, not a religion —
reduction becomes an **opt-in tier** layered on measurement (tier 0 diagnose → tier 1 apply-in-your-
CI → tier 2 optional runtime proxy, self-hostable). We DON'T do gateway/routing/semantic-caching/
prompt-compression as runtime middleware (that's the proxy lane we deliberately avoid — it'd break
the trust moat); we DETECT + recommend instead (model-overkill = routing lens; bloated-context =
compression lens).

**Shipped:**
- **UI/UX designer added to the crew** → cool-terminal redesign (Vercel × Warp × Charm): JetBrains
  Mono, near-monochrome + teal accent + green-for-money, window-chrome panes, `~/agent $ tokendam
  analyze` shell action, report rendered as stdout (echo + box-drawn summary + `[HIGH]` linter rows),
  privacy claim promoted to a Warp-style status bar. (`index.html`, `style.css`, `main.ts`)
- **Legal (free zero-upload scope)** — `/privacy` + `/terms` pages (terminal-styled): privacy makes
  "nothing leaves your browser" a factual promise + honestly discloses the only 3rd parties (Vercel
  host, Google Fonts); terms = estimates-not-guarantees, no-warranty, liability limit, no provider
  affiliation. Linked from footer + status bar. (Templates — need a lawyer before launch/paid.)
- **CI into the dev flow (tier 1)** — `tokendam --ci --pr-comment` posts/updates a single PR comment
  with the audit + $/mo + pass/fail + the **fix pack**, via the GitHub Actions token. Deterministic,
  no LLM, never touches code. Plus a documented opt-in recipe: pipe the fix pack to your own coding
  agent in CI to auto-open a fix PR (brain=TokenDam, hands=your agent, keys/code never leave your
  runner). `tokendam init` scaffold + `docs/ci.md` updated. CLI `main()` is now async.
- **Deploy fixed** — Vercel cloud build was stuck; `npm run deploy` (local `vercel build` +
  `vercel deploy --prebuilt`) bypasses it reliably. Git left disconnected for now.

7 test suites green, typecheck clean, deployed to tokendam.dev, pushed.

## Round 9 — 2026-07-29 · toward the autonomous-agent era

Founder directive: build toward a future where agents work 24/7 and self-evolve. Reframe: in that
world, tokens are the dominant operating cost and self-throttling is a core agent organ — so
TokenDam should become **agent-native infrastructure** and **self-evolving**, while staying
efficient *and* auditable (autonomy needs oversight — the approve-gate is the alignment guardrail).

**Shipped:**
- **MCP server (`tokendam mcp`)** — `src/mcp.ts`, a minimal stdio JSON-RPC MCP server exposing
  `analyze_trace` / `fix_prompt` / `token_diff`. An autonomous agent adds it to its MCP config and
  runs TokenDam **on itself in its own loop**: measure my waste → get the fix → self-adjust →
  `token_diff` to verify I got cheaper. Local, deterministic, zero-upload. `tokendam mcp` subcommand
  + `tokendam-mcp` bin; `docs/mcp.md`. Full protocol test (initialize→tools/list→tools/call).
- **Self-evolution: detector-R&D agent** — `api/detector-rnd.js`, a dormant standing scientist that
  weekly scans LLM-efficiency signal (HN + its own knowledge) and DRAFTS new-detector proposals
  (trigger heuristic + savings formula + false-positive analysis) for human approval. The tool's
  detector set grows over time without a human hunting patterns; the approve-gate keeps it aligned.
  Added to the crew (now PM + CTO + R&D + ops).

8 test suites green (added mcp.test), typecheck clean.

**Roadmap toward the vision:** ② make the self-optimization loop itself autonomous (scheduled
critique→propose→verify→human-approve, compounding the knowledge base) · ③ continuous monitoring
(ingest an agent's ongoing traces, learn its patterns) · a "token self-awareness" SDK an agent wraps
its own client with. Guardrail throughout: autonomous discovery/proposal, human-approved shipping.

## Round 10 — 2026-07-29 · clear the correctness debt before autonomizing

Founder call: fix the mixed-model pricing hard bug BEFORE making the loop autonomous (an autonomous
system must not run on wrong numbers). Plus two requested features.

- **③ Mixed-model pricing (the hard bug) — FIXED.** `analyze` used ONE price (majority model) for
  the whole trace, so a mixed trace (cheap classifier + expensive agent) was wrong by up to ~19×.
  Now every `NormCall` carries its OWN `price` (resolved at normalize time), and all 7 detectors +
  totalUSD price per-call. `report.model` shows "mixed (N models)" with a per-model note. Test: a
  gpt-4o-mini + claude-opus trace now costs $0.0076 (opus dominates) vs $0.00015 all-mini.
- **① Structured fix plan.** `renderFixPlan(report)` → machine-readable JSON {summary, steps[]} for
  a CI coding-agent to consume programmatically; CLI `--fix-prompt --format json`.
- **② duplicate-requests detector (the Q2 gap).** Detects the SAME request (ignoring the static
  system prompt) sent more than once → a response-cache opportunity; prices the whole repeat call
  (input+output) per its own model. `secondary` (overlaps per-call findings). Now **8 detectors.**
  We diagnose the semantic-cache opportunity; we don't cache for you (that's a runtime proxy).

8 test suites green, typecheck clean. npm publish dry-run verified (23 files = dist + README only).

**Parked (need bigger work):** full token-level cross-detector dedup (headline is a clamped floor, not
additive) · reasoning-token disjoint-usage pricing · surface `secondary` findings as a distinct
"model-selection opportunity" line · web "put it in CI" section · **npm publish** (needs owner
go-ahead — it's outward-facing/public while the project is pre-launch & private).

## Round 11 — 2026-07-31 · fresh 5-lens critique of the unlogged P0/P1 batch (8 → 12 detectors)

The P0/P1 work (Effective Tokens / wasteRate, per-agent attribution + cost tree, Token P&L one-pager,
+4 detectors) grew the tool past Round 10 without a holistic critique. A full 5-critic army (LLM-infra
correctness · adversarial break-it · product · target-user · positioning) read the real code + ran the
tool on adversarial traces. They **independently converged** on the same class of bug that has recurred
every round: **the newest detectors' dollar figures are the moat, and the newest ones were wrong** — a
single finding claimed **152% of a trace's real cost**. Prioritized through the CI-gate north star (an
accurate + fail-safe gate) and the trust moat ("a linter whose numbers lie is worthless").

**Shipped (3 correctness/trust fixes, on `selfopt/2026-07-31`):**
- **Cache-blind pricing in the 4 new detectors (the moat bug, back again)** — `agentLoopWaste`,
  `batchOpportunity`, `semanticCache`, `stepCostOutlier` priced input at the full rate, ignoring
  `usage.cachedInputTokens`, so on a heavily-cached trace a finding read **$0.045 waste on a $0.030
  trace (152%)**. Added shared cache-aware `inputUSD`/`callUSD` helpers to `pricing.ts` (mirroring the
  correct `modelOverkill`/`analyze` per-call, cache-aware math) and routed all four detectors through
  them. No finding's `wastedUSD` can now exceed the call's real billed cost. (`pricing.ts`,
  `detectors/{agentLoopWaste,batchOpportunity,semanticCache,stepCostOutlier}.ts`)
- **`extractMeta` fabricated `agentId` from a generic `name`/`node` (`normalize.ts:305`)** — a plain
  trace whose elements carry a benign `name` (e.g. `"chatCompletion"`) minted an agentId on every call,
  triggering a phantom "Agent X ran 5× — runaway loop" + a bogus per-agent cost tree on ordinary
  single-model traces (the *common* case, since raw OpenAI/Anthropic bodies carry no agent identity).
  Now only EXPLICIT identity (`langgraph_node` / `meta.agentId` / `meta.agent` / `el.agentId` /
  `el.agent`) attributes; generic `name`/`node` no longer do.
- **Effective-Tokens / one-pager honesty** — (a) "X% of tokens **did no real work**" was falsifiable in
  30s (those tokens are the system prompt/tools the model needs every call — repriceable via caching,
  not dead); reworded to "avoidable or **repriceable** overhead" across CLI/one-pager/web. (b) The
  one-pager said "already optimized" only when `findings.length === 0`, so a single $0 advisory flipped
  a clean workload into "found 1 source of waste … $0.00000/month" — now gated on `savableUSD <= 0`.
  (c) `stepCostOutlier` used the upper-middle element as the median and priced cache-blind, so a trace
  with trivially-cheap calls read "81× the median" on a normal call — now a true even-length median,
  cache-aware, with a $0.00001 baseline floor. (`format.ts`, `onePager.ts`, `web/main.ts`,
  `detectors/stepCostOutlier.ts`)

13 test suites green (added `round11.test`: cache-aware `wastedUSD ≤ totalUSD`, plain-trace-`name` →
no phantom agent, $0-advisory → "already optimized"), `tsc --noEmit` clean. Branch only — not merged,
not deployed.

**Needs human review (strong convergence, deliberately NOT auto-shipped — higher-risk or a founder call):**
- **`duplicateRequests` is unconditionally `secondary` → the CI gate FAILS OPEN** on a 95%-duplicate
  trace (exits 0, prints "$0 recoverable"). The scariest gate-safety hole, but the safe fix needs
  careful per-call de-overlap with unusedCache — do it deliberately, before any publish. (`duplicateRequests.ts:79`)
- **Positioning: the whole Token-P&L story is invisible where it sells.** README lists **8** detectors
  (built 12); `docs/launch.md`/PH says **6**; `pricing.html` says "8 checks"; the hero + the hosted
  PR-comment (`renderMarkdown`, `api/github/webhook.js`) omit Effective Tokens + the per-agent tree —
  so the strongest, already-built asset is only visible *after* a dev has converted. Critic 5's exact
  rewrite ("**a CI cost-gate + Token P&L for AI agents**") + updated hero/description are ready to apply.
- **The CI gate is an absolute 25% budget, not a baseline/regression diff** (`ci.ts:21`), so it can
  fail an honest build on first adoption; the real `diff` command isn't what `--ci`/the scaffold uses.
- **Per-agent attribution has no real input** — both shipped examples carry zero agent identity, so the
  flagship cost tree/loop detector never demo. Ship a `langgraph-agent.json` example + let `tap` tag `agentId`.
- **Stale `dist/`** (documented `npx tokendam` path lacks the new metrics) + **dead `tokendam.dev`
  links** in the CLI/one-pager footers (product is `tokendam.vercel.app`).

**Parked (precision round):** `batchOpportunity` empty-system-prompt collision (system-less calls group
as one bulk job) · `semanticCache` false-positive on load-bearing numeric diffs (777 vs 999) · a
`bloatedContext` hard 3000-tok cliff + no cross-call duplicate-document detection + `unusedCache`
requiring an all-calls-identical prefix (misses per-agent caching) — a false "no waste" on realistic
multi-agent traces.

## Round 11b — 2026-07-31 · shipped the Round 11 "needs human review" list (founder-approved)

The founder approved the Round 11 backlog; merged `selfopt/2026-07-31` → `main` (P0/P1 + Round 11) and
shipped the review items:
- **`duplicateRequests` fail-open FIXED** — was unconditionally `secondary`, so the CI gate passed a
  95%-duplicate trace with "$0 recoverable" (fail-open). Now **primary** + cache-aware (`callUSD`); on
  the dangerous case (pure duplicates, no cacheable prefix) it's the sole non-overlapping claim, and
  elsewhere the analyze-layer 90% cap keeps the headline a bounded floor. Test: a 20× identical-call
  trace now **fails** the gate (exit 1), `savableUSD ≤ totalUSD`. (Follow-up: precise per-call-index
  de-overlap with `unusedCache`.)
- **PR comment carries the Token P&L** — `renderMarkdown` now renders the **Effective Tokens** line +
  a **Cost-by-agent** table, so the finance-grade story lands on GitHub where a team converts (was
  CLI/web/PDF-only). (`ci.ts`)
- **Positioning repositioned** across all acquisition surfaces — README/`launch.md`(PH)/`pricing.html`
  /hero now say **12 detectors** and lead with "**a CI cost-gate + Token P&L for AI agents**" (was
  "a linter", 6–8 detectors); anti-proxy trust line preserved; "we flag, you implement" kept for the
  batch/semantic-cache opportunities. (`README.md`, `docs/launch.md`, `public/pricing.html`, `index.html`)
- **Flagship per-agent feature now has a real demo input** — `examples/langgraph-agent.json`
  (supervisor → researcher×5 → writer, `langgraph_node` identity) fires the cost-by-agent tree +
  `agentLoopWaste`, which the two shipped examples never could.
- CLI footer + one-pager point to **`tokendam.dev`** — the canonical live site (verified live during the
  X/Reddit engagement patrol; an earlier "pending purchase" note was stale, so a mid-round change to
  `tokendam.vercel.app` was reverted). `dist/` is git-ignored (rebuilt at publish).

13 suites green (added the fail-open test to `round11.test`), `tsc --noEmit` clean, committed to `main`.
Still open for a founder call: the CI gate is an absolute 25% budget (a baseline/regression-diff default
would be friendlier on first adoption); rebuild + `npm publish` when ready.

## Round 12 (autonomous) — 2026-09-13

Multi-lens critique (correctness · adversarial · product/target-user) of `src/core/pricing.ts`,
`src/core/normalize.ts`, and all 12 detectors. Zero prior-round items re-raised; reading from Round 11b
log state.

**FOUND:**
- `claude-sonnet-5` introductory pricing ($2/$10) expired 2026-08-31 per the in-code comment; any Sonnet 5
  trace since then shows costs 33% too low — the accuracy moat's most obvious current gap.
- `detectVendorFromModel` (normalize.ts) matched only `o1`/`o3` prefixes for the OpenAI o-series; `o4-mini`
  and `o4` returned vendor `"unknown"` instead of `"openai"` (cosmetic display bug in report header).
- `uncompactedHistory` and `duplicateSubstring` priced the savings at `call.price.cachedInput` when ANY call
  in the trace had a `hasCacheMarker`. The targeted content (old history turns / user-message duplicates) is
  always in the dynamic, uncached portion of the prompt — billed at the full `input` rate. Using the cached
  rate under-reports waste by 10× on Anthropic/DeepSeek traces where users already have caching active.

**FIXED ON BRANCH (`selfopt/2026-09-13`):**
1. **Sonnet 5 pricing** (`pricing.ts`) — updated to $3/$15/$0.30 (standard Sonnet 4.x tier), bump `PRICES_AS_OF` to 2026-09-13.
2. **o4 vendor detection** (`normalize.ts`) — replaced `m.startsWith("o1") || m.startsWith("o3")` with the
   `/^o[0-9]/` regex already used in `reasoningTokenWaste.ts` and `modelOverkill.ts`; covers o4/o5/future.
3. **`uncompactedHistory` + `duplicateSubstring` cache-blind pricing** — always use `call.price.input` for
   dynamic content; removed the unused `cached` variable from `duplicateSubstring.ts`.

14 test suites green (added `round12.test`: Sonnet 5 price, o4 vendor, full-rate savings on cached traces),
`tsc --noEmit` clean. Branch only — not merged, not deployed.

**NEEDS HUMAN REVIEW:**
- Confirm Sonnet 5 is indeed now at $3/$15 — verify at platform.claude.com/docs pricing before merging if
  there's any doubt (the code comment was the source for the expiry date).

**PARKED (carry-over):**
- CI gate is an absolute 25% budget; a baseline/regression-diff default would be friendlier on first
  adoption — medium-effort rearchitecture.
- `batchOpportunity` empty-system-prompt collision (all no-system calls to same model grouped as one job).
- `semanticCache` is `secondary` → excluded from headline; `duplicateRequests` overlap de-duplication.
- Full token-level cross-detector dedup (headline is a floor, not additive).
- `bloatedContext` cliff at 3000 tok + no cross-call duplicate-document detection.
- `unusedCache` all-calls-identical prefix requirement (misses per-agent caching in multi-agent traces).
- npm publish (needs owner go-ahead — pre-launch).
