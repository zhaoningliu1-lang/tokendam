// P0-1: per-agent cost attribution — the byAgent rollup built from agent/step
// metadata (LangGraph node / LangSmith run / Langfuse obs / tap meta).
import { analyze } from "../src/core/analyze.ts";

let failed = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`); if (!c) failed++; };

const mk = (agent, model, text) => ({
  agent,
  model,
  messages: [{ role: "user", content: text }],
  usage: { prompt_tokens: 100, completion_tokens: 50 },
});

// A cheap router (one short call) + an expensive researcher that loops (two long calls).
const long = "Analyze the quarterly financials in depth and cross-reference every region. ".repeat(40);
const trace = [
  mk("router", "gpt-4o-mini", "route this request"),
  mk("researcher", "gpt-4o", long),
  mk("researcher", "gpt-4o", long + " again"),
];
const r = analyze(trace);

ok("byAgent present when trace carries agent identity", !!r.byAgent);
ok("two distinct agents rolled up", r.byAgent?.length === 2, `got ${r.byAgent?.length}`);
ok("sorted by spend — researcher on top", r.byAgent?.[0]?.id === "researcher");
ok("top spender usd >= second", (r.byAgent?.[0]?.usd ?? 0) >= (r.byAgent?.[1]?.usd ?? 0));
ok("researcher counted its 2 calls", r.byAgent?.find((a) => a.id === "researcher")?.calls === 2);
ok(
  "pctOfSpend sums to ~100 (all calls agented)",
  Math.abs((r.byAgent ?? []).reduce((s, a) => s + a.pctOfSpend, 0) - 100) < 0.5
);

// A plain trace with no agent identity → byAgent stays undefined (unchanged behavior).
const plain = analyze([{ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }]);
ok("plain trace → no byAgent (behavior unchanged)", plain.byAgent === undefined);

// --- agentLoopWaste: one agent invoked >= 4 times is a runaway loop ---
const loop = analyze(Array.from({ length: 6 }, (_, i) => mk("worker", "gpt-4o", long + " iter " + i)));
const loopF = loop.findings.find((f) => f.detector === "agent-loop-waste");
ok("agent-loop-waste fires on a 6x agent loop", !!loopF);
ok("loop finding names the agent + count", !!loopF && /worker/.test(loopF.title) && /6/.test(loopF.title));
ok("loop finding carries recoverable $", (loopF?.wastedUSD ?? 0) > 0);
ok("6x loop is medium (>=8 would be high)", loopF?.severity === "medium");
const under = analyze(Array.from({ length: 3 }, () => mk("worker", "gpt-4o", long)));
ok("no loop finding under threshold (3x)", !under.findings.some((f) => f.detector === "agent-loop-waste"));

// --- stepCostOutlier: one dominating step among small ones ---
const outlier = analyze([
  mk("a", "gpt-4o-mini", "tiny"),
  mk("b", "gpt-4o-mini", "tiny two"),
  mk("c", "gpt-4o-mini", "tiny three"),
  mk("big", "gpt-4o", long + long + long),
]);
ok("step-cost-outlier fires on a dominating step", outlier.findings.some((f) => f.detector === "step-cost-outlier"));

if (r.byAgent)
  console.log(
    "  →",
    r.byAgent.map((a) => `${a.id} ${a.pctOfSpend.toFixed(0)}% $${a.usd.toFixed(4)} ${a.calls}c`).join(" | ")
  );
console.log(failed ? `\n${failed} AGENT CHECK(S) FAILED` : "\nALL AGENT CHECKS PASSED");
process.exit(failed ? 1 : 0);
