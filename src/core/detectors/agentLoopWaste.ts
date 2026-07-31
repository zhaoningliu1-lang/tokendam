import type { Finding, NormCall, NormTrace } from "../types.js";
import { inputUSD } from "../pricing.js";

// Agentic loop waste: one agent/step (by identity) invoked many times in a single
// trace — the classic runaway loop that re-bills its whole context every turn.
// Only fires when the trace carries agent identity (LangGraph/LangSmith/Langfuse/
// tap meta); plain traces are untouched. We diagnose + point to the fix (a turn
// cap + context compaction); we don't change your runtime.

const LOOP_MIN = 4; // an agent invoked this many times is a likely loop, not a plan

function inputTokens(c: NormCall): number {
  const t =
    c.system.reduce((s, m) => s + m.tokens, 0) +
    c.tools.reduce((s, t2) => s + t2.tokens, 0) +
    c.messages.reduce((s, m) => s + m.tokens, 0);
  return t === 0 && c.usage?.inputTokens ? c.usage.inputTokens : t;
}

export function agentLoopWaste(trace: NormTrace): Finding[] {
  const byAgent = new Map<string, number[]>();
  trace.calls.forEach((c, i) => {
    if (!c.agentId) return;
    const a = byAgent.get(c.agentId);
    if (a) a.push(i);
    else byAgent.set(c.agentId, [i]);
  });
  if (!byAgent.size) return [];

  const findings: Finding[] = [];
  for (const [agentId, idxs] of byAgent) {
    if (idxs.length < LOOP_MIN) continue;
    // Iterations past the 2nd are the loop's re-billed input — a capped/compacted
    // agent shouldn't re-run this many times paying full context each turn. Only
    // the input side (the replayed context) is counted as recoverable.
    let wastedTokens = 0;
    let wastedUSD = 0;
    for (const i of idxs.slice(2)) {
      const c = trace.calls[i];
      const inTok = inputTokens(c);
      wastedTokens += inTok;
      wastedUSD += inputUSD(inTok, c.usage?.cachedInputTokens ?? 0, c.price);
    }
    if (wastedUSD <= 0) continue;
    findings.push({
      detector: "agent-loop-waste",
      severity: idxs.length >= 8 ? "high" : "medium",
      title: `Agent "${agentId}" ran ${idxs.length}× — likely a runaway loop`,
      detail: `The "${agentId}" agent/step was invoked ${idxs.length} times in this trace, re-sending its context each turn. Past a couple of iterations that's usually a loop that isn't converging — and every turn re-bills the full input. This is the single most common way agent bills explode.`,
      fix: `Give "${agentId}" a hard turn limit and an explicit stop condition, and summarize/trim prior turns instead of replaying them. If it must loop, add a cache_control marker to the static prefix so re-sends bill at ~10%.`,
      wastedTokens,
      wastedUSD,
      evidence: [`"${agentId}" invoked on calls ${idxs.map((i) => i + 1).join(", ")}`],
      // Overlaps uncompacted-history / duplicate-requests on the looped calls, so
      // keep it out of the headline savings floor.
      secondary: true,
    });
  }
  return findings.sort((a, b) => b.wastedUSD - a.wastedUSD);
}
