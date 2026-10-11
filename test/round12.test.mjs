// Round 12 autonomous: vendor detection for o4-series and Gemini, plus Gemini-specific
// caching advice in unusedCache.
import { analyze } from "../src/core/analyze.ts";

let failed = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`); if (!c) failed++; };

// System prompt large enough to exceed the 1024-token cache threshold (~1200 tokens)
const bigSys = "You are a helpful assistant. " + "word ".repeat(1200);

function twoCallTrace(model) {
  return [
    { model, messages: [{ role: "system", content: bigSys }, { role: "user", content: "ping" }] },
    { model, messages: [{ role: "system", content: bigSys }, { role: "user", content: "pong" }] },
  ];
}

// ── Vendor detection ──────────────────────────────────────────────────────────

{
  const r = analyze(twoCallTrace("gemini-2.5-flash"));
  ok("gemini-2.5-flash → vendor google", r.vendor === "google", `got "${r.vendor}"`);
}

{
  const r = analyze(twoCallTrace("gemini-2.5-pro"));
  ok("gemini-2.5-pro → vendor google", r.vendor === "google", `got "${r.vendor}"`);
}

{
  const r = analyze(twoCallTrace("o4-mini"));
  ok("o4-mini → vendor openai", r.vendor === "openai", `got "${r.vendor}"`);
}

{
  const r = analyze(twoCallTrace("o4"));
  ok("o4 → vendor openai", r.vendor === "openai", `got "${r.vendor}"`);
}

// ── unusedCache fix advice ────────────────────────────────────────────────────

{
  const r = analyze(twoCallTrace("gemini-2.5-flash"));
  const f = r.findings.find(x => x.detector === "unused-cache");
  ok("gemini trace → unusedCache fires", !!f);
  ok("gemini unusedCache fix mentions Gemini, not OpenAI",
    !!f && f.fix.includes("Gemini") && !f.fix.includes("OpenAI"),
    `fix: "${f?.fix?.slice(0, 80)}"`);
}

{
  const r = analyze(twoCallTrace("gpt-4o"));
  const f = r.findings.find(x => x.detector === "unused-cache");
  ok("gpt-4o unusedCache fires", !!f);
  ok("gpt-4o unusedCache fix mentions OpenAI", !!f && f.fix.includes("OpenAI"));
}

{
  const r = analyze(twoCallTrace("claude-sonnet-4"));
  const f = r.findings.find(x => x.detector === "unused-cache");
  ok("anthropic unusedCache fires", !!f);
  ok("anthropic unusedCache fix mentions cache_control", !!f && f.fix.includes("cache_control"));
}

// ── modelOverkill still works after callCost→callUSD refactor ────────────────

// System+user+assistant must be ≥200 tokens total (modelOverkill's min-size guard).
// "extra " ≈ 1 token each; 200 reps → sys ≈ 217 tok, total ≈ 246 tok (safely ≥200).
const moSys = "Classify the sentiment as positive or negative. Return JSON with a sentiment field. " +
  "extra ".repeat(200);
const moUser = "I love this product! It works great and saves so much time every single day.";

{
  const overkillTrace = [{
    model: "claude-opus-4-5",
    messages: [
      { role: "system", content: moSys },
      { role: "user", content: moUser },
      { role: "assistant", content: '{"sentiment":"positive"}' },
    ],
    response_format: { type: "json_object" },
    usage: { input_tokens: 200, output_tokens: 6 },
  }];
  const r = analyze(overkillTrace);
  const f = r.findings.find(x => x.detector === "model-overkill");
  ok("model-overkill still fires after callCost→callUSD refactor", !!f,
    `findings: [${r.findings.map(x=>x.detector).join(",")}]`);
  ok("model-overkill wastedUSD > 0", !!f && f.wastedUSD > 0, `wastedUSD=${f?.wastedUSD}`);
}

console.log(failed ? `\nFAILED (${failed})` : "\nALL R12 CHECKS PASSED");
process.exit(failed ? 1 : 0);
