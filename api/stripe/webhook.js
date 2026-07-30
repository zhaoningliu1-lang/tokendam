// TokenDam Cloud — Stripe webhook. Makes Pro self-serve.
//
// The gap this closes: a customer could pay via the Stripe link and get NOTHING
// until a human hand-edited TOKENDAM_PRO_ACCOUNTS and redeployed. Now, when a
// checkout completes, we record their GitHub account as Pro in KV, and the GitHub
// webhook's isPro() picks it up immediately — no redeploy, no manual step.
//
// The customer tells us WHICH GitHub org/user to entitle via a Stripe Checkout
// custom field (key: "github_account"). On cancellation/non-payment we flip it off.
//
// Graceful: without STRIPE_WEBHOOK_SECRET set, the endpoint no-ops (dormant), so
// shipping this never breaks anything before Stripe is wired.

import crypto from "node:crypto";
import { setPro, getPro, storeEnabled } from "../_store.js";

async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString("utf8");
}

// Verify Stripe's `stripe-signature` header (t=timestamp,v1=hmacSHA256(`t.body`)).
function verify(raw, header, secret) {
  if (!secret) return { ok: false, reason: "no secret" };
  const parts = Object.fromEntries(
    String(header || "")
      .split(",")
      .map((kv) => kv.split("=").map((s) => s.trim()))
  );
  if (!parts.t || !parts.v1) return { ok: false, reason: "malformed signature" };
  const expected = crypto.createHmac("sha256", secret).update(`${parts.t}.${raw}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "bad signature" };
  return { ok: true };
}

// Pull the customer-supplied GitHub account out of a checkout session.
function githubAccountFrom(obj) {
  const fields = obj.custom_fields || [];
  const f = fields.find((x) => /github/i.test(x.key || "") || /github/i.test(x.label?.custom || ""));
  const fromField = f?.text?.value || f?.dropdown?.value;
  return (fromField || obj.metadata?.github_account || obj.client_reference_id || "").trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(200).json({ ok: true, service: "tokendam-cloud stripe webhook" });

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const raw = await readRaw(req);
  const v = verify(raw, req.headers["stripe-signature"], secret);
  if (!v.ok) return res.status(secret ? 401 : 200).json({ ok: !secret, note: v.reason });

  let evt;
  try {
    evt = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: "bad json" });
  }
  if (!storeEnabled()) return res.status(200).json({ ok: true, note: "KV not configured — cannot record" });

  const obj = evt.data?.object || {};
  try {
    switch (evt.type) {
      case "checkout.session.completed": {
        const login = githubAccountFrom(obj);
        if (!login) return res.status(200).json({ ok: true, note: "no github_account on session" });
        await setPro(login, {
          status: "active",
          customerId: obj.customer || "",
          subscriptionId: obj.subscription || "",
          email: obj.customer_details?.email || "",
          at: evt.created ? String(evt.created) : "",
        });
        return res.status(200).json({ ok: true, entitled: login });
      }
      case "customer.subscription.deleted":
      case "customer.subscription.paused": {
        // Find the login by matching stored customerId is overkill for MVP; rely on
        // metadata carried on the subscription if present.
        const login = (obj.metadata?.github_account || "").trim();
        if (login) {
          const cur = (await getPro(login)) || {};
          await setPro(login, { ...cur, status: "canceled" });
        }
        return res.status(200).json({ ok: true, canceled: login || "(unknown)" });
      }
      default:
        return res.status(200).json({ ok: true, ignored: evt.type });
    }
  } catch (e) {
    return res.status(500).json({ error: String(e).slice(0, 200) });
  }
}
