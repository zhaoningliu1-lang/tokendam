// api/cto-agent.js — The CTO.
//
// A token-cost tool is only as trustworthy as its numbers, and those numbers
// rot: model prices change, new models ship, tokenizers shift, providers add
// caching mechanics, and trace-export formats mutate. This agent is the
// engineering conscience. Weekly it:
//   1. reads the LIVE pricing table (from GitHub raw if configured, else a
//      built-in snapshot) and asks Claude what looks stale / missing,
//   2. proposes concrete technical improvements (new detectors, accuracy risks),
//   3. flags new trace formats worth supporting.
// It DRAFTS a technical digest; it never edits code or ships anything.
//
// Weekly cron. Graceful no-op without creds.

import { authorize, sendEmail, anthropic, emailShell, escapeHtml } from "./_shared.js";

// Built-in snapshot so the agent is useful even with no GITHUB_REPO set.
// Keep terse — it's a review target, not the source of truth.
const SNAPSHOT = {
  trackedModels:
    "claude-opus-4, claude-sonnet-4, claude-haiku-4/3-5-haiku, claude-3-opus/haiku, " +
    "gpt-4o(+mini), gpt-4.1(+mini), o3-mini, o1(+mini), deepseek-chat, deepseek-reasoner",
  detectors:
    "unused-cache, bloated-context, redundant-tools, uncompacted-history, duplicate-substring, reasoning-token-waste",
  formats:
    "OpenAI/Anthropic request bodies, LangSmith run, Langfuse observation, OpenAI Batch, Vercel AI SDK (onFinish + UIMessage[]), generic {request,response} JSONL, OpenAI Usage Admin API",
  tokenizer: "gpt-tokenizer o200k for all vendors (estimate for Claude/DeepSeek, ~10-15%)",
};

// Optionally read the real pricing.ts from GitHub so the review is grounded.
async function livePricing() {
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!repo) return null;
  try {
    const r = await fetch(
      `https://raw.githubusercontent.com/${repo}/${branch}/src/core/pricing.ts`,
      { headers: { "user-agent": "TokenDam-CTO/1.0" } }
    );
    if (!r.ok) return null;
    const txt = await r.text();
    return txt.slice(0, 6000);
  } catch {
    return null;
  }
}

const SYSTEM = `You are the CTO of TokenDam, a free in-browser + CLI "linter for LLM token spend". Correctness is the product: if a price is stale or a detector is wrong, users lose trust instantly. You are precise, skeptical of your own numbers, and you favor small, verifiable improvements over rewrites.

Ground rules: only claim a price is stale if you have real reason to believe so given today's date; when unsure, say "verify" rather than assert. Prefer concrete, checkable actions (edit this key, add this model, add this detector) over vague advice.`;

function buildPrompt(pricingSrc) {
  const today = new Date().toISOString().slice(0, 10);
  return `Today is ${today}. Do a weekly technical review of TokenDam.

CURRENT STATE (snapshot):
- Tracked models & prices: ${SNAPSHOT.trackedModels}
- Detectors: ${SNAPSHOT.detectors}
- Trace formats ingested: ${SNAPSHOT.formats}
- Tokenizer: ${SNAPSHOT.tokenizer}
${pricingSrc ? `\nLIVE pricing.ts (truncated):\n\`\`\`\n${pricingSrc}\n\`\`\`` : ""}

Return a markdown tech digest, under ~450 words:
1. **Price/model drift** — which tracked prices are likely stale (with the direction of change if known), and which notable models are MISSING and should be added. Mark each as [confirm] vs [verify].
2. **Accuracy risks** — where might our estimates mislead a user (tokenizer approximation, savings formulas, cache discount assumptions)? Pick the 1-2 most important.
3. **Next detector** — propose the single highest-value new detector to add, with a one-line trigger heuristic.
4. **Format/ecosystem watch** — any new trace/observability export or provider caching feature worth supporting.
Be specific and actionable. If everything looks current, say so plainly instead of inventing work.`;
}

export default async function handler(req, res) {
  const auth = authorize(req);
  if (!auth.ok) return res.status(auth.code).json({ ok: false, reason: auth.reason });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(200).json({ ok: true, skipped: "ANTHROPIC_API_KEY not set — CTO agent dormant" });
  }

  const pricingSrc = await livePricing();
  let digest;
  try {
    digest = await anthropic({ system: SYSTEM, user: buildPrompt(pricingSrc), maxTokens: 1800 });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e).slice(0, 300) });
  }
  if (!digest) return res.status(200).json({ ok: true, skipped: "no LLM output" });

  const bodyHtml = `${mdToHtml(digest)}
    <div style="font-size:11px;color:#aaa;margin-top:14px">grounding: ${
      pricingSrc ? "live pricing.ts from GitHub" : "built-in snapshot (set GITHUB_REPO for live review)"
    }</div>`;

  const email = await sendEmail({
    subject: "🛠️ TokenDam CTO — weekly drift & accuracy review",
    html: emailShell("CTO — weekly technical review", bodyHtml),
    text: digest,
  });

  return res.status(200).json({ ok: true, emailed: !email.skipped, grounded: !!pricingSrc });
}

function mdToHtml(md) {
  return escapeHtml(md)
    .replace(/^#{1,3} (.*)$/gm, "<h3 style='margin:14px 0 6px'>$1</h3>")
    .replace(/^\s*\d+\. (.*)$/gm, "<div style='margin:4px 0'><b>$1</b></div>")
    .replace(/^\s*[-*] (.*)$/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]*?<\/li>)/g, "<ul style='margin:6px 0'>$1</ul>")
    .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code style='background:#f3f3f3;padding:1px 4px;border-radius:3px'>$1</code>")
    .replace(/\n{2,}/g, "<br><br>");
}
