// Round 11 autonomous fixes:
//   1. detectVendorFromModel now recognises o4-series as openai (not "unknown")
//   2. duplicateRequests prices waste cache-aware (not at full input rate)
//   3. modelOverkill suggests Haiku 4.5 (not 3.5 Haiku) for modern Sonnet 4/5 models
import { analyze } from "../src/core/analyze.ts";

let failed = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`); if (!c) failed++; };
const has = (r, id) => r.findings.some((f) => f.detector === id);
const get = (r, id) => r.findings.find((f) => f.detector === id);

// ── Fix 1: o4-mini vendor detection ──────────────────────────────────────────
{
  const trace = [{ model: "o4-mini", messages: [
    { role: "user", content: "What is 2+2?" },
    { role: "assistant", content: "4" },
  ], usage: { prompt_tokens: 10, completion_tokens: 2 } }];
  const r = analyze(trace);
  ok("o4-mini reports vendor=openai (not unknown)", r.vendor === "openai", `got: ${r.vendor}`);
}

// Also check o4 (without -mini) reports openai
{
  const trace = [{ model: "o4", messages: [
    { role: "user", content: "Summarize this" },
    { role: "assistant", content: "Done" },
  ], usage: { prompt_tokens: 10, completion_tokens: 5 } }];
  const r = analyze(trace);
  ok("o4 (no suffix) reports vendor=openai", r.vendor === "openai", `got: ${r.vendor}`);
}

// ── Fix 2: duplicateRequests prices cache-aware ───────────────────────────────
// Without fix: 1000 input tokens at $2.5/M = $0.0025 per duplicate call.
// With fix: 800 cached at $1.25/M + 200 uncached at $2.5/M = $0.001 + $0.0005 = $0.0015.
{
  const userMsg = "Analyze this contract: " + "word ".repeat(180);
  const trace = [
    {
      model: "gpt-4o",
      messages: [{ role: "user", content: userMsg }],
      usage: { prompt_tokens: 1000, completion_tokens: 50, cached_tokens: 800 },
    },
    {
      model: "gpt-4o",
      messages: [{ role: "user", content: userMsg }],
      usage: { prompt_tokens: 1000, completion_tokens: 50, cached_tokens: 800 },
    },
  ];
  const r = analyze(trace);
  const f = get(r, "duplicate-requests");
  ok("duplicate-requests fires on repeated call", f != null);
  if (f) {
    // Full-rate waste would be: 1000 * 2.5/1M + 50 * 10/1M = 0.0025 + 0.0005 = 0.003
    // Cache-aware waste: (200 * 2.5 + 800 * 1.25 + 50 * 10) / 1M = (500 + 1000 + 500) / 1M = 0.002
    ok("duplicate-requests waste is cache-aware (less than full-rate)", f.wastedUSD < 0.003,
      `wastedUSD=${f.wastedUSD.toFixed(6)}`);
    ok("duplicate-requests waste is still positive with partial cache", f.wastedUSD > 0,
      `wastedUSD=${f.wastedUSD.toFixed(6)}`);
  }
}

// ── Fix 3: modelOverkill suggests Haiku 4.5 for modern Sonnet ────────────────
// Long user message to clear the 200-token minimum-size guard (same pattern as round5 test).
const bigClassifyUser = "Classify the intent of this customer message as JSON. " + "context ".repeat(200);

// claude-sonnet-5 doing a JSON classify task → should suggest Claude Haiku 4.5
{
  const trace = [{
    model: "claude-sonnet-5",
    messages: [
      { role: "system", content: "Classify the intent. Respond ONLY with JSON {intent: string}." },
      { role: "user", content: bigClassifyUser },
      { role: "assistant", content: '{"intent":"travel"}' },
    ],
    response_format: { type: "json_object" },
    usage: { input_tokens: 300, output_tokens: 8 },
  }];
  const r = analyze(trace);
  const f = get(r, "model-overkill");
  ok("model-overkill fires on claude-sonnet-5 simple task", f != null,
    `findings: ${r.findings.map(f=>f.detector).join(",") || "none"}`);
  if (f) {
    ok("model-overkill suggests Haiku 4.5 (not 3.5 Haiku) for sonnet-5",
      f.evidence?.some((e) => e.includes("Haiku 4.5")),
      `evidence: ${(f.evidence ?? []).slice(0, 2).join("; ")}`);
  }
}

// claude-3-5-sonnet still correctly suggests Haiku 3.5 (generational sibling)
{
  const trace = [{
    model: "claude-3-5-sonnet-20241022",
    messages: [
      { role: "system", content: "Classify the category. Respond ONLY with JSON." },
      { role: "user", content: bigClassifyUser },
      { role: "assistant", content: '{"category":"calendar"}' },
    ],
    response_format: { type: "json_object" },
    usage: { input_tokens: 300, output_tokens: 8 },
  }];
  const r = analyze(trace);
  const f = get(r, "model-overkill");
  ok("model-overkill fires on claude-3-5-sonnet simple task", f != null,
    `findings: ${r.findings.map(f=>f.detector).join(",") || "none"}`);
  if (f) {
    ok("model-overkill suggests Haiku 3.5 for claude-3-5-sonnet",
      f.evidence?.some((e) => e.includes("Haiku 3.5")),
      `evidence: ${(f.evidence ?? []).slice(0, 2).join("; ")}`);
  }
}

console.log(failed ? `\nFAILED (${failed})` : "\nALL ROUND 11 CHECKS PASSED");
process.exit(failed ? 1 : 0);
