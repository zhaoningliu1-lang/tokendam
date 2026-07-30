// TokenDam — anonymous, content-free usage counter.
//
// POST /api/hit  { source }   → 204. Increments a COUNT. Public (the web app
//   pings it via navigator.sendBeacon when an analysis runs). It stores NO
//   pasted content, NO prompts, NO IP, NO user-agent — just a number, plus which
//   button ran it (paste | example | file) so we can tell real use from demos.
//   Spends nothing (a single KV INCR), so a public write is safe.
//
// GET  /api/hit?secret=CRON_SECRET  → { total, bySource, days:[...] }. Gated,
//   so only the operator can read the numbers. Falls back to {enabled:false}
//   when no KV store is attached.
import { bumpHit, getHitStats } from "./_store.js";
import { authorize } from "./_shared.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const auth = authorize(req);
    if (!auth.ok) return res.status(auth.code).json({ error: auth.reason });
    try {
      return res.status(200).json(await getHitStats());
    } catch (e) {
      return res.status(500).json({ error: String(e).slice(0, 200) });
    }
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).end();
  }

  // Best-effort, never fail the page. Parse only `source`; ignore everything else.
  let source = "unknown";
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (b && typeof b.source === "string") source = b.source;
  } catch {
    /* malformed body → count as unknown */
  }
  try {
    await bumpHit(source);
  } catch {
    /* KV hiccup must never surface to the user */
  }
  return res.status(204).end();
}
