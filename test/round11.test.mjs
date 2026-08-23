// Round 11 (autonomous) — 2026-08-23
// Tests for the three correctness/UX fixes in this round.
import { analyze } from "../src/core/analyze.ts";

let failed = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`); if (!c) failed++; };
const has = (r, id) => r.findings.find((f) => f.detector === id);

// --- Fix 1: detectVendorFromModel now covers all o-series (o4+, not just o1/o3) ---
{
  const r = analyze([{
    model: "o4-mini",
    messages: [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }]);
  ok("o4-mini vendor is openai, not unknown", r.vendor === "openai", `→ got "${r.vendor}"`);
}

// Smoke: vendor detection still correct for a non-o-series model
{
  const r = analyze([{
    model: "gpt-4o",
    messages: [{ role: "user", content: "hello" }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }]);
  ok("gpt-4o vendor is openai", r.vendor === "openai", `→ got "${r.vendor}"`);
}

// --- Fix 2: duplicate-requests wastedUSD deducts cached tokens ---
// Two identical requests where usage reports cachedInputTokens.
// The wastedUSD for the duplicate should be lower than if no caching were reported.
const dupMsg = "classify the following review as positive or negative: " + "really great product ".repeat(30);
const buildDupTrace = (cachedInputTokens) => [
  {
    model: "gpt-4o",
    messages: [{ role: "user", content: dupMsg }],
    usage: { prompt_tokens: 500, completion_tokens: 20 },
  },
  {
    model: "gpt-4o",
    messages: [{ role: "user", content: dupMsg }],
    usage: { prompt_tokens: 500, completion_tokens: 20, prompt_tokens_details: { cached_tokens: cachedInputTokens } },
  },
];

{
  const uncached = analyze(buildDupTrace(0));
  const cached   = analyze(buildDupTrace(400)); // 400 of 500 input tokens served from cache
  const fUncached = has(uncached, "duplicate-requests");
  const fCached   = has(cached,   "duplicate-requests");
  ok("duplicate-requests fires on repeated request", !!fUncached);
  ok("duplicate-requests wastedUSD is lower when cached tokens reported",
    !!fCached && fCached.wastedUSD < fUncached.wastedUSD,
    fCached ? `${fCached.wastedUSD.toFixed(6)} < ${fUncached?.wastedUSD?.toFixed(6)}` : "(finding absent)");
}

// Edge: fully cached duplicate → wastedUSD is zero (cache-hit rate is non-zero but cheaper)
{
  const fully = analyze(buildDupTrace(500));
  const f = has(fully, "duplicate-requests");
  // With 500/500 cached tokens, wastedUSD uses cachedInput rate for all input tokens.
  // It won't be exactly 0 (output tokens + cachedInput rate still apply), but it must be
  // strictly less than the uncached equivalent.
  const uncached = analyze(buildDupTrace(0));
  const fUncached = has(uncached, "duplicate-requests");
  ok("duplicate-requests wastedUSD fully cached < uncached",
    !!f && !!fUncached && f.wastedUSD < fUncached.wastedUSD,
    f ? `${f.wastedUSD.toFixed(6)} < ${fUncached?.wastedUSD?.toFixed(6)}` : "(finding absent)");
}

console.log(failed ? `\nFAILED (${failed})` : "\nALL ROUND 11 CHECKS PASSED");
process.exit(failed ? 1 : 0);
