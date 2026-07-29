// R7: fixes from the Round 6 critique — modelOverkill cache-aware + hint-gated,
// CI skips good-news advisories, diff cross-model is neutral.
import { analyze } from "../src/core/analyze.ts";
import { evaluateCi } from "../src/core/ci.ts";
import { diffReports } from "../src/core/diff.ts";

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

console.log(failed ? `\nFAILED (${failed})` : "\nALL R7 CHECKS PASSED");
process.exit(failed ? 1 : 0);
