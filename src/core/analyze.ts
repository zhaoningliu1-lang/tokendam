import type { NormCall, NormTrace, Report, Finding } from "./types.js";
import { normalize } from "./normalize.js";
import { priceFor } from "./pricing.js";
import { isEstimatedVendor } from "./tokens.js";
import { unusedCache } from "./detectors/unusedCache.js";
import { bloatedContext } from "./detectors/bloatedContext.js";
import { redundantTools } from "./detectors/redundantTools.js";
import { uncompactedHistory } from "./detectors/uncompactedHistory.js";
import { duplicateSubstring } from "./detectors/duplicateSubstring.js";
import { reasoningTokenWaste } from "./detectors/reasoningTokenWaste.js";

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

  // Pick pricing from the most-used model in the trace.
  const modelCounts = new Map<string, number>();
  for (const c of trace.calls) modelCounts.set(c.model, (modelCounts.get(c.model) ?? 0) + 1);
  const model = [...modelCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const { price, matched } = priceFor(model);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedTokens = 0;
  let totalUSD = 0;
  for (const c of trace.calls) {
    const inTok = callInputTokens(c);
    // Tokens the provider already served from cache (OpenAI/Anthropic report
    // this in usage) are billed at the cache-hit rate, not full input price.
    const cached = Math.min(inTok, c.usage?.cachedInputTokens ?? 0);
    // completion_tokens already includes reasoning tokens (OpenAI/DeepSeek);
    // only fall back to reasoningTokens when no output count was reported, so a
    // reasoning finding can never claim to save more than the trace costs.
    const outTok = c.usage?.outputTokens ?? c.usage?.reasoningTokens ?? 0;
    totalInputTokens += inTok;
    totalOutputTokens += outTok;
    totalCachedTokens += cached;
    totalUSD +=
      ((inTok - cached) * price.input + cached * price.cachedInput + outTok * price.output) /
      1_000_000;
  }

  const findings: Finding[] = [
    ...unusedCache(trace, price),
    ...bloatedContext(trace, price),
    ...redundantTools(trace, price),
    ...uncompactedHistory(trace, price),
    ...duplicateSubstring(trace, price),
    ...reasoningTokenWaste(trace, price),
  ].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.wastedUSD - a.wastedUSD);

  // Savings can conceptually overlap between detectors; cap at 90% of spend so
  // the headline stays credible. `secondary` findings (whose tokens are already
  // counted by another finding) are excluded from the sum to avoid inflation.
  const rawSavable = findings.reduce((s, f) => s + (f.secondary ? 0 : f.wastedUSD), 0);
  const savableUSD = Math.min(rawSavable, totalUSD * 0.9);
  const savablePct = totalUSD > 0 ? (savableUSD / totalUSD) * 100 : 0;

  const notes: string[] = [...trace.notes];
  if (isEstimatedVendor(model))
    notes.push(
      `Token counts for ${model} are estimated with the OpenAI o200k tokenizer (typically within ~10-15%).`
    );
  if (!matched)
    notes.push(
      `Model "${model}" not in the price table — used a mid-range fallback ($${price.input}/1M in, $${price.output}/1M out). Costs are indicative.`
    );
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
    perCallUSD: trace.calls.length ? totalUSD / trace.calls.length : 0,
    perCallSavableUSD: trace.calls.length ? savableUSD / trace.calls.length : 0,
    findings,
    notes,
  };
}
