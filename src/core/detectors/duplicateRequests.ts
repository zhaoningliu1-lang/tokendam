import type { Finding, NormCall, NormTrace } from "../types.js";
import { callUSD } from "../pricing.js";

// Cross-call duplication: the SAME request (same task/query, ignoring the static
// system prompt) is sent to the model more than once in a trace. A response
// cache would return the cached answer and skip the repeat call entirely — you
// pay for the whole call (input + output) every time you don't. This is the
// "semantic caching" opportunity, surfaced as a diagnosis (we don't cache for
// you — that's a runtime proxy's job).

const MIN_SIG_LEN = 40; // ignore trivially-short requests
const FIRE_USD = 0; // report any real duplicate spend

// The request signature = the variable content (user/tool turns), normalized.
// The system prompt is excluded — it's the static instruction, not the request.
function signature(c: NormCall): string {
  return c.messages
    .filter((m) => m.role !== "assistant")
    .map((m) => m.text)
    .join("\n")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function inputTokens(c: NormCall): number {
  const t =
    c.system.reduce((s, m) => s + m.tokens, 0) +
    c.tools.reduce((s, t2) => s + t2.tokens, 0) +
    c.messages.reduce((s, m) => s + m.tokens, 0);
  return t === 0 && c.usage?.inputTokens ? c.usage.inputTokens : t;
}

export function duplicateRequests(trace: NormTrace): Finding[] {
  const calls = trace.calls;
  if (calls.length < 2) return [];

  const groups = new Map<string, number[]>();
  calls.forEach((c, i) => {
    const s = signature(c);
    if (s.length < MIN_SIG_LEN) return;
    const arr = groups.get(s);
    if (arr) arr.push(i);
    else groups.set(s, [i]);
  });

  let dupCalls = 0;
  let wastedUSD = 0;
  let wastedTokens = 0;
  const evidence: string[] = [];
  for (const [s, idxs] of groups) {
    if (idxs.length < 2) continue;
    // The first occurrence is legitimate; every repeat is a cache candidate.
    for (const i of idxs.slice(1)) {
      const c = calls[i];
      const inTok = inputTokens(c);
      const outTok = c.usage?.outputTokens ?? c.usage?.reasoningTokens ?? 0;
      wastedTokens += inTok + outTok;
      wastedUSD += callUSD(inTok, c.usage?.cachedInputTokens ?? 0, outTok, c.price);
      dupCalls++;
    }
    if (evidence.length < 5)
      evidence.push(`sent ${idxs.length}× (calls ${idxs.map((i) => i + 1).join(",")}): "${s.slice(0, 60)}…"`);
  }

  if (dupCalls === 0 || wastedUSD < FIRE_USD) return [];

  return [
    {
      detector: "duplicate-requests",
      severity: wastedUSD > 0.02 || dupCalls > 3 ? "medium" : "low",
      title: `${dupCalls} identical request(s) sent more than once — cacheable`,
      detail: `The same request (ignoring the static system prompt) was sent to the model multiple times in this trace. A response cache would serve the repeats from cache and skip the call entirely — you're paying full input+output for each duplicate. Best for idempotent/deterministic tasks; skip for time-sensitive ones.`,
      fix: "Add a response cache keyed on the request (exact-match, or an embedding/semantic cache for near-duplicates) and return the cached answer for repeats instead of re-calling the model. Libraries like GPTCache do this; or a simple in-memory/Redis map for exact repeats.",
      wastedTokens,
      wastedUSD,
      evidence,
      // PRIMARY: a re-sent identical call is genuine, recoverable spend (skip the
      // call entirely via a response cache). Keeping it out of the headline made the
      // CI gate FAIL OPEN — a 95%-duplicate trace passed with "$0 recoverable". On
      // the dangerous case (pure duplicates, no cacheable prefix) unused-cache does
      // not fire, so this is the sole, non-overlapping claim; where a big static
      // prefix does exist both fire, but the analyze-layer 90% cap keeps the headline
      // a bounded floor. (A precise per-call-index de-overlap is the follow-up.)
      secondary: false,
    },
  ];
}
