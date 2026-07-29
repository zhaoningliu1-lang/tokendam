// Token counting. We use gpt-tokenizer (o200k_base — the modern OpenAI
// vocabulary) as a single approximation across vendors. It's exact-ish for
// OpenAI models and a close estimate for Claude/DeepSeek (typically within
// ~10-15%), which is more than good enough to rank where the waste is.
//
// This module is browser- and node-safe (gpt-tokenizer is pure JS).

import { encode } from "gpt-tokenizer/model/gpt-4o";

/** Count tokens in a string. Falls back to a chars/4 heuristic on any failure. */
export function countTokens(text: string): number {
  if (!text) return 0;
  try {
    return encode(text).length;
  } catch {
    return Math.ceil(text.length / 4);
  }
}

/** True if this model needs the "estimate, not exact" caveat (non-OpenAI). */
export function isEstimatedVendor(model: string): boolean {
  const m = (model || "").toLowerCase();
  return m.includes("claude") || m.includes("deepseek") || m.includes("gemini");
}
