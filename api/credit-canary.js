// api/credit-canary.js — the money smoke-detector. NO real LLM work.
//
// Job: catch the "Anthropic account ran out of credits → every LLM agent silently
// dies" failure BEFORE it kills the fleet. This is the exact landmine that once
// took down Khotan's production magic moment. Once a day it makes the smallest
// possible Anthropic call (max_tokens:1) and inspects the result:
//   - success (or any non-billing error) → SILENCE (healthy / transient).
//   - a credit/billing failure (400 "credit balance too low", 402, quota) → EMAIL.
//
// Philosophy mirrors ops-sentinel: SILENCE = HEALTHY. Cost ≈ one input token/day.

import { authorize, sendEmail, emailShell, escapeHtml } from "./_shared.js";

// Substrings that mean "you are out of money", not "you sent a bad request".
const BILLING_SIGNS = [
  "credit balance is too low",
  "credit balance too low",
  "insufficient",
  "billing",
  "quota",
  "payment",
  "plan and billing",
];

export default async function handler(req, res) {
  const auth = authorize(req);
  if (!auth.ok) return res.status(auth.code).json({ ok: false, reason: auth.reason });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    // No key set → nothing to guard. Stay silent; not this canary's job to nag.
    return res.status(200).json({ ok: true, skipped: true, reason: "ANTHROPIC_API_KEY not set" });
  }

  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
  let status = 0;
  let errText = "";
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
    });
    status = r.status;
    if (!r.ok) errText = (await r.text().catch(() => "")).slice(0, 400);
  } catch (e) {
    // Network blip — not a billing problem. Stay silent (transient).
    return res.status(200).json({ ok: true, healthy: true, note: `transient: ${e.message}` });
  }

  if (status >= 200 && status < 300) {
    return res.status(200).json({ ok: true, healthy: true, status });
  }

  const low = errText.toLowerCase();
  const isBilling = status === 402 || BILLING_SIGNS.some((s) => low.includes(s));

  if (isBilling) {
    const body = `<p><b>The TokenDam agent fleet is about to go dark — the Anthropic API rejected a call for a billing/credit reason.</b></p>
      <p>PM, CTO and detector-R&D agents all depend on this key. Top up at
      <a href="https://console.anthropic.com/settings/billing">console.anthropic.com → Billing</a>.</p>
      <p style="font-size:12px;color:#666">HTTP ${status} · model ${escapeHtml(model)}</p>
      <pre style="font-size:11px;color:#666;white-space:pre-wrap">${escapeHtml(errText)}</pre>`;
    try {
      await sendEmail({
        subject: `🚨 TokenDam credit-canary: Anthropic billing failure (HTTP ${status})`,
        html: emailShell("Credit Canary — Anthropic billing FAILING", body),
        text: `Anthropic billing failure HTTP ${status} for model ${model}. Top up at console.anthropic.com/settings/billing.\n\n${errText}`,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, isBilling: true, status, emailError: e.message });
    }
    return res.status(200).json({ ok: false, alerted: true, status, reason: "billing" });
  }

  // Non-billing error (bad model name, transient 5xx, rate limit) → don't cry wolf.
  return res.status(200).json({ ok: true, healthy: true, status, note: "non-billing error, ignored" });
}
