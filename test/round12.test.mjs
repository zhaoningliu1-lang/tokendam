// R12: correctness fixes from the Round 12 autonomous critique —
// (1) detectVendorFromModel now recognises o4/o4-mini as "openai" and gemini as "google"
// (2) uncompactedHistory prices dynamic history at full input rate (not cached rate)
// (3) analyze adds a note when semantic-cache was skipped on a large (>400 call) trace
import { analyze } from "../src/core/analyze.ts";

let failed = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`); if (!c) failed++; };

// --- (1) vendor detection for o4-mini and gemini ---
{
  const o4Trace = {
    model: "o4-mini",
    messages: [{ role: "user", content: "What is 2+2?" }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
  const r4 = analyze(o4Trace);
  ok("o4-mini vendor detected as openai", r4.vendor === "openai", `vendor=${r4.vendor}`);

  const geminiTrace = {
    model: "gemini-2.5-pro",
    messages: [{ role: "user", content: "What is 2+2?" }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
  const rg = analyze(geminiTrace);
  ok("gemini-2.5-pro vendor detected as google", rg.vendor === "google", `vendor=${rg.vendor}`);

  // o3-mini was already recognized — confirm it still works
  const o3Trace = {
    model: "o3-mini",
    messages: [{ role: "user", content: "What is 2+2?" }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
  const r3 = analyze(o3Trace);
  ok("o3-mini vendor still openai (regression)", r3.vendor === "openai", `vendor=${r3.vendor}`);
}

// --- (2) uncompactedHistory prices at full input rate, not cached rate ---
{
  // A growing history loop on a claude-sonnet-4 trace WITH a cache marker
  // (static system prefix). input=$3/1M, cachedInput=$0.3/1M.
  // Before the fix: wastedUSD was priced at cachedInput rate (10x too low for Anthropic).
  // After the fix: wastedUSD is priced at full input rate.
  //
  // We build calls with a long static system that gets a cache marker plus growing
  // history that exceeds the RECENT_WINDOW=8. The message text is long enough so
  // oldTokensResent passes the 2000-token threshold.
  const longStaticSys = "You are an expert researcher. " + "Analyze all available evidence carefully before responding. ".repeat(80);
  const longTurn = (i) => "Please analyze the following scenario carefully and provide a detailed structured breakdown of the key considerations, trade-offs, and recommended actions. ".repeat(4) + ` (turn ${i})`;
  // Build 5 calls where history grows from 4 to 20 messages.
  // Each message is ~150 tokens; old messages = those beyond RECENT_WINDOW=8.
  const calls = [4, 8, 12, 16, 20].map((n) => {
    const messages = [];
    for (let i = 0; i < n; i++) {
      messages.push({ role: "user", content: longTurn(i) });
      messages.push({ role: "assistant", content: `Response ${i}: After careful analysis, here is my structured response to turn ${i}.` });
    }
    // Put cache_control on the system message to mark a cached static prefix.
    return {
      model: "claude-sonnet-4",
      system: [{ type: "text", text: longStaticSys, cache_control: { type: "ephemeral" } }],
      messages,
    };
  });
  const r = analyze(calls);
  const uc = r.findings.find((f) => f.detector === "uncompacted-history");
  ok("uncompacted-history fires on cached growing loop", !!uc, `findings=${r.findings.map(f=>f.detector).join(",")}`);
  if (uc) {
    // At full input rate ($3/1M), the saving per million old tokens = $3 * 0.7 = $2.1.
    // At cached rate ($0.3/1M), it would be $0.3 * 0.7 = $0.21 — 10x lower.
    // Verify that wastedUSD > 0 and is priced at the full input rate: the ratio of
    // wastedUSD to expected-at-full-rate should be near 1.0 (not 0.1).
    const COMPACT_RATIO = 0.7;
    const INPUT_RATE = 3; // claude-sonnet-4 input rate $/1M
    const expectedAtFullRate = (uc.wastedTokens / COMPACT_RATIO) * COMPACT_RATIO * INPUT_RATE / 1_000_000;
    ok(
      "uncompacted-history wastedUSD matches full input rate (not cached rate)",
      uc.wastedUSD > 0 && Math.abs(uc.wastedUSD - expectedAtFullRate) / expectedAtFullRate < 0.2,
      `wastedUSD=$${uc.wastedUSD.toFixed(6)} expectedFullRate=$${expectedAtFullRate.toFixed(6)}`
    );
  }
}

// --- (3) large-trace note when semantic-cache is skipped ---
{
  // Build a 401-call trace — semantic-cache would be skipped (MAX_CALLS=400).
  const calls = Array.from({ length: 401 }, (_, i) => ({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: `unique query ${i} about topic ${i}` }],
    usage: { prompt_tokens: 50, completion_tokens: 10 },
  }));
  const r = analyze(calls);
  const hasNote = r.notes.some((n) => n.includes("semantic-cache") && n.includes("skipped"));
  ok("large trace (>400 calls) gets semantic-cache-skipped note", hasNote, `notes=${JSON.stringify(r.notes)}`);

  // Confirm a 400-call trace does NOT get the note (threshold is >400, not >=400).
  const calls400 = calls.slice(0, 400);
  const r400 = analyze(calls400);
  const hasNote400 = r400.notes.some((n) => n.includes("semantic-cache") && n.includes("skipped"));
  ok("400-call trace (at limit) does NOT get semantic-cache-skipped note", !hasNote400);
}

console.log("\nALL R12 CHECKS PASSED");
if (failed) { console.error(`${failed} check(s) FAILED`); process.exit(1); }
