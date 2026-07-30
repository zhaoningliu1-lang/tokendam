// ---------- Normalized trace model ----------
// TokenDam ingests OpenAI- or Anthropic-shaped payloads and normalizes them
// into this vendor-neutral model. Everything downstream works on this.

export type Role = "system" | "user" | "assistant" | "tool";

export interface NormMessage {
  role: Role;
  /** Flattened text content of the message (all text blocks concatenated). */
  text: string;
  /** Token count of `text`, filled in during normalization. */
  tokens: number;
  /** For assistant messages: names of tools this message invoked. */
  toolCalls?: string[];
  /** True if this message already carries an explicit cache marker. */
  cached?: boolean;
}

export interface NormTool {
  name: string;
  /** Serialized JSON schema of the tool, used to estimate its token cost. */
  raw: string;
  tokens: number;
}

/** One LLM request (a single call to the model). */
export interface NormCall {
  model: string;
  system: NormMessage[]; // system prompt(s) as their own bucket
  messages: NormMessage[]; // user/assistant/tool turns
  tools: NormTool[];
  /** Reported usage if the trace included the response. */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    /** Hidden reasoning tokens (billed at output rate) if the trace reported them. */
    reasoningTokens?: number;
  };
  /** Whether any part of this call used a cache_control marker. */
  hasCacheMarker: boolean;
  /** This call's price, resolved from ITS OWN model — so mixed-model traces are
   *  priced correctly per call rather than with one trace-wide price. */
  price: import("./pricing.js").ModelPrice;
  /** True if this call's model wasn't in the price table (fallback used). */
  priceMatched: boolean;
  /** Raw reasoning/verbosity controls present on the request (for reasoning models). */
  reasoningEffort?: string;
  verbosity?: string;
  thinkingBudget?: number;
  /** True if the request asked for structured output (response_format / json_schema). */
  structuredOutput?: boolean;
  /** Agent/step identity — pulled from a LangGraph node, LangSmith run, Langfuse
   *  observation, or a tap() `meta`. Enables per-agent / per-step cost attribution.
   *  All optional; absent for plain single-model traces (behavior unchanged). */
  agentId?: string;
  stepId?: string;
  parentId?: string;
  turnIndex?: number;
}

export interface NormTrace {
  calls: NormCall[];
  /** Best-guess vendor: "openai" | "anthropic" | "mixed" | "unknown". */
  vendor: string;
  /** Non-fatal notes surfaced to the user (e.g. token counts are estimates). */
  notes: string[];
}

// ---------- Findings ----------

export type Severity = "high" | "medium" | "low";

export interface Finding {
  /** Stable id of the detector that produced this. */
  detector: string;
  severity: Severity;
  title: string;
  /** One-paragraph human explanation of what's wrong. */
  detail: string;
  /** Concrete, copy-pasteable-ish fix guidance. */
  fix: string;
  /** Estimated tokens wasted (per the trace, not annualized). */
  wastedTokens: number;
  /** Estimated USD wasted for this trace. */
  wastedUSD: number;
  /** Optional supporting evidence lines shown under the finding. */
  evidence?: string[];
  /** If true, this finding's $ overlaps others and is excluded from the headline
   *  savings sum (shown on the finding, but the top-line stays a conservative floor). */
  secondary?: boolean;
}

/** Per-agent (or per-step) cost rollup for multi-agent traces. */
export interface AgentCost {
  /** agentId (or a step label when grouping by step). */
  id: string;
  calls: number;
  tokens: number;
  usd: number;
  /** Share of the trace's total spend (0-100). */
  pctOfSpend: number;
}

export interface Report {
  vendor: string;
  model: string;
  numCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  /** Estimated total spend for this trace as-is. */
  totalUSD: number;
  /** Sum of wastedUSD across findings (capped at totalUSD). */
  savableUSD: number;
  savablePct: number;
  /** Total tokens (input + output) across the trace. */
  totalTokens: number;
  /** Tokens flagged as waste (non-secondary findings, capped) — the token-level
   *  analog of savableUSD. */
  wastedTokens: number;
  /** Tokens that did real work = totalTokens − wastedTokens. */
  effectiveTokens: number;
  /** Waste as a share of all tokens — powers the "X% of your tokens did nothing"
   *  headline and the CI --max-waste-rate gate. */
  wasteRatePct: number;
  /** Per-call averages, for projecting one trace to production volume. */
  perCallUSD: number;
  perCallSavableUSD: number;
  findings: Finding[];
  /** Per-agent cost rollup — present only when the trace carried agent/step
   *  identity. Sorted by spend desc. */
  byAgent?: AgentCost[];
  notes: string[];
}
