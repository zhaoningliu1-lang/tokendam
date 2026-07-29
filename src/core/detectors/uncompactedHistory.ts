import type { Finding, NormTrace } from "../types.js";
import type { ModelPrice } from "../pricing.js";

// Long-running agents resend the ENTIRE conversation on every turn. Old turns
// far outside the "recent" window get billed again and again. Summarizing /
// compacting older history cuts that repeated cost. Only fires when history is
// actually growing across calls (i.e. it's an agent loop, not one-shot calls).

const RECENT_WINDOW = 8; // keep the last N messages verbatim
const COMPACT_RATIO = 0.7; // assume old turns compress to ~30% of their size

export function uncompactedHistory(trace: NormTrace, price: ModelPrice): Finding[] {
  const calls = trace.calls;
  if (calls.length < 3) return [];

  const lens = calls.map((c) => c.messages.length);
  const growing = lens[lens.length - 1] > lens[0] + 2;
  if (!growing) return [];

  const perToken =
    (calls.some((c) => c.hasCacheMarker) ? price.cachedInput : price.input) / 1_000_000;

  // For each call, tokens in "old" messages beyond the recent window.
  let oldTokensResent = 0;
  let maxOld = 0;
  for (const call of calls) {
    if (call.messages.length <= RECENT_WINDOW) continue;
    const old = call.messages.slice(0, call.messages.length - RECENT_WINDOW);
    const t = old.reduce((s, m) => s + m.tokens, 0);
    oldTokensResent += t;
    maxOld = Math.max(maxOld, t);
  }
  if (oldTokensResent < 2000) return [];

  const wastedTokens = Math.round(oldTokensResent * COMPACT_RATIO);
  const wastedUSD = wastedTokens * perToken;

  return [
    {
      detector: "uncompacted-history",
      severity: oldTokensResent > 20000 ? "medium" : "low",
      title: `Growing history resends ~${oldTokensResent.toLocaleString()} tokens of old turns`,
      detail: `This looks like an agent loop (history grows from ${lens[0]} to ${
        lens[lens.length - 1]
      } messages). Turns older than the last ${RECENT_WINDOW} are re-sent in full on every subsequent call. Compacting them (summary + keep recent verbatim) would trim an estimated ${COMPACT_RATIO * 100}% of that repeated old-history cost.`,
      fix: "Add a compaction step: once history exceeds a budget, summarize older turns into a short running memo and keep only the last few messages verbatim. Combine with prompt caching so the compacted head still gets a cache discount.",
      wastedTokens,
      wastedUSD,
      evidence: [
        `history grew: ${lens.join(" → ")} messages`,
        `largest old-history block in a single call: ${maxOld.toLocaleString()} tok`,
      ],
    },
  ];
}
