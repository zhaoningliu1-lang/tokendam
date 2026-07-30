import type { NormCall, NormTrace, Report, Finding, AgentCost } from "./types.js";
import { normalize } from "./normalize.js";
import { priceFor } from "./pricing.js";
import { isEstimatedVendor } from "./tokens.js";
import { unusedCache } from "./detectors/unusedCache.js";
import { bloatedContext } from "./detectors/bloatedContext.js";
import { redundantTools } from "./detectors/redundantTools.js";
import { uncompactedHistory } from "./detectors/uncompactedHistory.js";
import { duplicateSubstring } from "./detectors/duplicateSubstring.js";
import { reasoningTokenWaste } from "./detectors/reasoningTokenWaste.js";
import { modelOverkill } from "./detectors/modelOverkill.js";
import { duplicateRequests } from "./detectors/duplicateRequests.js";
import { agentLoopWaste } from "./detectors/agentLoopWaste.js";
import { stepCostOutlier } from "./detectors/stepCostOutlier.js";
import { batchOpportunity } from "./detectors/batchOpportunity.js";

const SEV_ORDER = { high: 0, medium: 1, low: 2 } as const;

function callInputTokens(c: NormCall): number {
  const sys = c.system.reduce((s, m) => s + m.tokens, 0);
  const tools = c.tools.reduce((s, t) => s + t.tokens, 0);
  const msgs = c.messages.reduce((s, m) => s + m.tokens, 0);
  const computed = sys + tools + msgs;
  // Usage-only calls (e.g. OpenAI Batch/Admin exports) carry no messages —
  // fall back to the measured input tokens so spend still reflects reality.
  if (computed === 0 && c.usage?.inputTokens) return c.usage.inputTokens;
  return computed;
}

/** Analyze a raw pasted/loaded trace object and produce a Report. */
export function analyze(input: unknown): Report {
  const trace: NormTrace = normalize(input);

  // Each call is priced by ITS OWN model (c.price), so a mixed-model trace —
  // a cheap classifier plus an expensive agent in one log — is costed correctly
  // instead of with a single trace-wide price.
  const models = [...new Set(trace.calls.map((c) => c.model))];
  const model = models.length === 1 ? models[0] : `mixed (${models.length} models)`;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedTokens = 0;
  let totalUSD = 0;
  const agentAgg = new Map<string, { calls: number; tokens: number; usd: number }>();
  for (const c of trace.calls) {
    const p = c.price;
    const inTok = callInputTokens(c);
    // Tokens the provider already served from cache bill at the cache-hit rate.
    const cached = Math.min(inTok, c.usage?.cachedInputTokens ?? 0);
    // completion_tokens already includes reasoning tokens; only fall back to
    // reasoningTokens when no output count was reported.
    const outTok = c.usage?.outputTokens ?? c.usage?.reasoningTokens ?? 0;
    const callUSD =
      ((inTok - cached) * p.input + cached * p.cachedInput + outTok * p.output) / 1_000_000;
    totalInputTokens += inTok;
    totalOutputTokens += outTok;
    totalCachedTokens += cached;
    totalUSD += callUSD;
    // Per-agent rollup — only when the trace carried agent identity.
    if (c.agentId) {
      const a = agentAgg.get(c.agentId) ?? { calls: 0, tokens: 0, usd: 0 };
      a.calls += 1;
      a.tokens += inTok + outTok;
      a.usd += callUSD;
      agentAgg.set(c.agentId, a);
    }
  }

  const findings: Finding[] = [
    ...unusedCache(trace),
    ...bloatedContext(trace),
    ...redundantTools(trace),
    ...uncompactedHistory(trace),
    ...duplicateSubstring(trace),
    ...reasoningTokenWaste(trace),
    ...modelOverkill(trace),
    ...duplicateRequests(trace),
    ...agentLoopWaste(trace),
    ...stepCostOutlier(trace),
    ...batchOpportunity(trace),
  ].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.wastedUSD - a.wastedUSD);

  // Savings can conceptually overlap between detectors; cap at 90% of spend so
  // the headline stays credible. `secondary` findings (whose tokens are already
  // counted by another finding) are excluded from the sum to avoid inflation.
  const rawSavable = findings.reduce((s, f) => s + (f.secondary ? 0 : f.wastedUSD), 0);
  const savableUSD = Math.min(rawSavable, totalUSD * 0.9);
  const savablePct = totalUSD > 0 ? (savableUSD / totalUSD) * 100 : 0;

  // Token-level analog of the $ savings, for the "Effective Tokens" headline:
  // how many of your tokens actually did work vs. were structural waste. Same
  // secondary-exclusion + 90% cap so the number stays a credible floor.
  const totalTokens = totalInputTokens + totalOutputTokens;
  const rawWastedTokens = findings.reduce((s, f) => s + (f.secondary ? 0 : f.wastedTokens), 0);
  const wastedTokens = Math.min(rawWastedTokens, Math.round(totalTokens * 0.9));
  const effectiveTokens = totalTokens - wastedTokens;
  const wasteRatePct = totalTokens > 0 ? (wastedTokens / totalTokens) * 100 : 0;

  // Per-agent cost attribution — which agent/step burned the spend. Present only
  // when the trace carried agent identity (LangGraph/LangSmith/Langfuse/tap meta).
  const byAgent: AgentCost[] | undefined = agentAgg.size
    ? [...agentAgg.entries()]
        .map(([id, a]) => ({
          id,
          calls: a.calls,
          tokens: a.tokens,
          usd: a.usd,
          pctOfSpend: totalUSD > 0 ? (a.usd / totalUSD) * 100 : 0,
        }))
        .sort((x, y) => y.usd - x.usd)
    : undefined;

  const notes: string[] = [...trace.notes];
  if (models.some((m) => isEstimatedVendor(m)))
    notes.push(
      "Token counts for Claude/DeepSeek/Gemini are estimated with the OpenAI o200k tokenizer (typically within ~10-15%)."
    );
  // Claude 4.7+ (Opus 4.7/4.8/5, Sonnet 5, Fable/Mythos 5) use a newer tokenizer
  // that emits ~30% more tokens than the o200k estimate — real cost runs higher.
  if (models.some((m) => /claude-(opus-(4-7|4-8|5)|sonnet-5|fable-5|mythos-5)/i.test(m)))
    notes.push(
      "This model uses Claude's newer tokenizer (~30% more tokens than the o200k estimate) — actual cost is likely ~30% higher than shown."
    );
  const unmatched = models.filter((m) => !priceFor(m).matched);
  if (unmatched.length)
    notes.push(
      `Model(s) not in the price table — used a mid-range fallback (costs indicative): ${unmatched.join(", ")}.`
    );
  if (models.length > 1)
    notes.push(`Mixed models — each call is priced by its own model: ${models.join(", ")}.`);
  if (totalOutputTokens === 0)
    notes.push("Trace had no response usage, so output token cost isn't included in the total.");

  return {
    vendor: trace.vendor,
    model,
    numCalls: trace.calls.length,
    totalInputTokens,
    totalOutputTokens,
    totalUSD,
    savableUSD,
    savablePct,
    totalTokens,
    wastedTokens,
    effectiveTokens,
    wasteRatePct,
    perCallUSD: trace.calls.length ? totalUSD / trace.calls.length : 0,
    perCallSavableUSD: trace.calls.length ? savableUSD / trace.calls.length : 0,
    findings,
    byAgent,
    notes,
  };
}
