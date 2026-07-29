import type { Finding, NormCall, NormTrace } from "../types.js";

// TokenDam's most distinctive check. Reasoning models (o-series, GPT-5 reasoning,
// deepseek-reasoner, Claude extended-thinking) burn HIDDEN reasoning tokens billed
// at the OUTPUT rate. A request that returns 500 visible tokens can silently spend
// 5,000+ reasoning tokens. When the task is simple (classification/extraction/
// routing/JSON) and no reasoning_effort/verbosity/thinking-budget is set, most of
// that spend is recoverable by dialing effort down.

const MIN_REASONING = 1500; // tokens across firing calls before we report
const LOW_COMPLEXITY_ASSISTANT = 200; // tokens
const SIMPLE_TASK = /classif|extract|route|label|score|yes\/no|\bjson\b/i;

function isReasoningModel(c: NormCall): boolean {
  const m = c.model.toLowerCase();
  return (
    /^o[0-9]/.test(m) ||
    m.includes("gpt-5") ||
    m.includes("reasoning") ||
    m.includes("deepseek-reasoner") ||
    (m.includes("claude") && (c.thinkingBudget !== undefined || /thinking/.test(m)))
  );
}

function lastAssistantTokens(c: NormCall): number {
  for (let i = c.messages.length - 1; i >= 0; i--) {
    if (c.messages[i].role === "assistant") return c.messages[i].tokens;
  }
  return 0;
}

function inputTokens(c: NormCall): number {
  return (
    c.system.reduce((s, m) => s + m.tokens, 0) +
    c.tools.reduce((s, t) => s + t.tokens, 0) +
    c.messages.reduce((s, m) => s + m.tokens, 0)
  );
}

// Models that actually expose a reasoning-effort / thinking-budget control.
// deepseek-reasoner does NOT — you can't dial its effort, so "uncontrolled" is
// meaningless there; the only lever is routing simple tasks to a cheaper model.
function hasEffortKnob(c: NormCall): boolean {
  const m = c.model.toLowerCase();
  return /^o[0-9]/.test(m) || m.includes("gpt-5") || (m.includes("claude") && /thinking/.test(m + " " + (c.thinkingBudget !== undefined ? "thinking" : "")));
}

export function reasoningTokenWaste(trace: NormTrace): Finding[] {
  let totalReasoning = 0;
  let recoverableMeasured = 0; // measured recoverable tokens (for display)
  let recoverableUSD = 0; // priced per firing call's own model
  let synthesized = 0; // guessed (no usage) — never priced
  let firing = 0;
  const evidence: string[] = [];

  for (const c of trace.calls) {
    if (!isReasoningModel(c)) continue;

    // Estimate hidden reasoning tokens; track whether it's measured or guessed.
    let R = 0;
    let measured = true;
    if (c.usage?.reasoningTokens && c.usage.reasoningTokens > 0) {
      R = c.usage.reasoningTokens;
    } else if (c.usage?.outputTokens) {
      R = Math.max(0, c.usage.outputTokens - lastAssistantTokens(c));
    } else {
      R = Math.min(8000, Math.round(inputTokens(c) * 0.5));
      measured = false; // pure guess from input size — no real relationship
    }
    if (R < 500) continue;

    const knob = hasEffortKnob(c);
    const uncontrolled =
      knob &&
      c.reasoningEffort === undefined &&
      c.verbosity === undefined &&
      c.thinkingBudget === undefined;
    const effort = (c.reasoningEffort || "").toLowerCase();
    const lowComplexity =
      lastAssistantTokens(c) > 0 && lastAssistantTokens(c) < LOW_COMPLEXITY_ASSISTANT
        ? true
        : c.structuredOutput || SIMPLE_TASK.test(c.system.map((m) => m.text).join(" "));

    // With a knob: fire on uncontrolled, or high effort on an easy task.
    // Without a knob (deepseek-reasoner): the only waste we can flag is running
    // a reasoning model on a task simple enough for a non-reasoning model.
    const fires = knob
      ? uncontrolled || ((effort === "medium" || effort === "high") && lowComplexity)
      : lowComplexity;
    if (!fires) continue;

    const f = uncontrolled && lowComplexity ? 0.5 : 0.3;
    totalReasoning += R;
    if (measured) {
      recoverableMeasured += R * f;
      recoverableUSD += (R * f * c.price.output) / 1_000_000; // this call's own output rate
    } else synthesized += R;
    firing++;
    if (evidence.length < 5)
      evidence.push(
        `${c.model} · ~${R.toLocaleString()} reasoning tok${measured ? "" : " (estimated)"} · ${
          !knob ? "no effort knob — route simple tasks off it" : uncontrolled ? "no effort/verbosity set" : `effort=${effort}, simple task`
        }`
      );
  }

  if (firing === 0 || totalReasoning < MIN_REASONING) return [];

  // Only measured reasoning tokens get a dollar figure. If everything was a
  // guess, we still surface the finding but with NO confident $ and low severity.
  const allGuessed = recoverableMeasured === 0;
  const wastedTokens = Math.round(recoverableMeasured);
  const wastedUSD = recoverableUSD;

  const detail = allGuessed
    ? `~${totalReasoning.toLocaleString()} reasoning tokens are likely being spent here, but this trace didn't report reasoning-token usage, so this is an estimate from input size with no reliable dollar figure. Measure completion_tokens_details.reasoning_tokens to quantify it.`
    : `~${totalReasoning.toLocaleString()} hidden reasoning tokens were billed at the OUTPUT rate` +
      (synthesized > 0 ? ` (${synthesized.toLocaleString()} of them estimated)` : "") +
      `. These calls leave effort uncontrolled and/or target simple tasks, so a share is recoverable by dialing effort down.`;

  return [
    {
      detector: "reasoning-token-waste",
      severity: allGuessed ? "low" : wastedUSD > 0.02 || wastedTokens > 5000 ? "high" : "medium",
      title: allGuessed
        ? `Possible reasoning-token waste (~${totalReasoning.toLocaleString()} tok, estimated — no usage data)`
        : `~${totalReasoning.toLocaleString()} hidden reasoning tokens on uncontrolled reasoning calls`,
      detail,
      fix: "For o-series/GPT-5: set reasoning_effort explicitly — 'minimal'/'low' for classification/extraction/formatting/routing; reserve 'medium'/'high' for genuinely hard multi-step tasks (and set verbosity:'low' on GPT-5). For Claude: cap thinking.budget_tokens or disable extended thinking on simple calls. For deepseek-reasoner (no effort control): route simple tasks to deepseek-chat instead. Reasoning tokens are invisible in the response — measure completion_tokens_details.reasoning_tokens and A/B a lower setting before assuming you need the default.",
      wastedTokens,
      wastedUSD,
      evidence,
    },
  ];
}
