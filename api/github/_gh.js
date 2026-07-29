// GitHub App auth + REST helpers for TokenDam Cloud.
// - JWT (RS256) signed with the app private key → short-lived app token
// - exchange for an installation access token
// - minimal REST fetch helper + webhook signature verification
// All secrets from process.env; no dependencies beyond node:crypto.

import crypto from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

/** App JWT (valid ~9 min) signed with GITHUB_APP_PRIVATE_KEY. */
export function appJwt() {
  const appId = process.env.GITHUB_APP_ID;
  // Private key may be stored with escaped newlines in the env var.
  const key = (process.env.GITHUB_APP_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!appId || !key) throw new Error("GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY not set");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const data = `${header}.${payload}`;
  const sig = crypto.createSign("RSA-SHA256").update(data).sign(key);
  return `${data}.${b64url(sig)}`;
}

/** Exchange the app JWT for an installation access token. */
export async function installationToken(installationId) {
  const r = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${appJwt()}`,
        accept: "application/vnd.github+json",
        "user-agent": "tokendam-cloud",
      },
    }
  );
  if (!r.ok) throw new Error(`installation token ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).token;
}

/** Minimal GitHub REST call with an installation token. */
export async function gh(token, method, path, body) {
  const r = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "tokendam-cloud",
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`gh ${method} ${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
}

/** Verify the X-Hub-Signature-256 webhook signature. */
export function verifySignature(rawBody, signature) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return true; // unset (dev) — allow, but you should set it in prod
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ""));
  } catch {
    return false;
  }
}
