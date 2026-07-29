// R7: fixes from the Round 6 critique — modelOverkill cache-aware + hint-gated,
// CI skips good-news advisories, diff cross-model is neutral.
import { analyze } from "../src/core/analyze.ts";
import { evaluateCi } from "../src/core/ci.ts";
import { diffReports } from "../src/core/diff.ts";
import { renderFixPlan } from "../src/core/fixPrompt.ts";

let failed = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`); if (!c) failed++; };
const has = (r, id) => r.findings.find((f) => f.detector === id);
const bigUser = "classify this customer message please " + "context ".repeat(300);

// --- modelOverkill cache-aware: saving can never exceed the call's real cost ---
{
  const r = analyze([{
    model: "claude-opus-4-1",
    messages: [{ role: "system", content: "Classify sentiment, respond JSON." }, { role: "user", content: bigUser }, { role: "assistant", content: '{"s":"pos"}' }],
    usage: { input_tokens: 3000, output_tokens: 5, prompt_tokens_details: { cached_tokens: 2900 } },
  }]);
  const f = has(r, "model-overkill");
  ok("model-overkill fires with cache present", !!f);
  ok("model-overkill saving <= trace total cost (cache-aware)", !f || f.wastedUSD <= r.totalUSD + 1e-9, f ? `${f.wastedUSD.toFixed(5)} <= ${r.totalUSD.toFixed(5)}` : "");
}

// --- modelOverkill now requires a hint: gpt-4o, short output, NO hint → quiet ---
{
  const r = analyze([{
    model: "gpt-4o",
    messages: [{ role: "system", content: "You are a helpful assistant." }, { role: "user", content: bigUser }, { role: "assistant", content: "Sure, here you go." }],
    usage: { input_tokens: 400, output_tokens: 15 },
  }]);
  ok("model-overkill quiet without an explicit simple-task hint", !has(r, "model-overkill"));
}

// --- CI must NOT fail on a zero-waste "already caching" advisory ---
{
  const bigSys = "You are a careful assistant.\n" + Array.from({ length: 200 }, (_, i) =>
    `Guideline ${i}: when handling ${["billing", "refunds", "shipping", "returns"][i % 4]} for region ${i % 7}, apply policy code ${i * 3 + 11} and escalate tier ${(i % 5) + 1} within ${i % 24} hours.`
  ).join("\n");
  // cached_tokens large enough that the whole shared prefix reads as cache-served.
  const usage = { prompt_tokens: 9000, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 9000 } };
  const cached = analyze([
    { model: "gpt-4o", messages: [{ role: "system", content: bigSys }, { role: "user", content: "a" }], usage },
    { model: "gpt-4o", messages: [{ role: "system", content: bigSys }, { role: "user", content: "b" }], usage },
  ]);
  const advisory = cached.findings.find((f) => f.detector === "unused-cache" && f.wastedUSD === 0);
  const res = evaluateCi(cached, { failOnSeverity: ["high", "medium", "low"] });
  ok("a zero-waste caching advisory exists", !!advisory, advisory ? `(sev ${advisory.severity})` : "(none — ok if no advisory)");
  ok("CI passes despite --fail-on low when only a good-news advisory is present", res.pass && res.exitCode === 0);
}

// --- diff cross-model is neutral: never regressed, exit 0 ---
{
  const cheap = analyze([{ model: "claude-3-5-haiku", messages: [{ role: "user", content: "hi" }], usage: { input_tokens: 10, output_tokens: 5 } }]);
  const pricey = analyze([{ model: "claude-opus-4-1", messages: [{ role: "user", content: "hi" }], usage: { input_tokens: 10, output_tokens: 5 } }]);
  const d = diffReports(cheap, pricey);
  ok("diff cross-model does not regress + exit 0", d.crossModel && !d.regressed && d.exitCode === 0, `verdict=${d.verdict}`);
}

// --- mixed-model pricing: each call priced by its OWN model (not one trace price) ---
{
  const content = "word ".repeat(500); // ~500 tokens
  const mixed = analyze([
    { model: "gpt-4o-mini", messages: [{ role: "user", content }] },
    { model: "claude-opus-4-1", messages: [{ role: "user", content }] },
  ]);
  const allMini = analyze([
    { model: "gpt-4o-mini", messages: [{ role: "user", content }] },
    { model: "gpt-4o-mini", messages: [{ role: "user", content }] },
  ]);
  // opus input is ~100× mini — the opus call must dominate the mixed total.
  ok("mixed trace priced per-call (opus call dominates)", mixed.totalUSD > allMini.totalUSD * 10, `${mixed.totalUSD.toFixed(5)} vs ${allMini.totalUSD.toFixed(5)}`);
  ok("report.model marks a mixed trace", mixed.model === "mixed (2 models)", `→ ${mixed.model}`);
}

// --- duplicate-requests: same request sent twice → cacheable finding ---
{
  const q = "Summarize this support ticket and classify its urgency. " + "ticket body ".repeat(40);
  const r = analyze([
    { model: "gpt-4o", messages: [{ role: "user", content: q }], usage: { prompt_tokens: 600, completion_tokens: 50 } },
    { model: "gpt-4o", messages: [{ role: "user", content: "totally different unrelated question about billing" }], usage: { prompt_tokens: 20, completion_tokens: 10 } },
    { model: "gpt-4o", messages: [{ role: "user", content: q }], usage: { prompt_tokens: 600, completion_tokens: 50 } },
  ]);
  ok("duplicate-requests fires on a repeated identical request", has(r, "duplicate-requests"));
  const uniq = analyze([
    { model: "gpt-4o", messages: [{ role: "user", content: "question one about shipping" }] },
    { model: "gpt-4o", messages: [{ role: "user", content: "question two about returns" }] },
  ]);
  ok("duplicate-requests quiet when all requests differ", !has(uniq, "duplicate-requests"));
}

// --- fix plan (structured JSON) — machine-readable for a CI agent ---
{
  const bigSys2 = "You are careful.\n" + Array.from({ length: 200 }, (_, i) => `Rule ${i}: do X for case ${i % 9} within ${i} minutes and log to channel ${i % 4}.`).join("\n");
  const r = analyze([
    { model: "gpt-4o", messages: [{ role: "system", content: bigSys2 }, { role: "user", content: "a" }] },
    { model: "gpt-4o", messages: [{ role: "system", content: bigSys2 }, { role: "user", content: "b" }] },
  ]);
  const plan = renderFixPlan(r);
  ok("fix plan has a summary + steps array", Array.isArray(plan.steps) && plan.steps.length > 0 && typeof plan.summary.savableUSD === "number");
  ok("fix plan steps carry instruction + estimatedSavingUSD", plan.steps.every((s) => typeof s.instruction === "string" && typeof s.estimatedSavingUSD === "number"));
}

console.log(failed ? `\nFAILED (${failed})` : "\nALL R7 CHECKS PASSED");
process.exit(failed ? 1 : 0);
