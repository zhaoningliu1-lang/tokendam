// Round 11 autonomous self-optimization checks.
import { analyze } from "../src/core/analyze.ts";
import { priceFor } from "../src/core/pricing.ts";

let failed = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`); if (!c) failed++; };
const has = (r, id) => r.findings.find((f) => f.detector === id);

// --- Fix 1: claude-sonnet-5 pricing is now $3/$15 (introductory ended 2026-08-31) ---
{
  const p = priceFor("claude-sonnet-5").price;
  ok("sonnet-5 input price is $3/1M (post-intro)", p.input === 3, `got ${p.input}`);
  ok("sonnet-5 output price is $15/1M (post-intro)", p.output === 15, `got ${p.output}`);
  ok("sonnet-5 cachedInput is $0.30/1M (post-intro)", p.cachedInput === 0.3, `got ${p.cachedInput}`);
}

// --- Fix 2: o4-mini (and future o-series) are detected as vendor="openai" ---
{
  const r = analyze([{
    model: "o4-mini",
    messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }]);
  ok("o4-mini vendor detected as openai", r.vendor === "openai", `got "${r.vendor}"`);
}

// --- Fix 2b: o5 (hypothetical future model) also detected as openai ---
{
  const r = analyze([{
    model: "o5-mini",
    messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }]);
  ok("o5-mini vendor detected as openai", r.vendor === "openai", `got "${r.vendor}"`);
}

// --- Fix 3: modelOverkill suggests claude-sonnet-5 for Opus, claude-haiku-4 for Sonnet ---
{
  const bigUser = "Classify the following message. " + "context ".repeat(300);
  const r = analyze([{
    model: "claude-opus-5",
    messages: [
      { role: "system", content: "Classify the sentiment. Respond ONLY with JSON." },
      { role: "user", content: bigUser },
      { role: "assistant", content: '{"sentiment":"positive"}' },
    ],
    usage: { input_tokens: 400, output_tokens: 8 },
  }]);
  const f = has(r, "model-overkill");
  ok("model-overkill fires on claude-opus-5 simple task", !!f);
  ok("model-overkill suggests sonnet-5 for opus", f && f.title.toLowerCase().includes("sonnet 5"), `got: "${f?.title}"`);
}
{
  const bigUser = "Extract the key info. " + "context ".repeat(300);
  const r = analyze([{
    model: "claude-sonnet-5",
    messages: [
      { role: "system", content: "Extract entities. Respond ONLY with JSON." },
      { role: "user", content: bigUser },
      { role: "assistant", content: '{"entity":"foo"}' },
    ],
    usage: { input_tokens: 400, output_tokens: 8 },
  }]);
  const f = has(r, "model-overkill");
  ok("model-overkill fires on claude-sonnet-5 simple task", !!f);
  ok("model-overkill suggests haiku-4 for sonnet", f && f.title.toLowerCase().includes("haiku 4"), `got: "${f?.title}"`);
}

console.log(failed ? `\nFAILED (${failed})` : "\nALL ROUND11 CHECKS PASSED");
process.exit(failed ? 1 : 0);
