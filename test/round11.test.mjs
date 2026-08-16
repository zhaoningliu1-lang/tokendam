// Round 11 regression tests — autonomous self-optimization run 2026-08-16
import { analyze } from "../src/core/analyze.ts";

let failed = 0;
const ok = (n, c, x = "") => {
  console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`);
  if (!c) failed++;
};
const has = (r, id) => r.findings.some((f) => f.detector === id);

// ── Fix 1: detectVendorFromModel covers o4-mini (and all o-series) ────────────

{
  // o4-mini was previously classified as "unknown" vendor because the check only
  // matched m.startsWith("o1") || m.startsWith("o3"). Correct answer: "openai".
  const r = analyze([{
    model: "o4-mini",
    messages: [{ role: "user", content: "Hello" }, { role: "assistant", content: "Hi" }],
    usage: { prompt_tokens: 20, completion_tokens: 5 },
  }]);
  ok("o4-mini vendor is 'openai' (not 'unknown')", r.vendor === "openai", `→ vendor=${r.vendor}`);
}

{
  // o3 should still be "openai"
  const r = analyze([{
    model: "o3",
    messages: [{ role: "user", content: "Hello" }, { role: "assistant", content: "Hi" }],
    usage: { prompt_tokens: 20, completion_tokens: 5 },
  }]);
  ok("o3 vendor is 'openai'", r.vendor === "openai", `→ vendor=${r.vendor}`);
}

// ── Fix 2: duplicate-requests accounts for cached tokens in cost ──────────────

{
  // Two identical requests, second one with 80% of input served from cache.
  // Wasted USD should reflect the discounted (cache-hit) rate on cached tokens.
  const msg = "Classify this review as positive or negative: I love this product. " + "x ".repeat(200);
  const uncachedTrace = [
    { model: "gpt-4o", messages: [{ role: "user", content: msg }], usage: { prompt_tokens: 220, completion_tokens: 5 } },
    { model: "gpt-4o", messages: [{ role: "user", content: msg }], usage: { prompt_tokens: 220, completion_tokens: 5 } },
  ];
  const cachedTrace = [
    { model: "gpt-4o", messages: [{ role: "user", content: msg }], usage: { prompt_tokens: 220, completion_tokens: 5 } },
    { model: "gpt-4o", messages: [{ role: "user", content: msg }], usage: { prompt_tokens: 220, completion_tokens: 5, cached_tokens: 176 } },
  ];
  const rUncached = analyze(uncachedTrace);
  const rCached = analyze(cachedTrace);
  const dupUncached = rUncached.findings.find((f) => f.detector === "duplicate-requests");
  const dupCached = rCached.findings.find((f) => f.detector === "duplicate-requests");
  ok(
    "duplicate-requests cost is lower with cached tokens",
    dupCached && dupUncached && dupCached.wastedUSD < dupUncached.wastedUSD,
    `→ cached=${dupCached?.wastedUSD?.toFixed(7)} uncached=${dupUncached?.wastedUSD?.toFixed(7)}`
  );
}

// ── Fix 3: modelOverkill suggestCheaper uses current-gen models ───────────────

// Must be long enough so inTok + out >= 200 (the modelOverkill minimum-size guard).
const BIG_USER = "Classify the sentiment of this customer review: " + "review_context ".repeat(200);

function simpleTrace(model) {
  return [{
    model,
    messages: [
      { role: "system", content: "Classify the sentiment. Respond ONLY with JSON." },
      { role: "user", content: BIG_USER },
      { role: "assistant", content: '{"sentiment":"positive"}' },
    ],
    usage: { input_tokens: 400, output_tokens: 8 },
  }];
}

{
  // claude-opus-5 → should suggest Claude Sonnet 5 (not Sonnet 4)
  const r = analyze(simpleTrace("claude-opus-5"));
  const f = r.findings.find((f) => f.detector === "model-overkill");
  ok("claude-opus-5 model-overkill fires", !!f, `→ ${f ? "found" : "missing"}`);
  ok(
    "claude-opus-5 suggests Sonnet 5",
    f?.evidence?.[0]?.includes("Sonnet 5"),
    `→ ${f?.evidence?.[0]}`
  );
}

{
  // claude-sonnet-5 → should suggest Claude Haiku 4
  const r = analyze(simpleTrace("claude-sonnet-5"));
  const f = r.findings.find((f) => f.detector === "model-overkill");
  ok("claude-sonnet-5 model-overkill fires", !!f, `→ ${f ? "found" : "missing"}`);
  ok(
    "claude-sonnet-5 suggests Haiku 4",
    f?.evidence?.[0]?.includes("Haiku 4"),
    `→ ${f?.evidence?.[0]}`
  );
}

{
  // claude-fable-5 (creative flagship) → should suggest Sonnet 5
  const r = analyze(simpleTrace("claude-fable-5"));
  const f = r.findings.find((f) => f.detector === "model-overkill");
  ok("claude-fable-5 model-overkill fires", !!f, `→ ${f ? "found" : "missing"}`);
  ok(
    "claude-fable-5 suggests Sonnet 5",
    f?.evidence?.[0]?.includes("Sonnet 5"),
    `→ ${f?.evidence?.[0]}`
  );
}

{
  // claude-3-5-sonnet still suggests its own-gen Haiku (Haiku 3.5)
  const r = analyze(simpleTrace("claude-3-5-sonnet-20241022"));
  const f = r.findings.find((f) => f.detector === "model-overkill");
  ok("claude-3-5-sonnet still fires model-overkill", !!f);
  ok(
    "claude-3-5-sonnet still suggests Haiku (3.5)",
    f?.evidence?.[0]?.includes("Haiku"),
    `→ ${f?.evidence?.[0]}`
  );
}

{
  // claude-sonnet-4-6 → should suggest Haiku 4 (not the old 3.5 Haiku)
  const r = analyze(simpleTrace("claude-sonnet-4-6"));
  const f = r.findings.find((f) => f.detector === "model-overkill");
  ok("claude-sonnet-4-6 model-overkill fires", !!f, `→ ${f ? "found" : "missing"}`);
  ok(
    "claude-sonnet-4-6 suggests Haiku 4 (not legacy Haiku)",
    f?.evidence?.[0]?.includes("Haiku 4") && !f?.evidence?.[0]?.includes("3-5-haiku"),
    `→ ${f?.evidence?.[0]}`
  );
}

console.log(failed ? `\nFAILED (${failed})` : "\nALL R11 CHECKS PASSED");
process.exit(failed ? 1 : 0);
