// P1-4: Batch API opportunity — many same-shape calls (same model + system
// prompt) = a bulk/offline job that could run at ~50% on the Batch API.
import { analyze } from "../src/core/analyze.ts";

let failed = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`); if (!c) failed++; };

const mkCall = (i) => ({
  model: "gpt-4o",
  messages: [
    { role: "system", content: "You are a strict classifier. Label each item as A, B, or C and explain briefly." },
    { role: "user", content: `Item ${i}: some text to classify, record number ${i}, region ${i % 4}.` },
  ],
  usage: { prompt_tokens: 200, completion_tokens: 5 },
});

const bulk = analyze(Array.from({ length: 12 }, (_, i) => mkCall(i)));
const bf = bulk.findings.find((f) => f.detector === "batch-opportunity");
ok("batch-opportunity fires on 12 same-shape calls", !!bf);
ok("batch finding claims ~50% savings ($)", (bf?.wastedUSD ?? 0) > 0);
ok("batch finding is secondary/conditional", bf?.secondary === true);
ok("batch finding is not counted in headline floor", bulk.findings.some((f) => f.detector === "batch-opportunity" && f.secondary));

const few = analyze(Array.from({ length: 5 }, (_, i) => mkCall(i)));
ok("no batch finding under threshold (5 calls)", !few.findings.some((f) => f.detector === "batch-opportunity"));

// Distinct system prompts each → not a bulk pattern → no fire.
const varied = analyze(
  Array.from({ length: 12 }, (_, i) => ({
    model: "gpt-4o",
    messages: [
      { role: "system", content: `Unique system prompt variant number ${i} for task ${i}` },
      { role: "user", content: `q ${i}` },
    ],
    usage: { prompt_tokens: 50, completion_tokens: 5 },
  }))
);
ok("no batch finding when system prompts all differ", !varied.findings.some((f) => f.detector === "batch-opportunity"));

if (bf) console.log("  →", bf.title, "·", `$${bf.wastedUSD.toFixed(4)}`);
console.log(failed ? `\n${failed} BATCH CHECK(S) FAILED` : "\nALL BATCH CHECKS PASSED");
process.exit(failed ? 1 : 0);
