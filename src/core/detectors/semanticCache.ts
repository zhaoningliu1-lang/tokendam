import type { Finding, NormCall, NormTrace } from "../types.js";

// Semantic-cache opportunity: requests that are NEAR-identical but not byte-for-
// byte the same (a changed id/timestamp/number, whitespace, a reworded clause) —
// so an exact-match cache misses them, but a normalized/semantic cache would serve
// them. Detected with a purely LOCAL n-gram (shingle) similarity — no embeddings,
// nothing uploaded. Exact duplicates belong to duplicate-requests; conversation
// growth (one request being a superset of another) is excluded via a containment
// guard so we don't mistake an agent's growing history for a cache hit.

const MIN_SIG_LEN = 40; // ignore trivially-short requests
const SHINGLE_N = 3; // word 3-grams
const SIM_HI = 0.9; // Jaccard similarity to call it a near-duplicate (high = precise)
const MAX_CALLS = 400; // cap the O(n^2) comparison on huge traces

function inputTokens(c: NormCall): number {
  const t =
    c.system.reduce((s, m) => s + m.tokens, 0) +
    c.tools.reduce((s, t2) => s + t2.tokens, 0) +
    c.messages.reduce((s, m) => s + m.tokens, 0);
  return t === 0 && c.usage?.inputTokens ? c.usage.inputTokens : t;
}
function signature(c: NormCall): string {
  return c.messages
    .filter((m) => m.role !== "assistant")
    .map((m) => m.text)
    .join("\n")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
function shingles(s: string): Set<string> {
  const w = s.split(" ");
  const out = new Set<string>();
  if (w.length < SHINGLE_N) {
    out.add(s);
    return out;
  }
  for (let i = 0; i + SHINGLE_N <= w.length; i++) out.add(w.slice(i, i + SHINGLE_N).join(" "));
  return out;
}

export function semanticCache(trace: NormTrace): Finding[] {
  const calls = trace.calls;
  if (calls.length < 2 || calls.length > MAX_CALLS) return [];

  const items = calls.map((c, i) => ({ i, s: signature(c) })).filter((x) => x.s.length >= MIN_SIG_LEN);
  if (items.length < 2) return [];
  const sh = items.map((x) => shingles(x.s));

  // Union-find: cluster near-duplicate requests.
  const parent = items.map((_, k) => k);
  const find = (k: number): number => {
    while (parent[k] !== k) {
      parent[k] = parent[parent[k]];
      k = parent[k];
    }
    return k;
  };
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      if (items[a].s === items[b].s) continue; // exact dup → duplicate-requests owns it
      const A = sh[a];
      const B = sh[b];
      const [small, big] = A.size < B.size ? [A, B] : [B, A];
      let inter = 0;
      for (const x of small) if (big.has(x)) inter++;
      const uni = A.size + B.size - inter;
      const jac = uni ? inter / uni : 0;
      // A strict superset (the smaller fully inside the bigger, which is larger) is
      // conversation growth / uncompacted history — not a reworded duplicate. A true
      // near-dup differs from its twin (each has a shingle the other lacks), so it's
      // not a superset. Excluding supersets keeps growing agent history out.
      const superset = inter === small.size && big.size > small.size;
      if (jac >= SIM_HI && !superset) {
        parent[find(a)] = find(b);
      }
    }
  }

  const clusters = new Map<number, number[]>();
  items.forEach((_, k) => {
    const r = find(k);
    const arr = clusters.get(r);
    if (arr) arr.push(k);
    else clusters.set(r, [k]);
  });

  let repeats = 0;
  let wastedUSD = 0;
  let wastedTokens = 0;
  const evidence: string[] = [];
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    // First is the canonical miss; the rest are near-dup repeats a cache would serve.
    for (const k of members.slice(1)) {
      const c = calls[items[k].i];
      const inTok = inputTokens(c);
      const outTok = c.usage?.outputTokens ?? c.usage?.reasoningTokens ?? 0;
      wastedTokens += inTok + outTok;
      wastedUSD += (inTok * c.price.input + outTok * c.price.output) / 1_000_000;
      repeats++;
    }
    if (evidence.length < 4)
      evidence.push(`${members.length} near-identical requests (calls ${members.map((k) => items[k].i + 1).join(", ")})`);
  }
  if (repeats === 0 || wastedUSD <= 0) return [];

  return [
    {
      detector: "semantic-cache-opportunity",
      severity: wastedUSD > 0.02 || repeats > 3 ? "medium" : "low",
      title: `${repeats} near-duplicate request(s) an exact cache would miss`,
      detail: `These requests are ≥${Math.round(SIM_HI * 100)}% identical but not byte-for-byte the same (a changed id/timestamp/number, whitespace, or a reworded clause), so an exact-match cache misses them. A normalized or semantic cache would serve them and skip the model call. Best for idempotent lookups; skip for time-sensitive queries.`,
      fix: `Normalize requests before caching (strip volatile fields like ids/timestamps), or add a semantic/embedding cache (e.g. GPTCache) that returns the cached response when a new request is close enough to a prior one.`,
      wastedTokens,
      wastedUSD,
      evidence,
      // Overlaps duplicate-requests / caching detectors — keep out of the headline floor.
      secondary: true,
    },
  ];
}
