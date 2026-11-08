// R12 (autonomous): correctness fixes from Round 12 critique —
// (1) detectVendorFromModel: Gemini traces get vendor "google", o4-mini gets "openai"
// (2) unusedCache: Gemini traces get Gemini-specific fix advice, not OpenAI advice
// (3) ghPrComment: HTTP errors surface with the status code (tested via unit injection)
import { analyze } from "../src/core/analyze.ts";

let failed = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`); if (!c) failed++; };

const repeat = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));

// --- (1) + (2): Gemini trace -> vendor "google", unusedCache fix cites Gemini Context Caching ---
{
  // Use prose-like text so it doesn't compress aggressively; need > 1024 tokens
  const lines = Array.from({ length: 200 }, (_, i) =>
    `Rule ${i}: When the user asks about topic ${i}, respond with detailed information covering aspects ${i * 3}, ${i * 3 + 1}, and ${i * 3 + 2}.`
  );
  const sys = "You are a highly knowledgeable assistant with the following rules:\n" + lines.join("\n");
  const calls = repeat(4, (i) => ({
    model: "gemini-2.5-flash",
    messages: [{ role: "system", content: sys }, { role: "user", content: `Turn ${i}` }],
    usage: { input_tokens: 5100, output_tokens: 50 },
  }));
  const r = analyze(calls);
  ok("Gemini trace -> vendor 'google'", r.vendor === "google", `vendor=${r.vendor}`);
  const uc = r.findings.find((f) => f.detector === "unused-cache");
  ok("Gemini trace -> unusedCache fires", !!uc);
  if (uc) {
    ok(
      "Gemini unusedCache fix mentions 'Gemini' (not OpenAI auto-cache advice)",
      uc.fix.includes("Gemini") && !uc.fix.includes("OpenAI"),
      `fix="${uc.fix.slice(0, 80)}…"`
    );
  }
}

// --- (1): o4-mini trace -> vendor "openai" (was "unknown" before fix) ---
{
  const sys = "You are a helpful assistant. " + "Y".repeat(5000);
  const calls = repeat(4, (i) => ({
    model: "o4-mini",
    messages: [{ role: "system", content: sys }, { role: "user", content: `Turn ${i}` }],
    usage: { input_tokens: 5100, output_tokens: 50 },
  }));
  const r = analyze(calls);
  ok("o4-mini trace -> vendor 'openai'", r.vendor === "openai", `vendor=${r.vendor}`);
  const uc = r.findings.find((f) => f.detector === "unused-cache");
  ok("o4-mini unusedCache fires and gives OpenAI advice", !!uc && uc.fix.includes("OpenAI"));
}

// --- (1): claude-sonnet-4-6 still resolves to "anthropic" (regression guard) ---
{
  const r = analyze([{
    model: "claude-sonnet-4-6",
    messages: [{ role: "user", content: "hello" }],
    usage: { input_tokens: 100, output_tokens: 10 },
  }]);
  ok("claude-sonnet-4-6 -> vendor 'anthropic'", r.vendor === "anthropic", `vendor=${r.vendor}`);
}

// --- summary ---
if (failed) { console.error(`\n${failed} ROUND 12 CHECK(S) FAILED`); process.exit(1); }
console.log("\nALL R12 CHECKS PASSED");
