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

export async function listRepos() {
  if (!storeEnabled()) return [];
  return (await cmd(["SMEMBERS", "td:repos"])) || [];
}
