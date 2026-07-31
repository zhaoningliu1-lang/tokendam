// R11: correctness fixes from the Round 11 critique army —
// (1) the 4 new detectors price cache-aware → no finding's $ exceeds the trace's real cost,
// (2) extractMeta no longer fabricates an agentId from a generic name/node,
// (3) the one-pager gates "already optimized" on recoverable value, not finding count.
import { analyze } from "../src/core/analyze.ts";
import { renderOnePager } from "../src/core/onePager.ts";

let failed = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`); if (!c) failed++; };
const has = (r, id) => r.findings.find((f) => f.detector === id);
const maxFindingUSD = (r) => r.findings.reduce((m, f) => Math.max(m, f.wastedUSD || 0), 0);

// --- (1) cache-aware pricing: a 95%-cached bulk job — no finding can exceed the real cost ---
{
  const sys =
    "You are a strict classifier.\n" +
    Array.from({ length: 150 }, (_, i) => `Rule ${i}: assign label ${i % 9} when the input matches pattern ${i}.`).join("\n");
  const calls = Array.from({ length: 12 }, (_, i) => ({
    model: "gpt-4o",
    messages: [{ role: "system", content: sys }, { role: "user", content: `Distinct item number ${i} to classify now` }],
    usage: { prompt_tokens: 4000, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 3800 } },
  }));
  const r = analyze(calls);
  ok("batch-opportunity fires on 12 cached same-shape calls", !!has(r, "batch-opportunity"));
  ok(
    "NO finding's wastedUSD exceeds the trace's real cost (cache-aware)",
    maxFindingUSD(r) <= r.totalUSD + 1e-9,
    `max finding $${maxFindingUSD(r).toFixed(5)} vs trace $${r.totalUSD.toFixed(5)}`
  );
}

// --- (1b) agent-loop-waste on a cached loop: the loop finding <= trace cost ---
{
  const long = "Deeply analyze the quarterly financials and cross-reference every region and segment. ".repeat(30);
  const calls = Array.from({ length: 6 }, (_, i) => ({
    agent: "researcher",
    model: "gpt-4o",
    messages: [{ role: "user", content: long + " pass " + i }],
    usage: { prompt_tokens: 3000, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 2900 } },
  }));
  const r = analyze(calls);
  const f = has(r, "agent-loop-waste");
  ok("agent-loop-waste fires on a cached 6x loop", !!f);
  ok(
    "agent-loop-waste $ <= trace cost (cache-aware)",
    !f || f.wastedUSD <= r.totalUSD + 1e-9,
    f ? `$${f.wastedUSD.toFixed(5)} <= $${r.totalUSD.toFixed(5)}` : ""
  );
}

// --- (2) a plain trace whose elements carry a benign `name` must NOT mint an agentId ---
{
  const r = analyze(
    Array.from({ length: 5 }, () => ({
      name: "chatCompletion", // a benign log label — NOT an agent
      model: "gpt-4o",
      messages: [{ role: "user", content: "Summarize this document briefly." }],
      usage: { prompt_tokens: 60, completion_tokens: 20 },
    }))
  );
  ok("plain trace w/ `name` -> no per-agent rollup", r.byAgent === undefined, `byAgent=${JSON.stringify(r.byAgent)}`);
  ok("plain trace w/ `name` -> no phantom runaway-loop finding", !has(r, "agent-loop-waste"));
}
// regression guard: an EXPLICIT `agent` field still attributes (the kept path)
{
  const long = "Analyze the data in depth and report the findings. ".repeat(30);
  const r = analyze(
    Array.from({ length: 5 }, (_, i) => ({
      agent: "planner",
      model: "gpt-4o",
      messages: [{ role: "user", content: long + i }],
      usage: { prompt_tokens: 800, completion_tokens: 20 },
    }))
  );
  ok("explicit `agent` field still yields byAgent + loop", !!r.byAgent && !!has(r, "agent-loop-waste"));
}

// --- (3) one-pager: a $0-only advisory trace reads "already optimized", not "$0/mo waste" ---
{
  const r = analyze([
    { model: "gpt-4o-mini", messages: [{ role: "user", content: "First unrelated question about shipping." }], usage: { prompt_tokens: 120, completion_tokens: 30 } },
    { model: "gpt-4o-mini", messages: [{ role: "user", content: "Second unrelated question about returns." }], usage: { prompt_tokens: 120, completion_tokens: 30 } },
    { model: "gpt-4o-mini", messages: [{ role: "user", content: "Third unrelated question about billing." }], usage: { prompt_tokens: 120, completion_tokens: 30 } },
    { model: "gpt-4o", messages: [{ role: "user", content: "Provide a detailed quarterly financial breakdown by region and summarize the top risks." }], usage: { prompt_tokens: 2000, completion_tokens: 60 } },
  ]);
  const html = renderOnePager(r, 1000);
  const zeroWaste = r.savableUSD <= 0;
  ok(
    "test trace exercises the $0-advisory path (savableUSD<=0, findings present)",
    zeroWaste && r.findings.length > 0,
    `savableUSD=${r.savableUSD.toFixed(6)} findings=[${r.findings.map((f) => f.detector).join(",") || "none"}]`
  );
  ok("one-pager says 'already well optimized' when savableUSD<=0", !zeroWaste || /already well optimized/.test(html));
  ok("one-pager NEVER claims 'source(s) of waste' when savableUSD<=0", !zeroWaste || !/source\(s\) of waste/.test(html));
}

console.log(failed ? `\nFAILED (${failed})` : "\nALL R11 CHECKS PASSED");
process.exit(failed ? 1 : 0);
