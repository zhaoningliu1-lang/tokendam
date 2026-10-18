// R12 (autonomous): three correctness fixes —
// (1) claude-sonnet-5 pricing updated to $3/$15 (introductory period ended 2026-08-31),
// (2) o4-mini vendor detected as "openai" (was "unknown"),
// (3) gpt-5-mini/gpt-5-nano excluded from reasoning-token estimation unless
//     reasoningTokens is explicitly reported.
import { analyze } from "../src/core/analyze.ts";

let failed = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`); if (!c) failed++; };
const has = (r, id) => r.findings.some((f) => f.detector === id);

// --- (1) claude-sonnet-5 pricing: $3/$15 (same as Sonnet 4.x, not the old $2/$10) ---
// Both Sonnet-5 and Sonnet-4 should now cost the same for identical calls. Pre-fix,
// Sonnet-5 was 2/3 the cost of Sonnet-4 (introductory rate); post-fix they're equal.
{
  const content = "word ".repeat(250);
  const s5 = analyze([{ model: "claude-sonnet-5", messages: [{ role: "user", content }] }]);
  const s4 = analyze([{ model: "claude-sonnet-4", messages: [{ role: "user", content }] }]);
  const ratio = s4.totalUSD > 0 ? s5.totalUSD / s4.totalUSD : 0;
  ok(
    "claude-sonnet-5 costs the same as claude-sonnet-4 (both $3/1M input, $15/1M output)",
    Math.abs(ratio - 1.0) < 1e-6,
    `ratio=${ratio.toFixed(6)} (pre-fix would be 0.6667; want 1.0000)`
  );
}
// Verify output cost similarly: Sonnet-5 with explicit output usage == Sonnet-4.
{
  const content = "explain ".repeat(100);
  const opts = { input_tokens: 500, output_tokens: 1000 };
  const s5 = analyze([{ model: "claude-sonnet-5", messages: [{ role: "user", content }], usage: opts }]);
  const s4 = analyze([{ model: "claude-sonnet-4", messages: [{ role: "user", content }], usage: opts }]);
  const ratio = s4.totalUSD > 0 ? s5.totalUSD / s4.totalUSD : 0;
  ok(
    "claude-sonnet-5 with usage tokens matches claude-sonnet-4 cost exactly",
    Math.abs(ratio - 1.0) < 1e-6,
    `ratio=${ratio.toFixed(6)} s5=$${s5.totalUSD.toFixed(6)} s4=$${s4.totalUSD.toFixed(6)}`
  );
}

// --- (2) o4-mini vendor detection: must be "openai", not "unknown" ---
{
  const r = analyze([{
    model: "o4-mini",
    messages: [{ role: "user", content: "Count to 3." }],
    usage: { prompt_tokens: 20, completion_tokens: 10 },
  }]);
  ok(
    "o4-mini reports vendor 'openai'",
    r.vendor === "openai",
    `got '${r.vendor}'`
  );
}
{
  // o4-mini in a multi-call trace — still openai
  const r = analyze([
    { model: "o4-mini", messages: [{ role: "user", content: "A" }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
    { model: "o4-mini", messages: [{ role: "user", content: "B" }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
  ]);
  ok("o4-mini multi-call trace vendor 'openai'", r.vendor === "openai", `got '${r.vendor}'`);
}

// --- (3a) gpt-5-mini: high output, NO reasoningTokens reported → must NOT fire reasoning-token-waste ---
// This was the false-positive: a usage-only record with 3000 output tokens and no
// reported reasoning was being treated as a reasoning model with estimated hidden tokens.
{
  const r = analyze([{
    model: "gpt-5-mini",
    messages: [{ role: "system", content: "Summarize this for me." }],
    usage: { prompt_tokens: 200, completion_tokens: 3000 },
    // No reasoningTokens in usage — this is NOT a reasoning call.
  }]);
  ok(
    "gpt-5-mini with no reported reasoningTokens does NOT trigger reasoning-token-waste",
    !has(r, "reasoning-token-waste"),
    `findings: [${r.findings.map(f => f.detector).join(", ")}]`
  );
}
{
  const r = analyze([{
    model: "gpt-5-nano",
    messages: [{ role: "system", content: "Route this ticket to the right department." }],
    usage: { prompt_tokens: 500, completion_tokens: 2000 },
  }]);
  ok(
    "gpt-5-nano with no reported reasoningTokens does NOT trigger reasoning-token-waste",
    !has(r, "reasoning-token-waste"),
    `findings: [${r.findings.map(f => f.detector).join(", ")}]`
  );
}

// --- (3b) gpt-5-mini WITH explicit reasoningTokens: SHOULD fire reasoning-token-waste ---
// Confirming the fix doesn't suppress legitimate findings when the model actually reports reasoning.
{
  const r = analyze([{
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: "Classify the sentiment. Respond with JSON only." },
      { role: "user", content: "This is great!" },
      { role: "assistant", content: '{"s":"positive"}' },
    ],
    usage: {
      prompt_tokens: 40,
      completion_tokens: 3500,
      completion_tokens_details: { reasoning_tokens: 3200 },
    },
  }]);
  ok(
    "gpt-5-mini WITH explicit reasoningTokens DOES fire reasoning-token-waste",
    has(r, "reasoning-token-waste"),
    `findings: [${r.findings.map(f => f.detector).join(", ")}]`
  );
}

// --- (regression) full gpt-5 (non-mini) still classifies as reasoning model ---
{
  const r = analyze([{
    model: "gpt-5",
    messages: [
      { role: "system", content: "Classify sentiment as positive/negative. JSON." },
      { role: "user", content: "I love this." },
      { role: "assistant", content: '{"s":"positive"}' },
    ],
    usage: { prompt_tokens: 40, completion_tokens: 3000, completion_tokens_details: { reasoning_tokens: 2800 } },
  }]);
  ok(
    "full gpt-5 with explicit reasoningTokens still fires reasoning-token-waste",
    has(r, "reasoning-token-waste"),
    `findings: [${r.findings.map(f => f.detector).join(", ")}]`
  );
}

console.log(failed ? `\nFAILED (${failed})` : "\nALL R12 CHECKS PASSED");
process.exit(failed ? 1 : 0);
