import type { Finding, NormCall, NormTrace } from "../types.js";

// Step cost outlier: one call/step whose cost dwarfs the median across the trace.
// A dominating step is usually over-large context, an over-powered model for a
// simple sub-task, or an unbounded tool result — often the cheapest big win.
// Advisory (no $ claimed): it points attention, it doesn't assert waste.

const OUTLIER_X = 5; // fire when the top step is this many× the median

function inputTokens(c: NormCall): number {
  const t =
    c.system.reduce((s, m) => s + m.tokens, 0) +
    c.tools.reduce((s, t2) => s + t2.tokens, 0) +
    c.messages.reduce((s, m) => s + m.tokens, 0);
  return t === 0 && c.usage?.inputTokens ? c.usage.inputTokens : t;
}
const money = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);

export function stepCostOutlier(trace: NormTrace): Finding[] {
  const calls = trace.calls;
  if (calls.length < 4) return []; // need enough calls for a meaningful median

  const costed = calls.map((c, i) => {
    const inTok = inputTokens(c);
    const outTok = c.usage?.outputTokens ?? c.usage?.reasoningTokens ?? 0;
    const usd = (inTok * c.price.input + outTok * c.price.output) / 1_000_000;
    return { i, usd, label: c.agentId ?? c.stepId };
  });
  const sortedUsd = costed.map((x) => x.usd).sort((a, b) => a - b);
  const median = sortedUsd[Math.floor(sortedUsd.length / 2)] || 0;
  if (median <= 0) return [];

  const top = costed.reduce((m, x) => (x.usd > m.usd ? x : m), costed[0]);
  if (top.usd < median * OUTLIER_X) return [];

  const who = top.label ? `"${top.label}" (call ${top.i + 1})` : `call ${top.i + 1}`;
  return [
    {
      detector: "step-cost-outlier",
      severity: "low",
      title: `One step costs ${(top.usd / median).toFixed(0)}× the median — ${who}`,
      detail: `${who} cost ${money(top.usd)} against a median of ${money(median)} across ${calls.length} calls. A single dominating step is usually over-large context, an over-powered model for a simple sub-task, or an unbounded tool result — worth a look before anything else.`,
      fix: `Inspect ${who}: trim its input context, route it to a cheaper model if the task is simple, or cap the tool output it ingests.`,
      wastedTokens: 0,
      wastedUSD: 0,
      // Advisory pointer, not a savings claim — excluded from the headline floor.
      secondary: true,
    },
  ];
}
