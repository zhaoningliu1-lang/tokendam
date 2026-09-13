// Round 12 autonomous self-optimization — regression tests for the 3 fixes.
import { analyze } from "../src/core/analyze.ts";
import { priceFor } from "../src/core/pricing.ts";

let failed = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`); if (!c) failed++; };

// --- Fix 1: claude-sonnet-5 pricing now at $3/$15 (introductory period expired) ---
{
  const { price, matched } = priceFor("claude-sonnet-5");
  ok("claude-sonnet-5 is matched in price table", matched);
  ok("claude-sonnet-5 input price is $3/M (not the old $2/M)", price.input === 3,
    `got ${price.input}`);
  ok("claude-sonnet-5 output price is $15/M (not the old $10/M)", price.output === 15,
    `got ${price.output}`);
  ok("claude-sonnet-5 cachedInput price is $0.30/M", price.cachedInput === 0.3,
    `got ${price.cachedInput}`);
}

// Verify totalUSD reflects updated pricing. Use a usage-only (no messages) call
// so the analyzer falls back to reported usage counts, not token estimation.
{
  const r = analyze([{
    model: "claude-sonnet-5",
    messages: [],        // no messages → computed=0 → falls back to usage.inputTokens
    usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
  }]);
  // $3 input + $15 output = $18 per 1M tokens each
  ok("claude-sonnet-5 totalUSD uses new $3/$15 pricing", Math.abs(r.totalUSD - 18) < 0.01,
    `totalUSD=${r.totalUSD.toFixed(2)} (expected 18.00)`);
}

// --- Fix 2: o4 family now detected as vendor "openai" ---
{
  const r = analyze([{
    model: "o4-mini",
    messages: [{ role: "user", content: "classify this" }, { role: "assistant", content: "positive" }],
    usage: { prompt_tokens: 50, completion_tokens: 5 },
  }]);
  ok("o4-mini vendor is 'openai' not 'unknown'", r.vendor === "openai",
    `got vendor="${r.vendor}"`);
}
{
  const r = analyze([{
    model: "o4",
    messages: [{ role: "user", content: "solve this" }, { role: "assistant", content: "ok" }],
    usage: { prompt_tokens: 50, completion_tokens: 5 },
  }]);
  ok("o4 vendor is 'openai'", r.vendor === "openai", `got vendor="${r.vendor}"`);
}
// Existing o3/o1 must still work.
{
  const r = analyze([{
    model: "o3-mini",
    messages: [{ role: "user", content: "q" }, { role: "assistant", content: "a" }],
    usage: { prompt_tokens: 20, completion_tokens: 3 },
  }]);
  ok("o3-mini vendor still 'openai'", r.vendor === "openai", `got "${r.vendor}"`);
}

// --- Fix 3a: uncompactedHistory prices old turns at full input rate, not cachedInput ---
// A growing 3-call trace with a cache_control marker on the system prompt.
// Old history tokens must be priced at call.price.input, not call.price.cachedInput.
{
  const sys = "You are a helpful assistant. " + "context ".repeat(200);
  // Each message ≈ 380 tokens; 6 old messages × 380 tok ≈ 2280 tok > 2000 threshold.
  const makeMsg = (n) => Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `turn ${i} content: ${"word ".repeat(360)}`,
  }));
  // 3 calls with growing history: 4, 8, 14 messages.
  const trace = [
    { model: "claude-sonnet-5", system: [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }],
      messages: makeMsg(4) },
    { model: "claude-sonnet-5", system: [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }],
      messages: makeMsg(8) },
    { model: "claude-sonnet-5", system: [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }],
      messages: makeMsg(14) },
  ];
  const r = analyze(trace);
  const uc = r.findings.find(f => f.detector === "uncompacted-history");
  ok("uncompacted-history fires on growing trace with cache marker", !!uc, !!uc ? "" : "no finding");
  if (uc) {
    // wastedUSD should be priced at input rate ($3/M for sonnet-5, not $0.3/M)
    // At least some old turns exist; the ratio input/cachedInput = 10x for sonnet-5.
    // If pricing were at cachedInput, wastedUSD would be 10x smaller.
    // We check that wastedUSD > 0 and is NOT tiny (not at cachedInput rate).
    // Old turns: call 2 has 0 old (8 msgs ≤ RECENT_WINDOW=8), call 3 has 6 old msgs.
    // Each old message ≈ 50+2 tokens * 0.7 compact * $3/M — verify it's at full rate.
    const approxOldTok = uc.wastedTokens; // COMPACT_RATIO * oldTokens
    const rateAtCached = 0.3 / 1_000_000;  // $0.3/M for sonnet-5 cached
    const rateAtFull   = 3.0 / 1_000_000;  // $3/M for sonnet-5 full
    // wastedUSD should be ≈ approxOldTok / COMPACT_RATIO * COMPACT_RATIO * full_rate
    // = approxOldTok * full_rate
    const expectedAtCachedRate = approxOldTok * rateAtCached;
    ok("uncompacted-history wastedUSD uses full input rate (not cachedInput)",
      uc.wastedUSD > expectedAtCachedRate * 3, // clearly above the cached-rate estimate
      `wastedUSD=${uc.wastedUSD.toFixed(6)} expectedIfCached≈${expectedAtCachedRate.toFixed(6)}`);
  }
}

// --- Fix 3b: duplicateSubstring prices duplicate content at full input rate ---
{
  const doc = Array.from({ length: 80 }, (_, i) =>
    `In fiscal period ${i}, the ${["north","south","east","west"][i%4]} region reported ` +
    `${i*7+3} units at margin ${(i%9)+2}.${i%10}%, driven by ${"retail wholesale online partner".split(" ")[i%4]} demand.`
  ).join(" ");
  // Cached system prompt + duplicate doc in user message.
  const trace = [{
    model: "claude-sonnet-5",
    system: [{ type: "text", text: "Analyze reports.\n" + doc, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: "Summarize:\n" + doc }],
  }];
  const r = analyze(trace);
  const ds = r.findings.find(f => f.detector === "duplicate-substring");
  ok("duplicate-substring fires on cached trace with duplicate doc", !!ds);
  if (ds) {
    // With the fix, wastedUSD is priced at input rate ($3/M for sonnet-5).
    // If still using cachedInput rate ($0.3/M), the result would be 10x smaller.
    // The duplicate doc is ≈ 600+ tokens; wastedUSD ≥ 600 * 0.9 * 3 / 1M ≈ $0.0016.
    ok("duplicate-substring wastedUSD uses full input rate (not cachedInput)",
      ds.wastedUSD > 0.001,
      `wastedUSD=${ds.wastedUSD.toFixed(5)}`);
  }
}

console.log(failed ? `\nFAILED (${failed})` : "\nALL R12 CHECKS PASSED");
process.exit(failed ? 1 : 0);
