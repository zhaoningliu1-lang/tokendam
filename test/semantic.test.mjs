// P1-5: semantic-cache opportunity — near-identical requests an exact cache misses,
// detected with local n-gram similarity. Must NOT false-fire on a growing agent
// conversation (superset relationship) or on exact duplicates.
import { analyze } from "../src/core/analyze.ts";

let failed = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`); if (!c) failed++; };

const base =
  "Summarize the following support ticket and classify its urgency. The customer reports intermittent errors when saving records under heavy load and asks for a resolution timeline. Reference ticket ";

// Near-identical: differ only by a trailing id → an exact cache misses them.
const nearDup = analyze(
  Array.from({ length: 4 }, (_, i) => ({
    model: "gpt-4o",
    messages: [{ role: "user", content: base + (10000 + i) }],
    usage: { prompt_tokens: 300, completion_tokens: 40 },
  }))
);
const sf = nearDup.findings.find((f) => f.detector === "semantic-cache-opportunity");
ok("semantic-cache fires on near-identical requests (differ by id)", !!sf);
ok("semantic-cache is secondary", sf?.secondary === true);
ok("semantic-cache claims recoverable $", (sf?.wastedUSD ?? 0) > 0);

// Exact duplicates belong to duplicate-requests, not semantic-cache.
const exact = analyze(
  Array.from({ length: 3 }, () => ({
    model: "gpt-4o",
    messages: [{ role: "user", content: base + "FIXED" }],
    usage: { prompt_tokens: 300, completion_tokens: 40 },
  }))
);
ok("exact dups don't trigger semantic-cache", !exact.findings.some((f) => f.detector === "semantic-cache-opportunity"));

// Growing conversation (each turn a superset of the last) must NOT false-fire.
let hist = "User: help me plan a two week trip to Japan in spring on a mid-range budget.";
const grow = [];
for (let i = 0; i < 6; i++) {
  hist += ` Assistant: got it, follow-up ${i} about your preferences? User: answer ${i} describing region ${i}, food, pace, and budget details for segment ${i}.`;
  grow.push({ model: "gpt-4o", messages: [{ role: "user", content: hist }], usage: { prompt_tokens: 200, completion_tokens: 30 } });
}
ok("growing conversation does NOT false-fire semantic-cache", !analyze(grow).findings.some((f) => f.detector === "semantic-cache-opportunity"));

if (sf) console.log("  →", sf.title, "·", `$${sf.wastedUSD.toFixed(4)}`);
console.log(failed ? `\n${failed} SEMANTIC CHECK(S) FAILED` : "\nALL SEMANTIC CHECKS PASSED");
process.exit(failed ? 1 : 0);
