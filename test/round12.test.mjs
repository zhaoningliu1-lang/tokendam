// R12: correctness fixes from the Round 12 autonomous critique —
// (1) bloatedContext prices cache-aware → wastedUSD can't exceed the call's real cost
// (2) uncompactedHistory checks cache state per-call, not trace-wide
// (3) detectVendorFromModel: o4-* → "openai", gemini → "google"
import { analyze } from "../src/core/analyze.ts";
import { normalize } from "../src/core/normalize.ts";

let failed = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`); if (!c) failed++; };
const has = (r, id) => r.findings.find((f) => f.detector === id);

// --- (1) bloatedContext cache-aware pricing ---
// A 90%-cached trace with a large user message: bloatedContext.wastedUSD must not
// exceed the call's actual billed cost.
{
  // Large user message: need >3 000 tokens; .repeat(500) ≈ 3 001 tok.
  const bigMsg = "This is detailed analysis content. ".repeat(500); // ~17 500 chars ≈ 3 001 tok
  const r = analyze([{
    model: "claude-opus-4-8",
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: bigMsg },
    ],
    usage: {
      input_tokens: 2000,
      output_tokens: 20,
      cache_read_input_tokens: 1800, // 90% served from cache
    },
  }]);
  const f = has(r, "bloated-context");
  ok("bloated-context fires on a large cached message", !!f);
  ok(
    "bloated-context wastedUSD <= totalUSD (cache-aware pricing)",
    !f || f.wastedUSD <= r.totalUSD + 1e-9,
    f ? `wastedUSD=$${f.wastedUSD.toFixed(5)} totalUSD=$${r.totalUSD.toFixed(5)}` : "no finding"
  );
}

// Same check on a zero-cache trace — bloatedContext should NOT undercount.
{
  const bigMsg = "Detailed analysis sentence number. ".repeat(600); // ~3 000 tok
  const r = analyze([{
    model: "gpt-4o",
    messages: [{ role: "user", content: bigMsg }],
    usage: { prompt_tokens: 2000, completion_tokens: 20 }, // no cached tokens
  }]);
  const f = has(r, "bloated-context");
  ok("bloated-context fires on an uncached large message", !!f);
  ok(
    "bloated-context wastedUSD > 0 on an uncached trace",
    !f || f.wastedUSD > 0,
    f ? `wastedUSD=$${f.wastedUSD.toFixed(5)}` : "no finding"
  );
}

// --- (2) uncompactedHistory per-call cache check ---
// A trace where only SOME calls have cache markers — the per-call check should use
// the cached rate only for those calls, not for all calls.
{
  // Each message ~300 tok (.repeat(50)). With 5 calls adding 3 msgs each, the last call
  // has 15 messages. Old messages = beyond the last 8: call3=4×300=1200 tok,
  // call4=7×300=2100 tok → total old >2000 tok, so the finding fires.
  const makeMsg = (i) => ({ role: "user", content: `Turn ${i}: Analyze this dataset deeply. `.repeat(50) });
  // Build a growing-history trace: later calls have more messages.
  const calls = Array.from({ length: 5 }, (_, i) => ({
    model: "claude-sonnet-4",
    messages: Array.from({ length: i * 3 + 3 }, (_, j) => makeMsg(j)),
    // Only the last two calls have cache markers; the first three do not.
    ...(i >= 3 ? {
      system: [{ type: "text", text: "You are a helpful AI.", cache_control: { type: "ephemeral" } }],
    } : {}),
    usage: { input_tokens: (i + 1) * 400, output_tokens: 30 },
  }));
  const r = analyze(calls);
  const f = has(r, "uncompacted-history");
  ok("uncompacted-history fires on a growing-history trace", !!f);
  // The finding should exist and wastedUSD > 0 (old history does cost money).
  ok("uncompacted-history wastedUSD > 0", !f || f.wastedUSD > 0);
}

// A fully-cached trace: uncompactedHistory savings should use the lower cached rate.
{
  const makeMsg = (i) => ({ role: "user", content: `Turn ${i}: Detailed instruction. `.repeat(50) });
  const calls = Array.from({ length: 5 }, (_, i) => ({
    model: "gpt-4o",
    messages: Array.from({ length: i * 3 + 3 }, (_, j) => makeMsg(j)),
    usage: { prompt_tokens: (i + 1) * 500, output_tokens: 30, prompt_tokens_details: { cached_tokens: (i + 1) * 450 } },
  }));
  const rCached = analyze(calls);
  // Run same calls without caching for comparison.
  const callsNoCached = calls.map(c => ({
    ...c,
    usage: { prompt_tokens: c.usage.prompt_tokens, output_tokens: c.usage.output_tokens },
  }));
  const rUncached = analyze(callsNoCached);
  const fCached = has(rCached, "uncompacted-history");
  const fUncached = has(rUncached, "uncompacted-history");
  ok("uncompacted-history fires on cached and uncached traces", !!fCached && !!fUncached);
  ok(
    "uncompacted-history claims less savings on cached trace than uncached",
    !fCached || !fUncached || fCached.wastedUSD <= fUncached.wastedUSD + 1e-9,
    fCached && fUncached
      ? `cached=$${fCached.wastedUSD.toFixed(5)} uncached=$${fUncached.wastedUSD.toFixed(5)}`
      : "missing findings"
  );
}

// --- (3) detectVendorFromModel: o4-* → "openai", gemini → "google" ---
{
  const o4Trace = normalize([{ model: "o4-mini", messages: [{ role: "user", content: "Hello" }] }]);
  ok('o4-mini vendor = "openai"', o4Trace.vendor === "openai", `vendor=${o4Trace.vendor}`);

  const geminiTrace = normalize([{ model: "gemini-2.5-flash", messages: [{ role: "user", content: "Hello" }] }]);
  ok('gemini-2.5-flash vendor = "google"', geminiTrace.vendor === "google", `vendor=${geminiTrace.vendor}`);
}

console.log(failed ? `\nFAILED (${failed})` : "\nALL R12 CHECKS PASSED");
process.exit(failed ? 1 : 0);
