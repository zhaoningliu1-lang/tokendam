// R5: model-overkill detector + tokendam diff regression.
import { analyze } from "../src/core/analyze.ts";
import { diffReports } from "../src/core/diff.ts";

let failed = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`); if (!c) failed++; };
const has = (r, id) => r.findings.find((f) => f.detector === id);

const bigUser = "Given the following customer message, classify it. " + "context ".repeat(300);

// --- model-overkill: Opus on a simple JSON classification → suggest downgrade ---
{
  const r = analyze([{
    model: "claude-opus-4-1",
    messages: [
      { role: "system", content: "Classify the sentiment. Respond ONLY with JSON." },
      { role: "user", content: bigUser },
      { role: "assistant", content: '{"sentiment":"positive"}' },
    ],
    usage: { input_tokens: 400, output_tokens: 8 },
  }]);
  const f = has(r, "model-overkill");
  ok("model-overkill fires on Opus doing simple JSON task", !!f, f ? `→ saves ${f.wastedUSD.toFixed(4)}, sev=${f.severity}` : "");
  ok("model-overkill is secondary (out of headline sum)", f && f.secondary === true);
}

// --- already-cheap model → no suggestion ---
{
  const r = analyze([{ model: "gpt-4o-mini", messages: [{ role: "system", content: "Classify. JSON." }, { role: "user", content: bigUser }, { role: "assistant", content: "{}" }], usage: { input_tokens: 400, output_tokens: 8 } }]);
  ok("model-overkill quiet on an already-cheap model", !has(r, "model-overkill"));
}

// --- flagship on a HARD task (long output, tools) → don't nag ---
{
  const r = analyze([{
    model: "claude-opus-4-1",
    tools: [{ name: "run", description: "x".repeat(200), input_schema: {} }],
    messages: [{ role: "user", content: "Design a distributed system." }, { role: "assistant", content: "Here is a long detailed multi-step design ... " + "detail ".repeat(400) }],
    usage: { input_tokens: 400, output_tokens: 2000 },
  }]);
  ok("model-overkill quiet on a hard task (long output + tools)", !has(r, "model-overkill"));
}

// --- BUG1 fix: reasoning model (o1) with short answer + no keyword → NOT overkill ---
{
  const r = analyze([{
    model: "o1",
    messages: [{ role: "system", content: "Solve this competition math problem." }, { role: "user", content: bigUser }, { role: "assistant", content: "42" }],
    usage: { input_tokens: 400, output_tokens: 80 },
  }]);
  ok("model-overkill quiet on reasoning model with short answer (no simple hint)", !has(r, "model-overkill"));
}

// --- BUG2 fix: heavy agent call (tools + structured + long output) → NOT overkill ---
{
  const r = analyze([{
    model: "claude-opus-4-1",
    tools: [{ name: "run", description: "x".repeat(150), input_schema: {} }],
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: "Do a complex multi-step task." }, { role: "assistant", content: "long ".repeat(500) }],
    usage: { input_tokens: 400, output_tokens: 2500 },
  }]);
  ok("model-overkill quiet on heavy agent call despite structured output", !has(r, "model-overkill"));
}

// --- diff: wasteful → clean = improved (exit 0); clean → wasteful = regressed (exit 1) ---
{
  const bigSys = "You are careful. " + "Follow rules precisely. ".repeat(220);
  const wasteful = analyze([
    { model: "gpt-4o", messages: [{ role: "system", content: bigSys }, { role: "user", content: "a" }] },
    { model: "gpt-4o", messages: [{ role: "system", content: bigSys }, { role: "user", content: "b" }] },
    { model: "gpt-4o", messages: [{ role: "system", content: bigSys }, { role: "user", content: "c" }] },
  ]);
  const clean = analyze([{ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }]);

  const improved = diffReports(wasteful, clean);
  ok("diff: wasteful→clean is 'improved' (exit 0)", improved.verdict === "improved" && improved.exitCode === 0, `spend ${improved.spendDeltaPct.toFixed(0)}%`);

  const regressed = diffReports(clean, wasteful);
  ok("diff: clean→wasteful is 'regressed' (exit 1)", regressed.verdict === "regressed" && regressed.exitCode === 1);

  const same = diffReports(wasteful, wasteful);
  ok("diff: same trace is 'unchanged' (exit 0)", same.verdict === "unchanged" && same.exitCode === 0);

  // BUG3 fix: cross-model diff is flagged as not comparable.
  const cheap = analyze([{ model: "claude-3-5-haiku", messages: [{ role: "user", content: "hi" }], usage: { input_tokens: 10, output_tokens: 5 } }]);
  const pricey = analyze([{ model: "claude-opus-4-1", messages: [{ role: "user", content: "hi" }], usage: { input_tokens: 10, output_tokens: 5 } }]);
  ok("diff flags cross-model comparison", diffReports(cheap, pricey).crossModel === true);
  ok("diff same-model is not cross-model", diffReports(wasteful, clean).crossModel === false);
}

console.log(failed ? `\nFAILED (${failed})` : "\nALL R5 CHECKS PASSED");
process.exit(failed ? 1 : 0);
