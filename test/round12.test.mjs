// Round 12 (autonomous) regression tests.
// (1) claude-sonnet-5 pricing: introductory rate expired 2026-08-31; verify $3/$15 is active.
// (2) o4/o2-class vendor detection: o4-mini must resolve to "openai", not "unknown".
import { analyze } from "../src/core/analyze.ts";
import { priceFor } from "../src/core/pricing.ts";

let failed = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`); if (!c) failed++; };

// --- (1) claude-sonnet-5 price is now $3 input / $15 output ---
{
  const { price } = priceFor("claude-sonnet-5");
  ok("sonnet-5 input price is $3/1M (post-intro)", price.input === 3, `got ${price.input}`);
  ok("sonnet-5 cached price is $0.30/1M", price.cachedInput === 0.3, `got ${price.cachedInput}`);
  ok("sonnet-5 output price is $15/1M", price.output === 15, `got ${price.output}`);
}
// Verify that a Sonnet-5 trace no longer underreports cost.
// Use empty messages so callInputTokens falls back to usage.inputTokens (=1M),
// giving $3 in + $15 out = $18 total (vs $12 at the old stale $2/$10 rate).
{
  const trace = [{ model: "claude-sonnet-5",
    messages: [],
    usage: { input_tokens: 1000000, output_tokens: 1000000 } }];
  const r = analyze(trace);
  ok("sonnet-5 trace total >= $17 (not old $12 undercount)", r.totalUSD >= 17, `totalUSD=${r.totalUSD.toFixed(2)}`);
}

// --- (2) o4-mini vendor resolves to "openai" ---
{
  const trace = [{ model: "o4-mini",
    messages: [{ role: "user", content: "What is 2+2?" }, { role: "assistant", content: "4" }],
    usage: { prompt_tokens: 20, completion_tokens: 2 } }];
  const r = analyze(trace);
  ok("o4-mini vendor is 'openai' (not 'unknown')", r.vendor === "openai", `got '${r.vendor}'`);
}
// Verify pricing lookup works for o4-mini (sanity: it was already correct)
{
  const { price, matched } = priceFor("o4-mini");
  ok("o4-mini price matched (not fallback)", matched === true, `matched=${matched}`);
  ok("o4-mini input price is $1.10/1M", price.input === 1.1, `got ${price.input}`);
}
// o3-mini also works (was already in the startsWith("o3") path)
{
  const r = analyze([{ model: "o3-mini",
    messages: [{ role: "user", content: "hi" }],
    usage: { prompt_tokens: 5, completion_tokens: 1 } }]);
  ok("o3-mini vendor still 'openai'", r.vendor === "openai", `got '${r.vendor}'`);
}
// o1 still works too
{
  const r = analyze([{ model: "o1",
    messages: [{ role: "user", content: "hi" }],
    usage: { prompt_tokens: 5, completion_tokens: 1 } }]);
  ok("o1 vendor still 'openai'", r.vendor === "openai", `got '${r.vendor}'`);
}

console.log(failed ? `\nFAILED (${failed})` : "\nALL R12 CHECKS PASSED");
process.exit(failed ? 1 : 0);
