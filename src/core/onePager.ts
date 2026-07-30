// Executive one-pager — a shareable, print-to-PDF report.
//
// The CLI/PR comment prove value to an ENGINEER. This proves it to their BOSS:
// a clean single page with the headline $/month + annual projection, an exec
// summary in plain English, the findings as line items, and a methodology note.
// Self-contained HTML (inline CSS) so `tokendam --format html > report.html`
// opens anywhere and Cmd-P → "Save as PDF" gives a real paper report.

import type { Report } from "./types.js";

function money(n: number): string {
  if (n >= 1000) return "$" + Math.round(n).toLocaleString();
  if (n >= 1) return "$" + n.toFixed(2);
  if (n >= 0.01) return "$" + n.toFixed(3);
  return "$" + n.toFixed(5);
}
function esc(s: unknown): string {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
}
const SEV: Record<string, { label: string; color: string }> = {
  high: { label: "HIGH", color: "#dc2626" },
  medium: { label: "MED", color: "#d97706" },
  low: { label: "LOW", color: "#6b7280" },
};

export function renderOnePager(report: Report, callsPerDay = 1000): string {
  const perCallSave = report.perCallSavableUSD;
  const monthly = perCallSave * callsPerDay * 30;
  const annual = perCallSave * callsPerDay * 365;
  const monthlySpend = report.perCallUSD * callsPerDay * 30;
  const summary =
    report.findings.length === 0
      ? "No material token waste found — this workload is already well optimized."
      : `Across a representative sample of ${report.numCalls} LLM call(s), about ${report.wasteRatePct.toFixed(0)}% of tokens did no real work. TokenDam found ${report.findings.length} source(s) of waste totaling ~${report.savablePct.toFixed(0)}% of spend — roughly ${money(monthly)}/month (${money(annual)}/year) recoverable at ${callsPerDay.toLocaleString()} calls/day, without changing model behavior.`;

  // Reconcile: the per-finding "gross waste" figures sum to more than the headline
  // because the total is NET (discounted for prompt caching + capped for overlap).
  // Allocate the net recoverable across findings in proportion to each one's gross
  // waste, so the rows sum EXACTLY to the headline — a boss-facing doc must foot.
  const grossTotal = report.findings.reduce((s, f) => s + (f.wastedUSD || 0), 0);
  const netPerCall = report.perCallSavableUSD; // net, per call
  const rows = report.findings
    .map((f) => {
      const s = SEV[f.severity] || SEV.low;
      const share = grossTotal > 0 ? (f.wastedUSD || 0) / grossTotal : 0;
      const netMonthly = netPerCall * share * callsPerDay * 30;
      return `<tr>
        <td><span style="display:inline-block;font:600 10px/1 ui-monospace,monospace;color:#fff;background:${s.color};padding:3px 6px;border-radius:4px">${s.label}</span></td>
        <td><b>${esc(f.title)}</b><div style="color:#6b7280;font-size:12px;margin-top:3px">${esc(f.fix || f.detail || "")}</div></td>
        <td style="text-align:right;white-space:nowrap">${f.wastedTokens ? f.wastedTokens.toLocaleString() + " tok" : "—"}</td>
        <td style="text-align:right;white-space:nowrap;font-weight:600">${netMonthly > 0 ? money(netMonthly) + "/mo" : "—"}</td>
      </tr>`;
    })
    .join("");

  const stat = (k: string, v: string, hl = false) =>
    `<div style="flex:1;padding:14px 16px;border:1px solid #e5e7eb;border-radius:10px;${hl ? "background:#ecfdf5;border-color:#a7f3d0" : ""}">
      <div style="font:600 10px/1 ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:#9ca3af">${k}</div>
      <div style="font:700 22px/1.1 -apple-system,system-ui,sans-serif;margin-top:8px;color:${hl ? "#047857" : "#111827"}">${v}</div>
    </div>`;

  const notes = report.notes.map((n) => `<li>${esc(n)}</li>`).join("");

  // Cost centers — CFO view of which agent/step drives spend (only when the trace
  // carried agent identity). Monthly figure = the agent's share of projected spend.
  const costCenters = report.byAgent?.length
    ? `<h3 style="margin:26px 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#374151">Cost centers — spend by agent</h3>
  <table>
    <thead><tr><th>Agent / step</th><th style="text-align:right">Calls</th><th style="text-align:right">Tokens</th><th style="text-align:right">Share</th><th style="text-align:right">Spend / mo</th></tr></thead>
    <tbody>${report.byAgent
      .map(
        (a) =>
          `<tr><td><b>${esc(a.id)}</b></td><td style="text-align:right">${a.calls}</td><td style="text-align:right">${a.tokens.toLocaleString()}</td><td style="text-align:right">${a.pctOfSpend.toFixed(0)}%</td><td style="text-align:right;font-weight:600">${money((a.pctOfSpend / 100) * monthlySpend)}/mo</td></tr>`
      )
      .join("")}</tbody>
  </table>`
    : "";

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TokenDam — token-cost report</title>
<style>
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .page { box-shadow:none !important; margin:0 !important; } }
  body { margin:0; background:#f3f4f6; font:14px/1.55 -apple-system,system-ui,Segoe UI,Roboto,sans-serif; color:#111827; }
  .page { max-width:760px; margin:28px auto; background:#fff; border-radius:14px; box-shadow:0 1px 3px rgba(0,0,0,.08); padding:40px 44px; }
  h1 { font-size:20px; margin:0; letter-spacing:-.01em; }
  table { width:100%; border-collapse:collapse; margin-top:8px; }
  td, th { padding:11px 8px; border-bottom:1px solid #f3f4f6; vertical-align:top; font-size:13px; }
  th { text-align:left; font:600 10px/1 ui-monospace,monospace; letter-spacing:.05em; text-transform:uppercase; color:#9ca3af; }
  .muted { color:#6b7280; font-size:12px; }
</style></head>
<body><div class="page">
  <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #111827;padding-bottom:12px">
    <div>
      <h1>TokenDam — Token P&amp;L</h1>
      <div class="muted" style="margin-top:4px">${esc(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }))} · the token profit-and-loss for the <b>${esc(report.model || report.vendor)}</b> workload</div>
    </div>
    <div class="muted">model: <b>${esc(report.model || report.vendor)}</b></div>
  </div>

  <div style="display:flex;gap:12px;margin:22px 0">
    ${stat("Spend / month", money(monthlySpend))}
    ${stat("Recoverable / month", money(monthly), true)}
    ${stat("Waste rate", report.wasteRatePct > 0 ? report.wasteRatePct.toFixed(0) + "% of tokens" : "—")}
    ${stat("Recoverable / year", money(annual), true)}
  </div>

  <p style="font-size:15px;line-height:1.6">${esc(summary)}</p>

  ${costCenters}
  <h3 style="margin:26px 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#374151">Findings</h3>
  <table>
    <thead><tr><th>Sev</th><th>Issue &amp; recommended fix</th><th style="text-align:right">Waste</th><th style="text-align:right">Recoverable / mo</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="4" class="muted">Nothing material — already optimized.</td></tr>`}</tbody>
  </table>

  <h3 style="margin:26px 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#374151">Method &amp; assumptions</h3>
  <ul class="muted" style="margin:4px 0;padding-left:18px">
    <li>Projections assume ${callsPerDay.toLocaleString()} calls/day; scale linearly to your real volume.</li>
    <li>Per-finding "Recoverable / mo" is the <b>net</b> recoverable after prompt-cache discounts and overlap, allocated across findings by their share of gross waste — so the line items sum to the headline.</li>
    <li>Savings are cost-only — the recommended fixes keep model outputs identical.</li>
    ${notes}
  </ul>

  <div style="margin-top:28px;border-top:1px solid #e5e7eb;padding-top:12px;display:flex;justify-content:space-between" class="muted">
    <span>Generated by TokenDam · analyzed locally, no data uploaded</span>
    <span>tokendam.dev</span>
  </div>
</div></body></html>`;
}
