// Verifies the provider-cost aggregators — the correctness-critical bit is the
// UNIT handling: OpenAI amount.value is USD dollars; Anthropic amount is CENTS.
// Getting this wrong would make the "real bill" moat off by 100x.
import { aggregateOpenAI, aggregateAnthropic, renderBill } from "../src/usage.ts";

let failed = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`); if (!c) failed++; };
const near = (a, b) => Math.abs(a - b) < 1e-6;

// --- Anthropic: amount is a STRING in CENTS ("123.45" => $1.2345) ---
const aBuckets = [
  {
    starting_at: "2025-08-01T00:00:00Z",
    results: [{ amount: "123.78912", currency: "USD" }],
  },
  {
    starting_at: "2025-08-02T00:00:00Z",
    results: [{ amount: "100" }, { amount: "50" }], // 150 cents => $1.50
  },
];
const a = aggregateAnthropic(aBuckets);
ok("anthropic: cents→dollars (123.78912¢ = $1.2378912)", a.length === 2 && near(a[0].usd, 1.2378912), `got $${a[0]?.usd}`);
ok("anthropic: sums multiple results per bucket ($1.50)", near(a[1].usd, 1.5), `got $${a[1]?.usd}`);
ok("anthropic: NOT read as dollars (guards the 100x landmine)", a[0].usd < 2, `got $${a[0]?.usd}`);
ok("anthropic: sorted by date", a[0].date === "2025-08-01" && a[1].date === "2025-08-02");

// --- OpenAI: amount.value is USD dollars ---
const t1 = Math.floor(Date.parse("2025-08-01T00:00:00Z") / 1000);
const t2 = Math.floor(Date.parse("2025-08-02T00:00:00Z") / 1000);
const oBuckets = [
  { start_time: t2, results: [{ amount: { value: 2.5, currency: "usd" } }] },
  { start_time: t1, results: [{ amount: { value: 1.23, currency: "usd" } }, { amount: { value: 0.77, currency: "usd" } }] },
];
const o = aggregateOpenAI(oBuckets);
ok("openai: amount.value read as dollars", o.length === 2 && near(o.find((d) => d.date === "2025-08-02").usd, 2.5));
ok("openai: sums multiple results ($2.00)", near(o.find((d) => d.date === "2025-08-01").usd, 2.0));
ok("openai: sorted ascending by date", o[0].date === "2025-08-01" && o[1].date === "2025-08-02");

// --- empty / malformed input is safe ---
ok("empty buckets → []", aggregateOpenAI([]).length === 0 && aggregateAnthropic(undefined).length === 0);

// --- renderBill produces a readable summary ---
const bill = { provider: "anthropic", days: a, totalUSD: a[0].usd + a[1].usd, perDayUSD: (a[0].usd + a[1].usd) / 2 };
const txt = renderBill(bill);
ok("renderBill shows the total + provider + 'real'", /real spend/.test(txt) && /anthropic/.test(txt) && /\$2\.74/.test(txt), );
ok("renderBill on empty is a helpful message", /No .* cost data/.test(renderBill({ provider: "openai", days: [], totalUSD: 0, perDayUSD: 0 })));

console.log(failed ? `\n✗ ${failed} usage check(s) failed` : "\nALL USAGE CHECKS PASSED");
process.exit(failed ? 1 : 0);
