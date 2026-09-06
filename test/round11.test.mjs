// Round 11 autonomous fixes:
//   1. detectVendorFromModel now recognises o4-series and Gemini models.
//   2. unusedCache gives Gemini-specific caching advice.
//   3. duplicateRequests prices cached input tokens at the cache-hit rate.
import { analyze } from "../src/core/analyze.ts";

let failed = 0;
const ok = (n, c, x = "") => {
  console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`);
  if (!c) failed++;
};
const has = (r, id) => r.findings.find((f) => f.detector === id);

// --- Fix 1: vendor detection for o4-series (was "unknown", now "openai") ---
{
  const r = analyze([
    { model: "o4-mini", messages: [{ role: "user", content: "What is 2+2?" }], usage: { input_tokens: 10, output_tokens: 5 } },
  ]);
  ok("o4-mini vendor is openai (not unknown)", r.vendor === "openai", `→ ${r.vendor}`);
}

// --- Fix 1b: o1 and o3 still work after the regex change ---
{
  const r1 = analyze([{ model: "o1", messages: [{ role: "user", content: "hi" }], usage: { input_tokens: 5, output_tokens: 3 } }]);
  ok("o1 vendor still openai", r1.vendor === "openai", `→ ${r1.vendor}`);
  const r3 = analyze([{ model: "o3", messages: [{ role: "user", content: "hi" }], usage: { input_tokens: 5, output_tokens: 3 } }]);
  ok("o3 vendor still openai", r3.vendor === "openai", `→ ${r3.vendor}`);
}

// --- Fix 1c: Gemini vendor detection (was "unknown", now "google") ---
{
  const r = analyze([
    { model: "gemini-2.5-pro", messages: [{ role: "user", content: "Summarise this document." }], usage: { input_tokens: 20, output_tokens: 10 } },
  ]);
  ok("gemini-2.5-pro vendor is google (not unknown)", r.vendor === "google", `→ ${r.vendor}`);
}

// --- Fix 2: unusedCache gives Gemini-specific fix advice ---
{
  const bigSys = "You are a Google Gemini agent.\n" + Array.from({ length: 200 }, (_, i) =>
    `Rule ${i}: handle case ${i % 7} within ${i + 1} seconds using code ${i * 3}.`
  ).join("\n");
  const r = analyze([
    { model: "gemini-2.5-pro", messages: [{ role: "system", content: bigSys }, { role: "user", content: "a" }] },
    { model: "gemini-2.5-pro", messages: [{ role: "system", content: bigSys }, { role: "user", content: "b" }] },
  ]);
  const f = has(r, "unused-cache");
  ok("unusedCache fires on a gemini trace with repeated prefix", !!f);
  ok("unusedCache fix advice mentions Context Caching API (Gemini)", !!f && f.fix.includes("Context Caching"), f ? f.fix.slice(0, 60) : "—");
}

// --- Fix 3: duplicateRequests discounts cached input tokens ---
{
  const q = "Classify this customer support ticket by urgency and category. " + "ticket content ".repeat(30);
  // Same request sent twice, both calls report full caching of input.
  const rCached = analyze([
    { model: "gpt-4o", messages: [{ role: "user", content: q }], usage: { prompt_tokens: 500, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 500 } } },
    { model: "gpt-4o", messages: [{ role: "user", content: q }], usage: { prompt_tokens: 500, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 500 } } },
  ]);
  // Same request without caching — costs more.
  const rNocache = analyze([
    { model: "gpt-4o", messages: [{ role: "user", content: q }], usage: { prompt_tokens: 500, completion_tokens: 40 } },
    { model: "gpt-4o", messages: [{ role: "user", content: q }], usage: { prompt_tokens: 500, completion_tokens: 40 } },
  ]);
  const fCached = has(rCached, "duplicate-requests");
  const fNocache = has(rNocache, "duplicate-requests");
  ok("duplicate-requests fires in both cached and uncached cases", !!fCached && !!fNocache);
  ok(
    "duplicate-requests wastedUSD is lower when input was cached",
    !!fCached && !!fNocache && fCached.wastedUSD < fNocache.wastedUSD,
    fCached && fNocache ? `cached=${fCached.wastedUSD.toFixed(6)} < uncached=${fNocache.wastedUSD.toFixed(6)}` : "—"
  );
}

console.log(failed ? `\nFAILED (${failed})` : "\nALL ROUND11 CHECKS PASSED");
process.exit(failed ? 1 : 0);
