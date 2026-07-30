// Real provider spend — the closed-loop moat + retention hook.
//
// Everything else in TokenDam ESTIMATES cost from a trace. This pulls your ACTUAL
// daily bill from the provider's cost API, so TokenDam can say "you really spent
// $X, and after this fix it dropped to $Y" instead of "you could save ~$Z". That
// measured-savings loop is the defensible asset (est. -> proven) and the reason to
// keep paying month over month (we watch your live bill), per the product plan.
//
// NOT in src/core (which is pure + bundled into the browser): this does network
// I/O with a privileged admin key and must only ever run in Node (CLI / server).
// The key is the CUSTOMER's own read-only admin key, used locally — nothing is
// uploaded to us, same trust stance as the rest of the tool.
//
// Provider quirks handled here (correctness is the whole point):
//   • OpenAI  /v1/organization/costs   → results[].amount.value is USD dollars.
//   • Anthropic /v1/organizations/cost_report → results[].amount is a STRING in
//     CENTS ("123.45" = $1.2345), so we divide by 100.

export interface DailyCost {
  date: string; // YYYY-MM-DD (UTC)
  usd: number;
}
export interface BillSummary {
  provider: "openai" | "anthropic";
  days: DailyCost[];
  totalUSD: number;
  perDayUSD: number;
}

const DAY = 86400;
const iso = (unixSec: number) => new Date(unixSec * 1000).toISOString();
const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function getJSON(url: string, headers: Record<string, string>): Promise<any> {
  const r = await fetch(url, { headers });
  const body = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${body.slice(0, 200)}`);
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`non-JSON response: ${body.slice(0, 120)}`);
  }
}

const toSorted = (m: Map<string, number>): DailyCost[] =>
  [...m.entries()].map(([date, usd]) => ({ date, usd })).sort((a, b) => a.date.localeCompare(b.date));

// Pure aggregators (exported for tests) — the correctness-critical bit is the
// unit handling: OpenAI amount.value is USD dollars; Anthropic amount is CENTS.
export function aggregateOpenAI(buckets: any[]): DailyCost[] {
  const out = new Map<string, number>();
  for (const b of buckets || []) {
    const date = ymd(new Date((b.start_time || 0) * 1000));
    let usd = 0;
    for (const res of b.results || []) usd += Number(res?.amount?.value || 0);
    out.set(date, (out.get(date) || 0) + usd);
  }
  return toSorted(out);
}

export function aggregateAnthropic(buckets: any[]): DailyCost[] {
  const out = new Map<string, number>();
  for (const b of buckets || []) {
    const date = ymd(new Date(b.starting_at));
    let cents = 0;
    for (const res of b.results || []) cents += Number(res?.amount || 0);
    out.set(date, (out.get(date) || 0) + cents / 100); // amount is in CENTS
  }
  return toSorted(out);
}

// --- OpenAI: GET /v1/organization/costs (admin key sk-admin…) ---
async function fetchOpenAI(adminKey: string, days: number): Promise<DailyCost[]> {
  const start = Math.floor(Date.now() / 1000) - days * DAY;
  const headers = { authorization: `Bearer ${adminKey}` };
  const buckets: any[] = [];
  let page: string | undefined;
  for (let guard = 0; guard < 40; guard++) {
    const u = new URL("https://api.openai.com/v1/organization/costs");
    u.searchParams.set("start_time", String(start));
    u.searchParams.set("bucket_width", "1d");
    u.searchParams.set("limit", "180");
    if (page) u.searchParams.set("page", page);
    const j = await getJSON(u.toString(), headers);
    buckets.push(...(j.data || []));
    if (j.has_more && j.next_page) page = j.next_page;
    else break;
  }
  return aggregateOpenAI(buckets);
}

// --- Anthropic: GET /v1/organizations/cost_report (admin key sk-ant-admin…) ---
async function fetchAnthropic(adminKey: string, days: number): Promise<DailyCost[]> {
  const start = iso(Math.floor(Date.now() / 1000) - days * DAY);
  const headers = { "x-api-key": adminKey, "anthropic-version": "2023-06-01" };
  const buckets: any[] = [];
  let page: string | undefined;
  for (let guard = 0; guard < 40; guard++) {
    const u = new URL("https://api.anthropic.com/v1/organizations/cost_report");
    u.searchParams.set("starting_at", start);
    u.searchParams.set("bucket_width", "1d");
    u.searchParams.set("limit", "180");
    if (page) u.searchParams.set("page", page);
    const j = await getJSON(u.toString(), headers);
    buckets.push(...(j.data || []));
    if (j.has_more && j.next_page) page = j.next_page;
    else break;
  }
  return aggregateAnthropic(buckets);
}

export async function fetchBill(
  provider: "openai" | "anthropic",
  adminKey: string,
  days = 30
): Promise<BillSummary> {
  const daysArr = provider === "openai" ? await fetchOpenAI(adminKey, days) : await fetchAnthropic(adminKey, days);
  const totalUSD = daysArr.reduce((s, d) => s + d.usd, 0);
  return { provider, days: daysArr, totalUSD, perDayUSD: daysArr.length ? totalUSD / daysArr.length : 0 };
}

const money = (n: number) => (n >= 1000 ? "$" + Math.round(n).toLocaleString() : "$" + n.toFixed(2));

// Braille-ish ASCII sparkline of daily spend.
function spark(vals: number[]): string {
  if (!vals.length) return "";
  const blocks = "▁▂▃▄▅▆▇█";
  const max = Math.max(...vals, 1e-9);
  return vals.map((v) => blocks[Math.min(7, Math.floor((v / max) * 7.999))]).join("");
}

export function renderBill(b: BillSummary): string {
  if (!b.days.length) return `No ${b.provider} cost data returned. Check the admin key has usage/cost read scope.`;
  const recent = b.days.slice(-7);
  const first = b.days[0].usd || 0;
  const last = b.days[b.days.length - 1].usd || 0;
  const trend = first > 0 ? Math.round(((last - first) / first) * 100) : 0;
  const arrow = trend > 5 ? `▲ +${trend}%` : trend < -5 ? `▼ ${trend}%` : "→ flat";
  const L: string[] = [];
  L.push(`  real spend · ${b.provider} · last ${b.days.length} day(s)`);
  L.push(`  ${spark(b.days.map((d) => d.usd))}`);
  L.push(`  total ${money(b.totalUSD)}   ·   avg ${money(b.perDayUSD)}/day   ·   first→last ${arrow}`);
  L.push("");
  for (const d of recent) L.push(`  ${d.date}   ${money(d.usd)}`);
  L.push("");
  L.push("  This is your ACTUAL provider bill (pulled with your own admin key, nothing uploaded).");
  L.push("  Apply TokenDam's fixes, then re-run to see the real drop — not an estimate.");
  return L.join("\n");
}
