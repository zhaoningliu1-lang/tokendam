import type { Finding, NormTrace } from "../types.js";

// Tools (and MCP tool surfaces) that are DEFINED on calls but never actually
// invoked anywhere in the trace. Their JSON schemas are billed as input on
// every call that carries them. Common with kitchen-sink MCP servers that
// expose dozens of tools an agent never touches.

export function redundantTools(trace: NormTrace): Finding[] {
  const called = new Set<string>();
  let sawToolUse = false;
  for (const call of trace.calls) {
    for (const m of call.messages) {
      for (const name of m.toolCalls ?? []) {
        called.add(name);
        sawToolUse = true;
      }
    }
  }

  // We can only conclude a tool is "unused" if we actually observed the model's
  // tool-use behavior. A single request body (no assistant turns) tells us
  // nothing — the model may call those tools in a turn we didn't capture.
  const haveEvidence = trace.calls.length >= 2 || sawToolUse;
  if (!haveEvidence) return [];

  // Map tool name -> {schemaTokens, carriedOnCalls}
  const defined = new Map<string, { tokens: number; carried: number }>();
  for (const call of trace.calls) {
    for (const t of call.tools) {
      const e = defined.get(t.name) ?? { tokens: t.tokens, carried: 0 };
      e.tokens = t.tokens;
      e.carried += 1;
      defined.set(t.name, e);
    }
  }
  if (defined.size === 0) return [];

  const dead = [...defined.entries()].filter(([name]) => !called.has(name));
  if (!dead.length) return [];

  // Charged at cache-hit rate if a cache marker exists, else full input price.
  // Averaged across calls' own models (this finding is secondary, so exactness
  // matters less; the average is correct for the common uniform-model trace).
  const cached = trace.calls.some((c) => c.hasCacheMarker);
  const perToken =
    trace.calls.reduce((s, c) => s + (cached ? c.price.cachedInput : c.price.input), 0) /
    trace.calls.length /
    1_000_000;

  let wastedTokens = 0;
  const evidence: string[] = [];
  for (const [name, e] of dead.sort((a, b) => b[1].tokens * b[1].carried - a[1].tokens * a[1].carried)) {
    const t = e.tokens * e.carried;
    wastedTokens += t;
    if (evidence.length < 8)
      evidence.push(`${name} — ${e.tokens} tok schema × ${e.carried} call(s) = ${t.toLocaleString()} tok`);
  }
  const wastedUSD = wastedTokens * perToken;

  return [
    {
      detector: "redundant-tools",
      severity: dead.length > 5 || wastedTokens > 8000 ? "medium" : "low",
      title: `${dead.length} tool schema(s) defined but never called — ~${wastedTokens.toLocaleString()} tokens`,
      detail: `These tools are shipped in the request on every call but the model never invokes them in this trace. Their schemas are billed as input each time. (Caveat: a trace is a sample — a tool unused here might be needed elsewhere.)`,
      fix: "Prune the tool list to what this agent/step actually uses, or gate MCP tool surfaces per-task with a cheap classifier so you only attach relevant tools. Fewer tools also improves selection accuracy.",
      wastedTokens,
      wastedUSD,
      evidence,
      // Tool-schema tokens are also counted inside unused-cache's shared prefix,
      // so exclude this from the headline sum to keep the top-line honest.
      secondary: true,
    },
  ];
}
