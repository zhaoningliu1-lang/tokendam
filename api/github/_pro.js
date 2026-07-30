// Subscription gating for TokenDam Cloud.
//
// The paid tier is delivered by an allowlist of GitHub accounts (org/user logins)
// in the TOKENDAM_PRO_ACCOUNTS env var (comma-separated, case-insensitive). When a
// customer pays via the Stripe link, add their GitHub account here and redeploy —
// their repos get the full audit + fix pack + trend history. Everyone else gets a
// free one-line preview with an upgrade CTA (a funnel, not a wall).
//
// Kept as an env allowlist on purpose: at this stage onboarding is manual-first, so
// a DB-backed Stripe↔GitHub mapping would be premature. Swap this one function for a
// store lookup later without touching the webhook.

const LIST = (process.env.TOKENDAM_PRO_ACCOUNTS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Synchronous env-allowlist check (concierge / manual comps).
export function isProAccount(login) {
  return LIST.includes(String(login || "").toLowerCase());
}

// Full check: env allowlist OR an active Stripe subscription recorded in KV by the
// Stripe webhook. This is what makes Pro self-serve — a paid customer is entitled
// the moment their checkout completes, with no manual redeploy. Falls back to the
// env allowlist if KV is unconfigured.
export async function isPro(login) {
  if (isProAccount(login)) return true;
  try {
    const { isProInStore } = await import("../_store.js");
    return await isProInStore(login);
  } catch {
    return false;
  }
}

export function proAccountCount() {
  return LIST.length;
}
