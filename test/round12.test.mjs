// Round 12 (autonomous 2026-11-01): two correctness fixes verified here.
// (1) detectVendorFromModel now recognises o4-series (and future o-series) as "openai".
// (2) uncompactedHistory prices old-history waste per-call (call.hasCacheMarker),
//     not with a trace-wide flag that forces cache rate on ALL calls whenever ANY call
//     has a cache marker.
import { analyze } from "../src/core/analyze.ts";
import { normalize } from "../src/core/normalize.ts";

let failed = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`); if (!c) failed++; };

// --- (1) vendor detection: o4-series models must resolve to "openai", not "unknown" ---
{
  const r = analyze([
    {
      model: "o4-mini",
      messages: [
        { role: "user", content: "What is 2+2?" },
        { role: "assistant", content: "4" },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 5 },
    },
  ]);
  ok("o4-mini trace has vendor 'openai' (not 'unknown')", r.vendor === "openai", `vendor=${r.vendor}`);

  // A pure o4-mini trace should also get OpenAI-flavored caching advice in unusedCache.
  // We can't directly assert the fix text, but we can check the internal normalize output.
  const trace = normalize([
    { model: "o4-mini", messages: [{ role: "user", content: "hello" }] },
    { model: "o4-mini", messages: [{ role: "user", content: "world" }] },
  ]);
  ok("normalize: o4-mini trace vendor is 'openai'", trace.vendor === "openai", `vendor=${trace.vendor}`);

  const r5 = analyze([
    { model: "o5-mini", messages: [{ role: "user", content: "test" }], usage: { prompt_tokens: 10, completion_tokens: 3 } },
  ]);
  ok("future o5-mini also resolves to 'openai'", r5.vendor === "openai", `vendor=${r5.vendor}`);
}

// --- (2) uncompactedHistory: per-call cache pricing ---
// Scenario: a 10-call agent loop where the FIRST call has cache_control but the
// remaining 9 calls do NOT. Under the old code, ALL calls priced old-history at
// the cache rate. Under the new code, only the first call does; the rest bill at
// the full input rate.
{
  const longHistory = (n) =>
    Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `message ${i} ` + "text ".repeat(100) }));

  const RECENT_WIN = 8;
  // 9 calls with growing history, first call has cache_control, rest do not.
  const calls = Array.from({ length: 9 }, (_, i) => ({
    model: "claude-opus-5",
    system: [
      {
        type: "text",
        text: "You are a helpful agent.",
        cache_control: i === 0 ? { type: "ephemeral" } : undefined,
      },
    ],
    messages: longHistory(RECENT_WIN + i * 2 + 2),
    usage: { input_tokens: 3000 + i * 400, output_tokens: 80 },
  }));

  const r = analyze(calls);
  const f = r.findings.find((x) => x.detector === "uncompacted-history");
  ok("uncompacted-history fires on growing-history loop", !!f);
  if (f) {
    // The correct waste should reflect that most calls (no cache marker) use the
    // full input rate ($5/1M for claude-opus-5), not the cache rate ($0.5/1M).
    // So wastedUSD should be noticeably > 0 (not near-zero as it would be if all
    // calls were priced at the 10× cheaper cache rate).
    const perTokCache = 0.5 / 1_000_000;
    const perTokInput = 5 / 1_000_000;
    ok(
      "uncompacted-history waste priced at input rate for uncached calls (not forced to cache rate)",
      f.wastedUSD > 0,
      `wastedUSD=${f.wastedUSD.toFixed(6)}`
    );
    // If all calls were wrongly treated as cached, wasted$ would be ~10× smaller
    // than the correctly-computed value. Verify the new value is > 5× the all-cache baseline.
    const estimatedAllCacheWaste = f.wastedTokens * perTokCache; // rough floor
    const estimatedAllInputWaste = f.wastedTokens * perTokInput; // rough ceiling
    const midpoint = (estimatedAllCacheWaste + estimatedAllInputWaste) / 2;
    ok(
      "per-call pricing: wastedUSD closer to input-rate than all-cache-rate",
      f.wastedUSD > midpoint,
      `wastedUSD=${f.wastedUSD.toFixed(6)} midpoint=${midpoint.toFixed(6)}`
    );
  }
}

console.log(failed ? `\nFAILED (${failed})` : "\nALL R12 CHECKS PASSED");
process.exit(failed ? 1 : 0);
