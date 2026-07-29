// Per-1M-token USD pricing for common models, plus their cache economics.
// Numbers are list prices as commonly published; they drift, so we keep this
// table small, honest, and easy to edit. `cachedInput` is the price paid for a
// prompt-cache HIT (what you'd pay instead of `input` on repeated prefixes).

export interface ModelPrice {
  /** USD per 1M input tokens (cache miss / uncached). */
  input: number;
  /** USD per 1M input tokens on a cache hit. */
  cachedInput: number;
  /** USD per 1M output tokens. */
  output: number;
}

// List prices verified against platform.claude.com/docs pricing on this date.
// They drift, so keep this stamp current (the CTO agent watches it).
export const PRICES_AS_OF = "2026-07-29";

// Keys are matched by substring against the model string (longest match wins),
// so specific versions (claude-opus-4-8) override family defaults (claude-opus-4).
export const PRICES: Record<string, ModelPrice> = {
  // ---- Anthropic, current gen (cache hit = 10% of input) ----
  // Opus 4.5–4.8 + Opus 5 dropped to $5/$25 (from the old $15/$75 Opus-4 tier).
  "claude-opus-5": { input: 5, cachedInput: 0.5, output: 25 },
  "claude-opus-4-8": { input: 5, cachedInput: 0.5, output: 25 },
  "claude-opus-4-7": { input: 5, cachedInput: 0.5, output: 25 },
  "claude-opus-4-6": { input: 5, cachedInput: 0.5, output: 25 },
  "claude-opus-4-5": { input: 5, cachedInput: 0.5, output: 25 },
  // Sonnet 5 introductory pricing $2/$10 through 2026-08-31; then $3/$15 (= Sonnet 4.x).
  "claude-sonnet-5": { input: 2, cachedInput: 0.2, output: 10 },
  // Fable 5 / Mythos 5 (creative flagship tier).
  "claude-fable-5": { input: 10, cachedInput: 1, output: 50 },
  "claude-mythos-5": { input: 10, cachedInput: 1, output: 50 },
  // NOTE: Claude 4.7+ use a new tokenizer that emits ~30% MORE tokens than the
  // o200k estimate TokenDam counts with — real cost on those models runs higher
  // than reported. Flagged in report notes; a tokenizer-aware pass is a TODO.

  // ---- Anthropic, prior gen ----
  "claude-opus-4": { input: 15, cachedInput: 1.5, output: 75 }, // Opus 4 / 4.1 (deprecated tier)
  "claude-sonnet-4": { input: 3, cachedInput: 0.3, output: 15 }, // Sonnet 4 / 4.5 / 4.6
  "claude-haiku-4": { input: 1, cachedInput: 0.1, output: 5 }, // Haiku 4.5
  "claude-3-5-haiku": { input: 0.8, cachedInput: 0.08, output: 4 },
  "claude-3-5-sonnet": { input: 3, cachedInput: 0.3, output: 15 },
  "claude-3-opus": { input: 15, cachedInput: 1.5, output: 75 },
  "claude-3-haiku": { input: 0.25, cachedInput: 0.03, output: 1.25 },

  // ---- OpenAI GPT-4 class (cache hit ≈ 50% of input) ----
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
  "gpt-4o": { input: 2.5, cachedInput: 1.25, output: 10 },
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
  "gpt-4.1": { input: 2, cachedInput: 0.5, output: 8 },

  // ---- OpenAI GPT-5 class (cache hit ≈ 10% of input) ----
  "gpt-5-nano": { input: 0.05, cachedInput: 0.005, output: 0.4 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2 },
  "gpt-5": { input: 1.25, cachedInput: 0.125, output: 10 },

  // ---- OpenAI reasoning (o-series) ----
  "o4-mini": { input: 1.1, cachedInput: 0.275, output: 4.4 },
  "o3-mini": { input: 1.1, cachedInput: 0.55, output: 4.4 },
  "o3": { input: 2, cachedInput: 0.5, output: 8 },
  "o1-mini": { input: 1.1, cachedInput: 0.55, output: 4.4 },
  "o1": { input: 15, cachedInput: 7.5, output: 60 },

  // ---- Google Gemini (cache hit ≈ 25% of input) ----
  "gemini-2.5-flash": { input: 0.3, cachedInput: 0.075, output: 2.5 },
  "gemini-2.5-pro": { input: 1.25, cachedInput: 0.31, output: 10 },

  // ---- DeepSeek (cache hit ≈ 10% of input) ----
  "deepseek-chat": { input: 0.27, cachedInput: 0.027, output: 1.1 },
  "deepseek-reasoner": { input: 0.55, cachedInput: 0.14, output: 2.19 },
};

// Fallback used when we can't recognize the model — deliberately mid-range so
// estimates aren't wildly off. Flagged in report notes when used.
export const FALLBACK_PRICE: ModelPrice = { input: 3, cachedInput: 0.75, output: 12 };

export function priceFor(model: string): { price: ModelPrice; matched: boolean } {
  const m = (model || "").toLowerCase();
  let best: string | null = null;
  for (const key of Object.keys(PRICES)) {
    if (m.includes(key) && (best === null || key.length > best.length)) best = key;
  }
  if (best) return { price: PRICES[best], matched: true };
  return { price: FALLBACK_PRICE, matched: false };
}

export function usd(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(5)}`;
}
