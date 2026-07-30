// Tiny persistence layer for TokenDam Cloud — Upstash / Vercel KV over REST.
//
// Used to remember each PR audit so the dashboard can chart a repo's token-cost
// trend over time. Zero dependencies (plain fetch). GRACEFUL: if the KV env vars
// aren't set, every function no-ops / returns empty, so the webhook keeps working
// without a database. Enable by adding a Vercel KV (Upstash) store to the project
// — it injects KV_REST_API_URL + KV_REST_API_TOKEN automatically.

const URL = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;

export function storeEnabled() {
  return Boolean(URL && TOKEN);
}

async function cmd(args) {
  if (!storeEnabled()) return null;
  const r = await fetch(URL, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`kv ${args[0]} → ${r.status}`);
  const j = await r.json();
  return j.result;
}

const histKey = (repo) => `td:hist:${repo.toLowerCase()}`;

// Record one audit at the head of the repo's history list (newest first), capped.
export async function pushAudit(repo, entry, cap = 200) {
  if (!storeEnabled()) return;
  await cmd(["LPUSH", histKey(repo), JSON.stringify(entry)]);
  await cmd(["LTRIM", histKey(repo), "0", String(cap - 1)]);
  await cmd(["SADD", "td:repos", repo.toLowerCase()]);
}

// Oldest → newest, so charts read left-to-right in time order.
export async function getAudits(repo) {
  if (!storeEnabled()) return [];
  const res = await cmd(["LRANGE", histKey(repo), "0", "199"]);
  return (res || [])
    .map((s) => {
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .reverse();
}

// --- Pro subscription state (set by the Stripe webhook, read by gating) ---
const proKey = (login) => `td:pro:${String(login).toLowerCase()}`;

export async function setPro(login, data) {
  if (!storeEnabled()) return;
  await cmd(["SET", proKey(login), JSON.stringify({ ...data, at: data.at || "" })]);
}

export async function getPro(login) {
  if (!storeEnabled()) return null;
  const v = await cmd(["GET", proKey(login)]);
  if (!v) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

export async function isProInStore(login) {
  const p = await getPro(login);
  return Boolean(p && p.status === "active");
}

export async function listRepos() {
  if (!storeEnabled()) return [];
  return (await cmd(["SMEMBERS", "td:repos"])) || [];
}

// --- Anonymous, content-free usage counters (see /api/hit) ---------------
// We store COUNTS ONLY. Never the pasted trace, never prompts, never IP/UA.
// `source` is which button ran the analysis (paste | example | file) — that's
// a UI signal, not user content — so we can tell real usage from demo clicks.
const daystamp = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

export async function bumpHit(source = "unknown") {
  if (!storeEnabled()) return;
  const src = /^[a-z]{1,12}$/.test(source) ? source : "other";
  await Promise.all([
    cmd(["INCR", "td:hits:total"]),
    cmd(["INCR", `td:hits:day:${daystamp()}`]),
    cmd(["INCR", `td:hits:src:${src}`]),
  ]);
}

// Admin read (gated by CRON_SECRET in /api/hit): total + last 14 days + by-source.
export async function getHitStats() {
  if (!storeEnabled()) return { enabled: false };
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
  const [total, dayVals, ...srcVals] = await Promise.all([
    cmd(["GET", "td:hits:total"]),
    Promise.all(days.map((d) => cmd(["GET", `td:hits:day:${d}`]))),
    ...["paste", "example", "file", "other"].map((s) => cmd(["GET", `td:hits:src:${s}`])),
  ]);
  const num = (v) => Number(v || 0);
  return {
    enabled: true,
    total: num(total),
    bySource: { paste: num(srcVals[0]), example: num(srcVals[1]), file: num(srcVals[2]), other: num(srcVals[3]) },
    days: days.map((d, i) => ({ day: d, hits: num(dayVals[i]) })),
  };
}
