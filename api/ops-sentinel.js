// api/ops-sentinel.js — Agent 1 of 3. NO LLM.
//
// Job: keep the live product honest. Fetch tokendam.vercel.app, discover its
// hashed JS asset from the HTML, and fetch that too. Verify the page is really
// the app (not a Vercel error/placeholder shell) and the JS actually loads.
//
// Philosophy: SILENCE = HEALTHY. This agent emails ONLY on failure, so an inbox
// with nothing from it means every check passed. It never uses the LLM and never
// touches anything outward-facing.

import { authorize, sendEmail, emailShell, escapeHtml } from "./_shared.js";

const SITE = process.env.TOKENDAM_URL || "https://tokendam.vercel.app";
const TIMEOUT_MS = 12000;

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "TokenDam-OpsSentinel/1.0 (+https://tokendam.vercel.app)" },
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

export default async function handler(req, res) {
  const auth = authorize(req);
  if (!auth.ok) return res.status(auth.code).json({ ok: false, reason: auth.reason });

  const failures = [];
  const checks = [];

  // --- Check 1: the HTML page loads and looks like TokenDam ---
  let html = "";
  try {
    const t0 = Date.now();
    const r = await fetchWithTimeout(SITE, TIMEOUT_MS);
    const ms = Date.now() - t0;
    html = await r.text();
    checks.push(`GET ${SITE} → ${r.status} in ${ms}ms (${html.length} bytes)`);

    if (!r.ok) {
      failures.push(`Homepage returned HTTP ${r.status}.`);
    } else if (!/TokenDam/i.test(html)) {
      // A Vercel error page or a mis-deploy won't contain the product name.
      failures.push(`Homepage 200 but body does not contain "TokenDam" — possible bad deploy or error shell.`);
    }
    if (/Application error|DEPLOYMENT_NOT_FOUND|This Serverless Function has crashed/i.test(html)) {
      failures.push(`Homepage HTML contains a Vercel error signature.`);
    }
  } catch (e) {
    failures.push(`Homepage fetch failed: ${e.name === "AbortError" ? `timeout >${TIMEOUT_MS}ms` : e.message}`);
  }

  // --- Check 2: discover the hashed JS bundle from the HTML and fetch it ---
  // Vite emits /assets/index-<hash>.js — the hash changes every deploy, so we
  // parse it out rather than hardcode a filename that would rot.
  if (html) {
    const m = html.match(/src="([^"]*\/assets\/[^"]+\.js)"/i) || html.match(/src="([^"]+\.js)"/i);
    if (!m) {
      failures.push(`Could not find a JS asset <script src> in the homepage HTML.`);
    } else {
      const assetUrl = m[1].startsWith("http") ? m[1] : new URL(m[1], SITE).toString();
      try {
        const t0 = Date.now();
        const r = await fetchWithTimeout(assetUrl, TIMEOUT_MS);
        const ms = Date.now() - t0;
        const len = Number(r.headers.get("content-length")) || (await r.text()).length;
        checks.push(`GET ${assetUrl} → ${r.status} in ${ms}ms (${len} bytes)`);
        if (!r.ok) failures.push(`JS asset returned HTTP ${r.status}: ${assetUrl}`);
        // The entry bundle is small (~5KB) because the tokenizer lazy-loads on
        // demand. Anything under ~1KB means a broken/empty build.
        else if (len < 1000) failures.push(`JS asset suspiciously small (${len} bytes) — build may be broken: ${assetUrl}`);
      } catch (e) {
        failures.push(`JS asset fetch failed (${assetUrl}): ${e.name === "AbortError" ? `timeout >${TIMEOUT_MS}ms` : e.message}`);
      }
    }
  }

  // --- Report: email ONLY on failure ---
  if (failures.length > 0) {
    const body = `<p><b>TokenDam is failing ${failures.length} health check(s).</b></p>
      <ul>${failures.map((f) => `<li style="color:#b00020">${escapeHtml(f)}</li>`).join("")}</ul>
      <p style="font-size:12px;color:#666">Checks run:</p>
      <ul style="font-size:12px;color:#666">${checks.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>`;
    try {
      await sendEmail({
        subject: `🚨 TokenDam ops-sentinel: ${failures.length} check(s) failing`,
        html: emailShell("Ops Sentinel — site health FAILING", body),
        text: `TokenDam health FAILING:\n${failures.map((f) => "- " + f).join("\n")}\n\nChecks:\n${checks.join("\n")}`,
      });
    } catch (e) {
      // Even the alert email failed — surface it in the response so the cron log shows red.
      return res.status(500).json({ ok: false, failures, checks, emailError: e.message });
    }
    return res.status(200).json({ ok: false, alerted: true, failures, checks });
  }

  // Healthy: stay silent (no email). Return 200 for the cron log only.
  return res.status(200).json({ ok: true, healthy: true, checks });
}
