import type { Finding, NormCall, NormMessage, NormTrace } from "../types.js";

// Finds near-identical large chunks repeated within a single call — the same
// document pasted into both the system prompt and a user turn, a retrieved
// chunk duplicated across messages, etc. You pay input tokens for every copy.
//
// Method: pairwise Jaccard similarity over 8-word shingles between messages
// that are individually substantial (>=200 tokens). Jaccard >= 0.8 => the later
// message is ~90% redundant.

const MIN_MSG_TOKENS = 200;
const JACCARD = 0.8;
const K = 8; // shingle size in words
const FIRE_AT = 400; // min duplicate tokens in a call to report
const RECOVERABLE = 0.9;

function shingles(text: string): Set<string> {
  const words = text.toLowerCase().replace(/\s+/g, " ").trim().split(" ");
  const set = new Set<string>();
  for (let i = 0; i + K <= words.length; i++) set.add(words.slice(i, i + K).join(" "));
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const s of small) if (big.has(s)) inter++;
  return inter / (a.size + b.size - inter);
}

function dupTokensInCall(call: NormCall): { dup: number; pairs: string[] } {
  const msgs: NormMessage[] = [...call.system, ...call.messages].filter(
    (m) => m.tokens >= MIN_MSG_TOKENS
  );
  const sh = msgs.map((m) => shingles(m.text));
  let dup = 0;
  const pairs: string[] = [];
  const counted = new Set<number>();
  for (let j = 0; j < msgs.length; j++) {
    if (counted.has(j)) continue;
    for (let i = 0; i < j; i++) {
      if (jaccard(sh[i], sh[j]) >= JACCARD) {
        dup += msgs[j].tokens;
        counted.add(j);
        pairs.push(
          `${msgs[i].role}#${i + 1} ≈ ${msgs[j].role}#${j + 1} (${msgs[j].tokens.toLocaleString()} tok dup): "${msgs[
            j
          ].text
            .slice(0, 60)
            .replace(/\s+/g, " ")}…"`
        );
        break;
      }
    }
  }
  return { dup, pairs };
}

export function duplicateSubstring(trace: NormTrace): Finding[] {
  let totalDup = 0;
  const evidence: string[] = [];
  let wastedUSD = 0;
  for (const call of trace.calls) {
    const { dup, pairs } = dupTokensInCall(call);
    if (dup >= FIRE_AT) {
      totalDup += dup;
      // Price each call's duplicated tokens by its own model at the FULL input rate.
      // The duplicate copy is always in dynamic (non-cached) content, so it bills
      // at the uncached rate regardless of whether a cache marker is present.
      wastedUSD += (dup * RECOVERABLE * call.price.input) / 1_000_000;
      for (const p of pairs) if (evidence.length < 6) evidence.push(p);
    }
  }
  if (totalDup < FIRE_AT) return [];

  const wastedTokens = Math.round(totalDup * RECOVERABLE);

  return [
    {
      detector: "duplicate-substring",
      severity: totalDup > 4000 ? "medium" : "low",
      title: `Likely-duplicated content — ~${totalDup.toLocaleString()} tokens paid for twice`,
      detail: `The same (or near-identical) large block appears more than once within a call — e.g. a document pasted into both the system prompt and a user message, or a chunk repeated across turns. Every copy is billed. (Flagged at ≥80% similarity — treat as "likely duplicate", not certain.)`,
      fix: "Include each document/chunk exactly once and reference it ('per the document above') instead of re-pasting. If the same context is needed every turn, put it once in a cached system prefix rather than repeating it in user messages.",
      wastedTokens,
      wastedUSD,
      evidence,
    },
  ];
}
