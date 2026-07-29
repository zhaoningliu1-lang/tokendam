import type { Finding, NormCall, NormTrace } from "../types.js";

// The single biggest lever for agent loops: the same static prefix (system
// prompt + tool schemas + any identical leading messages) gets resent at FULL
// input price on every call, when prompt caching would charge ~10% (Anthropic/
// DeepSeek) or ~50% (OpenAI) on the repeats.

const MIN_CACHEABLE = 1024; // providers won't cache prefixes shorter than this

function systemText(call: NormCall): string {
  return call.system.map((m) => m.text).join("\n");
}
function toolSig(call: NormCall): string {
  return call.tools.map((t) => t.raw).join("\n");
}

/** Tokens in the prefix that is byte-identical across every call. */
function sharedPrefix(trace: NormTrace): { tokens: number; parts: string[] } {
  const calls = trace.calls;
  const parts: string[] = [];
  let tokens = 0;

  // system identical across all calls?
  const sys0 = systemText(calls[0]);
  if (sys0 && calls.every((c) => systemText(c) === sys0)) {
    tokens += calls[0].system.reduce((s, m) => s + m.tokens, 0);
    parts.push(`system prompt (${calls[0].system.reduce((s, m) => s + m.tokens, 0)} tok)`);
  }
  // tool set identical across all calls?
  const tool0 = toolSig(calls[0]);
  if (tool0 && calls.every((c) => toolSig(c) === tool0)) {
    const tt = calls[0].tools.reduce((s, t) => s + t.tokens, 0);
    tokens += tt;
    parts.push(`${calls[0].tools.length} tool schemas (${tt} tok)`);
  }
  // identical leading messages (few-shot examples, long fixed instructions)
  let i = 0;
  let leadTok = 0;
  while (true) {
    const m0 = calls[0].messages[i];
    if (!m0) break;
    if (!calls.every((c) => c.messages[i] && c.messages[i].text === m0.text)) break;
    leadTok += m0.tokens;
    i++;
  }
  if (leadTok > 0) {
    tokens += leadTok;
    parts.push(`${i} identical leading message(s) (${leadTok} tok)`);
  }
  return { tokens, parts };
}

export function unusedCache(trace: NormTrace): Finding[] {
  const calls = trace.calls;
  if (calls.length < 2) return [];

  const { tokens, parts } = sharedPrefix(trace);
  if (tokens < MIN_CACHEABLE) return [];

  const repeats = calls.length - 1; // first call is a cache write, rest are hits
  // The prefix is resent on each repeat call — price the saving by those calls'
  // own models (correct for mixed-model traces; identical to before when uniform).
  const repeatCalls = calls.slice(1);
  const perTokenSaving =
    repeatCalls.reduce((s, c) => s + (c.price.input - c.price.cachedInput), 0) /
    repeatCalls.length /
    1_000_000;
  const avgIn = repeatCalls.reduce((s, c) => s + c.price.input, 0) / repeatCalls.length;
  const avgCached = repeatCalls.reduce((s, c) => s + c.price.cachedInput, 0) / repeatCalls.length;
  const discountPct = avgIn > 0 ? Math.round((1 - avgCached / avgIn) * 100) : 90;

  // Two signals that caching is already in play: an explicit cache_control
  // marker, OR the trace's usage reporting cache-read tokens (OpenAI auto-caches
  // with no marker). If usage shows the prefix is already largely served from
  // cache, we must NOT tell the user to "add caching" they already have.
  const observedCached = calls.reduce((s, c) => s + (c.usage?.cachedInputTokens ?? 0), 0);
  const potentialRepeatPrefix = tokens * repeats;
  const alreadyCaching =
    calls.some((c) => c.hasCacheMarker) || observedCached >= potentialRepeatPrefix * 0.8;

  // Discount the waste by tokens already served from cache.
  const effectiveWasteTokens = Math.max(0, potentialRepeatPrefix - observedCached);
  const wastedTokens = alreadyCaching ? 0 : effectiveWasteTokens;
  const wastedUSD = wastedTokens * perTokenSaving;

  if (alreadyCaching) {
    return [
      {
        detector: "unused-cache",
        severity: "low",
        title: "Prompt caching already active — good; verify it covers the full static prefix",
        detail: `Caching is in play (${
          calls.some((c) => c.hasCacheMarker) ? "cache_control marker present" : "usage reports cache-read tokens"
        }). Your static prefix is ~${tokens} tokens repeated across ${calls.length} calls${
          observedCached > 0 ? `; ~${observedCached.toLocaleString()} tokens were served from cache` : ""
        }. Make sure the cached block covers the whole static prefix (system + tools + fixed examples) so the entire thing hits, not just part of it.`,
        fix: "Place cache_control on the last static block. Keep everything dynamic (user turn, tool results) AFTER the cached prefix so cache hits aren't broken.",
        wastedTokens: 0,
        wastedUSD: 0,
        evidence: parts,
      },
    ];
  }

  return [
    {
      detector: "unused-cache",
      severity: wastedUSD > 0.01 || wastedTokens > 20000 ? "high" : "medium",
      title: `Static prefix of ~${tokens.toLocaleString()} tokens is resent uncached on every call`,
      detail: `Across ${calls.length} calls, the same ${tokens.toLocaleString()}-token prefix (${parts.join(
        ", "
      )}) is billed at full input price every time. Prompt caching would charge the cache-hit rate on the ${repeats} repeat(s) — roughly a ${discountPct}% discount on that prefix.`,
      fix:
        trace.vendor === "anthropic" || trace.vendor === "deepseek"
          ? "Add cache_control:{type:'ephemeral'} to the last system block (and/or the last tool). Anthropic/DeepSeek cache the prefix up to that marker; hits cost ~10% of input."
          : "Keep the static prefix (system + tools) first and identical across calls — OpenAI auto-caches prefixes ≥1024 tokens at ~50% off. Don't interpolate per-call data (timestamps, IDs) into the system prompt; it busts the cache.",
      wastedTokens,
      wastedUSD,
      evidence: parts,
    },
  ];
}
