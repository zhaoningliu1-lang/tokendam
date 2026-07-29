// Verifies the two new detectors fire on crafted traces and stay quiet otherwise.
import { analyze } from "../src/core/analyze.ts";

let failed = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`); if (!c) failed++; };
const has = (r, id) => r.findings.some((f) => f.detector === id);

// --- duplicate-substring: same big doc pasted into system AND user ---
// A realistic varied document (many distinct 8-grams), not a periodic sentence.
const doc = Array.from({ length: 80 }, (_, i) =>
  `In fiscal period ${i}, the ${["north", "south", "east", "west"][i % 4]} region reported ` +
  `${i * 7 + 3} units sold at margin ${(i % 9) + 2}.${i % 10}%, driven by ${["retail", "wholesale", "online", "partner"][i % 4]} demand ` +
  `and a ${["seasonal", "promotional", "structural", "one-off"][i % 4]} shift in ${["pricing", "mix", "volume", "currency"][i % 4]}.`
).join(" ");
const dupTrace = [{
  model: "gpt-4o",
  messages: [
    { role: "system", content: "You analyze reports.\n" + doc },
    { role: "user", content: "Summarize this:\n" + doc },
  ],
}];
{
  const r = analyze(dupTrace);
  ok("duplicate-substring fires on pasted-twice doc", has(r, "duplicate-substring"),
    `→ ${r.findings.filter(f=>f.detector==="duplicate-substring").map(f=>f.wastedTokens+"tok")}`);
}

// --- duplicate-substring: distinct content should NOT fire ---
{
  const r = analyze([{ model: "gpt-4o", messages: [
    { role: "system", content: "You are helpful. " + "alpha ".repeat(300) },
    { role: "user", content: "Question about cats " + "beta ".repeat(300) },
  ]}]);
  ok("duplicate-substring quiet on distinct content", !has(r, "duplicate-substring"));
}

// --- reasoning-token-waste: o-series, no effort set, simple task, usage reports reasoning ---
const reasonTrace = [{
  model: "o3-mini",
  messages: [
    { role: "system", content: "Classify the sentiment as positive/negative. Respond with JSON." },
    { role: "user", content: "I love this product." },
    { role: "assistant", content: '{"sentiment":"positive"}' },
  ],
  usage: { prompt_tokens: 40, completion_tokens: 4200, completion_tokens_details: { reasoning_tokens: 4000 } },
}];
{
  const r = analyze(reasonTrace);
  ok("reasoning-token-waste fires on uncontrolled o-series", has(r, "reasoning-token-waste"),
    `→ ${r.findings.filter(f=>f.detector==="reasoning-token-waste").map(f=>f.wastedTokens+"tok")}`);
}

// --- reasoning-token-waste: non-reasoning model must NOT fire ---
{
  const r = analyze([{ model: "gpt-4o", messages: [
    { role: "user", content: "hi" }, { role: "assistant", content: "hello" },
  ], usage: { prompt_tokens: 10, completion_tokens: 5000 } }]);
  ok("reasoning-token-waste quiet on gpt-4o", !has(r, "reasoning-token-waste"));
}

// --- reasoning-token-waste: reasoning model WITH effort set on hard task must NOT fire ---
{
  const r = analyze([{ model: "o3-mini", reasoning_effort: "high",
    messages: [{ role: "user", content: "Prove the Riemann hypothesis step by step in detail across many stages of careful argument." },
      { role: "assistant", content: "Here is a long multi-step attempt ... " + "reasoning ".repeat(300) }],
    usage: { prompt_tokens: 40, completion_tokens: 6000, completion_tokens_details: { reasoning_tokens: 5000 } } }]);
  ok("reasoning-token-waste quiet when effort set + hard task", !has(r, "reasoning-token-waste"));
}

console.log(failed ? `\nFAILED (${failed})` : "\nALL DETECTOR CHECKS PASSED");
process.exit(failed ? 1 : 0);
