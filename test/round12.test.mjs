// R12: autonomous self-optimization round — three correctness fixes:
// (1) claude-sonnet-5 price updated from introductory ($2/$10) to standard ($3/$15)
// (2) bloatedContext now prices cache-aware (closes the Round 11 "moat bug" class)
// (3) detectVendorFromModel: o4-* → openai, gemini-* → google (was "unknown")
import { priceFor } from "../src/core/pricing.ts";
import { analyze } from "../src/core/analyze.ts";

let failed = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`); if (!c) failed++; };
const has = (r, id) => r.findings.find((f) => f.detector === id);

// --- (1) Sonnet 5 uses post-introductory price ($3/$15, not $2/$10) ---
{
  const p = priceFor("claude-sonnet-5").price;
  ok("claude-sonnet-5 input price is now $3 (not introductory $2)", p.input === 3, `got ${p.input}`);
  ok("claude-sonnet-5 output price is now $15 (not introductory $10)", p.output === 15, `got ${p.output}`);
  ok("claude-sonnet-5-5 also matches sonnet-5 entry (longest-substring)", priceFor("claude-sonnet-5-5").price.input === 3);

  // Verify pricing via a usage-only call (no messages → callInputTokens falls back
  // to usage.inputTokens, so the cost reflects the price table directly).
  const r = analyze([{
    model: "claude-sonnet-5",
    messages: [],
    usage: { input_tokens: 1000, output_tokens: 200 },
  }]);
  const expected = (1000 * 3 + 200 * 15) / 1_000_000; // $0.006
  ok(
    "sonnet-5 trace totalUSD uses $3/$15 pricing",
    Math.abs(r.totalUSD - expected) < 1e-9,
    `got $${r.totalUSD.toFixed(6)} expected $${expected.toFixed(6)}`
  );
}

// --- (2) bloatedContext is now cache-aware ---
{
  // Build a trace with a heavily-cached call that also has a big context chunk.
  // 95% caching: effective per-token rate ≈ input * (0.05 + 0.95 * 0.1) = 14.5% of input.
  // Before the fix, wastedUSD was computed at the full uncached input rate → ~7x too high.
  // BLOAT_THRESHOLD = 3000 tok; ~10 tokens/repeat, so 310 reps ≈ 3100 tokens.
  const bigContent = "Analyze the following quarterly earnings report section by section. ".repeat(310); // ~3100 tokens
  const call = {
    model: "gpt-4o",   // input=$2.5, cached=$1.25 per 1M
    messages: [
      { role: "user", content: bigContent },
    ],
    usage: { prompt_tokens: 4000, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 3800 } },
  };
  const r = analyze([call]);
  const f = has(r, "bloated-context");
  ok("bloatedContext fires on 720+ token message", !!f, f ? "" : "no finding");
  if (f) {
    ok(
      "bloatedContext wastedUSD <= trace totalUSD (cache-aware invariant)",
      f.wastedUSD <= r.totalUSD + 1e-9,
      `finding $${f.wastedUSD.toFixed(5)} vs trace $${r.totalUSD.toFixed(5)}`
    );
    // The effective rate is ~14.5% of uncached; the finding should be well below
    // what the uncached calculation would have produced.
    const uncachedEstimate = 4000 * 0.4 * 2.5 / 1_000_000; // old (wrong) formula
    ok(
      "bloatedContext wastedUSD is lower than the old uncached estimate (cache discount applied)",
      f.wastedUSD < uncachedEstimate,
      `finding $${f.wastedUSD.toFixed(5)} < old-estimate $${uncachedEstimate.toFixed(5)}`
    );
  }
}

// --- (3) vendor detection: o4-mini → openai, gemini-2.5-pro → google ---
{
  const o4Trace = analyze([{
    model: "o4-mini",
    messages: [{ role: "user", content: "Classify this document." }, { role: "assistant", content: "Category: legal" }],
    usage: { input_tokens: 500, output_tokens: 10 },
  }]);
  ok("o4-mini vendor is 'openai' (not 'unknown')", o4Trace.vendor === "openai", `got ${o4Trace.vendor}`);

  const geminiTrace = analyze([{
    model: "gemini-2.5-pro",
    messages: [{ role: "user", content: "Summarize this." }, { role: "assistant", content: "Summary." }],
    usage: { input_tokens: 300, output_tokens: 50 },
  }]);
  ok("gemini-2.5-pro vendor is 'google' (not 'unknown')", geminiTrace.vendor === "google", `got ${geminiTrace.vendor}`);

  // Mixed trace with o4-mini + gemini should be "mixed"
  const mixedTrace = analyze([
    { model: "o4-mini", messages: [{ role: "user", content: "First call." }], usage: { input_tokens: 100, output_tokens: 10 } },
    { model: "gemini-2.5-flash", messages: [{ role: "user", content: "Second call." }], usage: { input_tokens: 100, output_tokens: 10 } },
  ]);
  ok("o4-mini + gemini trace vendor is 'mixed'", mixedTrace.vendor === "mixed", `got ${mixedTrace.vendor}`);
}

console.log(failed ? `\nFAILED (${failed})` : "\nALL R12 CHECKS PASSED");
process.exit(failed ? 1 : 0);
