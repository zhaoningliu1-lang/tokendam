import type { Finding, NormCall, NormTrace } from "../types.js";
import { priceFor, usd, type ModelPrice } from "../pricing.js";

// The biggest cost lever most teams miss: using a flagship model (Opus, GPT-4o,
// GPT-5) for a task a cheaper sibling would nail. Model price gaps are 10-20x —
// often larger than any prompt-side saving. We DETECT and RECOMMEND a downgrade
// (we never route for you — that's a proxy's job); the caveat is always "A/B the
// quality first," because model choice is a judgment call.

const SIMPLE_TASK = /classif|extract|route|label|score|tag|categor|yes\/no|\bjson\b|parse|rewrite|translate|summar/i;
const SHORT_OUTPUT = 220; // tokens — simple tasks produce short answers

function suggestCheaper(model: string): { target: string; label: string } | null {
  const m = model.toLowerCase();
  if (m.includes("opus")) return { target: "claude-sonnet-5", label: "Claude Sonnet 5" };
  if (m.includes("claude-sonnet") || m.includes("claude-3-5-sonnet"))
    return { target: "claude-haiku-4", label: "Claude Haiku 4" };
  if (m.includes("gpt-4o") && !m.includes("mini")) return { target: "gpt-4o-mini", label: "gpt-4o-mini" };
  if (m.includes("gpt-4.1") && !m.includes("mini")) return { target: "gpt-4.1-mini", label: "gpt-4.1-mini" };
  if (m.includes("gpt-5") && !m.includes("mini") && !m.includes("nano"))
    return { target: "gpt-5-mini", label: "gpt-5-mini" };
  if ((m.includes("o3") || m.includes("o1")) && !m.includes("mini"))
    return { target: "o4-mini", label: "o4-mini" };
  return null;
}

function lastAssistantTokens(c: NormCall): number {
  for (let i = c.messages.length - 1; i >= 0; i--)
    if (c.messages[i].role === "assistant") return c.messages[i].tokens;
  return 0;
}
function inputTokens(c: NormCall): number {
  return (
    c.system.reduce((s, m) => s + m.tokens, 0) +
    c.tools.reduce((s, t) => s + t.tokens, 0) +
    c.messages.reduce((s, m) => s + m.tokens, 0)
  );
}
function callCost(inTok: number, cachedTok: number, outTok: number, p: ModelPrice): number {
  const cached = Math.min(inTok, Math.max(0, cachedTok));
  return ((inTok - cached) * p.input + cached * p.cachedInput + outTok * p.output) / 1_000_000;
}

export function modelOverkill(trace: NormTrace): Finding[] {
  let saving = 0;
  let firing = 0;
  const evidence: string[] = [];
  const targets = new Set<string>();

  for (const c of trace.calls) {
    const suggestion = suggestCheaper(c.model);
    if (!suggestion) continue;

    const out = c.usage?.outputTokens ?? lastAssistantTokens(c);
    const sysText = c.system.map((m) => m.text).join(" ");
    const mm = c.model.toLowerCase();
    const isReasoning = /^o[0-9]/.test(mm) || mm.includes("deepseek-reasoner");

    // "Heavy" work is never overkill: tools in play, long output, or lots of
    // hidden reasoning. Short output must be the norm for a simple task.
    const shortOut = out > 0 && out < SHORT_OUTPUT;
    const heavy =
      c.tools.length > 0 || out >= SHORT_OUTPUT || (c.usage?.reasoningTokens ?? 0) > 1500;
    const hint = c.structuredOutput || SIMPLE_TASK.test(sysText);

    // Fire only on short-output, non-heavy calls with an EXPLICIT simple-task
    // hint (structured output or a classify/extract/route-type prompt). "Short
    // output alone" over-fires — a terse answer can still be a hard question,
    // especially on reasoning models. Requiring the hint keeps false positives low.
    const simple = shortOut && !heavy && hint;
    if (!simple) continue;
    void isReasoning; // (kept for readability; hint now gates all models)

    const inTok = inputTokens(c);
    if (inTok + out < 200) continue; // too small to matter

    // Price cache-aware: cached input tokens bill at the cache-hit rate for BOTH
    // models, so the saving can never exceed the call's real cost.
    const cached = c.usage?.cachedInputTokens ?? 0;
    const cur = priceFor(c.model).price;
    const cheap = priceFor(suggestion.target).price;
    const delta = callCost(inTok, cached, out, cur) - callCost(inTok, cached, out, cheap);
    if (delta <= 0) continue;

    saving += delta;
    firing++;
    targets.add(suggestion.label);
    if (evidence.length < 5) {
      const ratio = (cur.input + cur.output) / (cheap.input + cheap.output);
      evidence.push(
        `${c.model} → ${suggestion.label} · ${ratio.toFixed(1)}× cheaper · this call ${usd(delta)} (${
          c.structuredOutput ? "structured output" : SIMPLE_TASK.test(sysText) ? "simple task" : "short output"
        })`
      );
    }
  }

  if (firing === 0 || saving < 1e-6) return [];

  return [
    {
      detector: "model-overkill",
      severity: saving > 0.02 ? "high" : "medium",
      title: `${firing} call(s) on a flagship model for a simple task — try ${[...targets].join(" / ")}`,
      detail: `These calls use a top-tier model for work a cheaper sibling can usually handle (short/structured/simple-task output). Model price gaps are 10-20×, so this is often the single biggest cost lever — but it's a judgment call: quality can drop on hard cases. Estimated saving if you route these to the cheaper model: ${usd(
        saving
      )} on this trace.`,
      fix: "A/B the cheaper model on a sample of these calls (same prompts) and compare output quality. If it holds, route this task/step to it — keep the flagship for genuinely hard calls. A model router (or a simple per-task switch) makes this conditional, not all-or-nothing.",
      wastedTokens: 0,
      wastedUSD: saving,
      evidence,
      // A different lever than the token-reduction findings (switch model vs cut
      // tokens) and a bigger judgment call — shown prominently but kept out of the
      // headline floor to avoid implying it stacks additively.
      secondary: true,
    },
  ];
}
