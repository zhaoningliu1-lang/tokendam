// api/_shared.js — shared helpers for TokenDam standing agents.
// No secrets inline; everything is read from process.env at call time.
//
// Design rules (proven Khotan Studios pattern):
//  - Every agent is a Vercel serverless function triggered by cron.
//  - Every agent guards on CRON_SECRET (Vercel cron sends it as a Bearer token).
//  - Every agent gracefully no-ops (200 + {skipped:true}) if creds/env are missing,
//    so a half-configured deploy never 500s a cron and never pages anyone.
//  - Anything outward-facing is DRAFT ONLY: we email a draft, we never auto-post.

/**
 * Verify the request came from Vercel Cron (or an operator holding the secret).
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
 * If CRON_SECRET is unset we DENY (fail closed) — an exposed public endpoint that
 * spends LLM tokens or emails on every hit is worse than a silent agent.
 */
export function authorize(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { ok: false, code: 503, reason: "CRON_SECRET not configured" };
  const header = req.headers?.authorization || req.headers?.Authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  // Also accept Vercel's query fallback for manual/local triggering.
  const q = typeof req.query?.secret === "string" ? req.query.secret : "";
  if (token !== secret && q !== secret) {
    return { ok: false, code: 401, reason: "bad or missing cron secret" };
  }
  return { ok: true };
}

/**
 * Send an email via Resend. No-ops (returns {skipped}) if RESEND_API_KEY is missing.
 * Reuses the same verified-domain pattern as the rest of the fleet.
 */
export async function sendEmail({ subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { skipped: true, reason: "RESEND_API_KEY missing" };

  const from = process.env.AGENT_FROM_EMAIL || "TokenDam Agents <agents@khotanstudios.com>";
  const to = (process.env.AGENT_TO_EMAIL || "hello@avantia2a.com")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html: html || `<pre>${escapeHtml(text || "")}</pre>`,
      text: text || stripHtml(html || ""),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
  }
  return { skipped: false, id: (await res.json().catch(() => ({})))?.id };
}

/**
 * Call the Anthropic Messages API. Returns the concatenated text of the reply.
 * No-ops (returns null) if ANTHROPIC_API_KEY is missing so LLM agents degrade
 * to "nothing to draft" instead of crashing.
 */
export async function anthropic({ system, user, maxTokens = 1500, model }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: model || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function stripHtml(s) {
  return String(s).replace(/<[^>]+>/g, "");
}

/** Wrap a body in a minimal, readable HTML shell for the digest emails. */
export function emailShell(title, bodyHtml) {
  return `<div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto;color:#1a1a1a;line-height:1.5">
  <h2 style="margin:0 0 4px">${escapeHtml(title)}</h2>
  <div style="font-size:12px;color:#888;margin-bottom:16px">TokenDam standing agents · ${new Date().toISOString()}</div>
  ${bodyHtml}
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
  <div style="font-size:11px;color:#aaa">Automated draft. Review before acting — nothing was posted or sent to third parties.</div>
</div>`;
}
