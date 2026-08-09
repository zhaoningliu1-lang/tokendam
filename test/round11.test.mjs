// Round 11 (autonomous) — 2026-08-09
// Tests for three correctness fixes:
//   1. detectVendorFromModel recognises o4-series and Gemini
//   2. duplicateRequests uses cache-aware pricing (matches the Round-2 pattern)
//   3. unusedCache gives Gemini-specific Context Caching advice
import { analyze } from "../src/core/analyze.ts";

let failed = 0;
const ok = (n, c, x = "") => {
  console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`);
  if (!c) failed++;
};

// ── Fix 1: vendor detection for o4-series ────────────────────────────────────

{
  const r = analyze([{ model: "o4-mini", messages: [{ role: "user", content: "What is 2+2?" }] }]);
  ok("o4-mini vendor is openai", r.vendor === "openai", `got: ${r.vendor}`);
}
{
  const r = analyze([{ model: "o4", messages: [{ role: "user", content: "Write a poem." }] }]);
  ok("o4 vendor is openai", r.vendor === "openai", `got: ${r.vendor}`);
}

// ── Fix 1: vendor detection for Gemini ───────────────────────────────────────

// 1200+ token prefix: "instruction " ≈ 1 tok each × 1200 >> MIN_CACHEABLE (1024)
const sysContent = "You are a helpful assistant. " + "instruction ".repeat(1200);
const geminiTrace = Array.from({ length: 3 }, (_, i) => ({
  model: "gemini-2.5-pro",
  messages: [
    { role: "system", content: sysContent },
    { role: "user", content: `Question number ${i + 1}: explain something specific.` },
  ],
}));
{
  const r = analyze(geminiTrace);
  ok("gemini-2.5-pro vendor is gemini", r.vendor === "gemini", `got: ${r.vendor}`);
}

// ── Fix 3: Gemini gets Context Caching advice, not OpenAI auto-cache advice ──

{
  const r = analyze(geminiTrace);
  const cacheFinding = r.findings.find((f) => f.detector === "unused-cache");
  ok("Gemini: unused-cache finding present", !!cacheFinding);
  ok(
    "Gemini: fix mentions Context Caching API",
    cacheFinding?.fix?.includes("caches.create"),
    `got fix: ${cacheFinding?.fix?.slice(0, 100)}`
  );
  ok(
    "Gemini: fix does NOT say 'OpenAI auto-caches'",
    !cacheFinding?.fix?.includes("OpenAI auto-caches"),
    `got fix: ${cacheFinding?.fix?.slice(0, 100)}`
  );
}

// ── Fix 2: duplicateRequests uses cache-aware pricing ────────────────────────

const bigMsg = "The quick brown fox jumped over the lazy dogs and " + "analysed the results carefully every ".repeat(40);

// Baseline: two identical calls, no cache tokens reported
const noCacheTrace = [
  { model: "gpt-4o", messages: [{ role: "user", content: bigMsg }] },
  { model: "gpt-4o", messages: [{ role: "user", content: bigMsg }],
    usage: { prompt_tokens: 500, completion_tokens: 5 } },
];
// Cached: second call reports most input already served from cache
const cachedTrace = [
  { model: "gpt-4o", messages: [{ role: "user", content: bigMsg }] },
  { model: "gpt-4o", messages: [{ role: "user", content: bigMsg }],
    usage: { prompt_tokens: 500, completion_tokens: 5, cached_tokens: 480 } },
];

{
  const rNone = analyze(noCacheTrace);
  const rCached = analyze(cachedTrace);
  const wNone  = rNone.findings.find((f) => f.detector === "duplicate-requests")?.wastedUSD ?? 0;
  const wCached = rCached.findings.find((f) => f.detector === "duplicate-requests")?.wastedUSD ?? 0;
  ok("duplicate-requests fires in both cases", wNone > 0 && wCached > 0,
    `no-cache: $${wNone.toFixed(6)}, cached: $${wCached.toFixed(6)}`);
  ok("duplicate-requests: cache hit reduces wastedUSD", wCached < wNone,
    `no-cache: $${wNone.toFixed(6)}, cached: $${wCached.toFixed(6)}`);
}

console.log(failed ? `\nFAILED (${failed})` : "\nALL ROUND 11 CHECKS PASSED");
process.exit(failed ? 1 : 0);
