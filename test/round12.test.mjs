// R12 (autonomous): three correctness fixes —
// (1) claude-sonnet-5 post-intro pricing ($3/$15, was $2/$10 through 2026-08-31),
// (2) detectVendorFromModel now catches o4-mini (was "unknown", now "openai"),
// (3) bloatedContext is cache-aware (no longer overstates waste on cached traces).
import { analyze } from "../src/core/analyze.ts";
import { priceFor } from "../src/core/pricing.ts";

let failed = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`); if (!c) failed++; };

// --- (1) claude-sonnet-5 price: intro period ended 2026-08-31 → $3/$15 ---
{
  const { price, matched } = priceFor("claude-sonnet-5");
  ok("claude-sonnet-5 matched in price table", matched);
  ok("claude-sonnet-5 input price is $3 (post-intro)", price.input === 3, `got ${price.input}`);
  ok("claude-sonnet-5 output price is $15 (post-intro)", price.output === 15, `got ${price.output}`);
  ok("claude-sonnet-5 cachedInput is $0.30", price.cachedInput === 0.3, `got ${price.cachedInput}`);
}

// --- (2) o4-mini vendor detection: was "unknown", must now be "openai" ---
{
  const trace = analyze([{
    model: "o4-mini",
    messages: [{ role: "user", content: "Solve this step-by-step." }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  }]);
  ok("o4-mini trace vendor is 'openai' (not 'unknown')", trace.vendor === "openai", `got '${trace.vendor}'`);
  ok("o4-mini is priced (not the fallback mid-range)", priceFor("o4-mini").matched);
}

// --- (3) bloatedContext cache-aware: wastedUSD <= totalUSD on a heavily-cached trace ---
{
  // A call with a 5000-token user message (bloated) AND 95% of input already cached.
  // Old code: wastedUSD = 5000 * 0.4 * price.input / 1M (ignores cache).
  // New code: wastedUSD uses the blended rate → much lower → can't exceed totalUSD.
  const bigText = Array.from({ length: 500 }, (_, i) => `Sentence number ${i} is part of the scraped page body.`).join(" ");
  const trace = analyze([{
    model: "claude-opus-5",
    messages: [{ role: "user", content: bigText }],
    usage: {
      input_tokens: 5200,
      output_tokens: 80,
      cache_read_input_tokens: 4940, // 95% from cache
    },
  }]);
  const bloated = trace.findings.find((f) => f.detector === "bloated-context");
  ok("bloated-context fires on a 5k-token user message", !!bloated);
  if (bloated) {
    ok(
      "bloated-context wastedUSD <= totalUSD (cache-aware)",
      bloated.wastedUSD <= trace.totalUSD + 1e-9,
      `wastedUSD=$${bloated.wastedUSD.toFixed(5)} totalUSD=$${trace.totalUSD.toFixed(5)}`
    );
    // Sanity: with heavy caching, blended rate ≈ cachedInput rate; waste must be much
    // less than the naive full-rate calculation would give.
    const naiveUSD = (5000 * 0.4 * 5) / 1_000_000; // full opus-5 input rate
    ok(
      "cache-aware wastedUSD < naive full-rate estimate",
      bloated.wastedUSD < naiveUSD,
      `cache-aware=$${bloated.wastedUSD.toFixed(5)} naive=$${naiveUSD.toFixed(5)}`
    );
  }
}

if (failed) { console.error(`\n${failed} R12 CHECK(S) FAILED`); process.exit(1); }
console.log("\nALL R12 CHECKS PASSED");
