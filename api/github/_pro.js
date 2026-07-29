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

export function isProAccount(login) {
  return LIST.includes(String(login || "").toLowerCase());
}

export function proAccountCount() {
  return LIST.length;
}
