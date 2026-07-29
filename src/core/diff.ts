import type { Report } from "./types.js";
import { usd } from "./pricing.js";

// Deterministic before/after comparison of two traces — "did this change make
// token cost worse?" Same input always yields the same verdict, so it drops into
// CI as a regression gate. This is exactly what a one-line LLM prompt can't do
// reliably: repeatable, exact, exit-coded.

export interface DiffResult {
  regressed: boolean;
  exitCode: number;
  spendPerCallBefore: number;
  spendPerCallAfter: number;
  spendDeltaPct: number; // + = more expensive
  wastePctBefore: number;
  wastePctAfter: number;
  wasteDeltaPts: number; // + = more recoverable waste
  verdict: "improved" | "regressed" | "unchanged";
  /** True when the two traces use different models — the delta then reflects the
   *  model price gap, not just your prompt change. The verdict isn't comparable. */
  crossModel: boolean;
}

export function diffReports(before: Report, after: Report, maxRegressionPct = 1): DiffResult {
  const b = before.perCallUSD || 0;
  const a = after.perCallUSD || 0;
  const spendDeltaPct = b > 0 ? ((a - b) / b) * 100 : a > 0 ? 100 : 0;
  const wasteDeltaPts = after.savablePct - before.savablePct;

  // "Worse" = per-call spend up beyond tolerance, or recoverable waste % up.
  const regressed = spendDeltaPct > maxRegressionPct || wasteDeltaPts > maxRegressionPct;
  const improved = spendDeltaPct < -maxRegressionPct || wasteDeltaPts < -maxRegressionPct;
  const verdict = regressed ? "regressed" : improved ? "improved" : "unchanged";

  return {
    regressed,
    exitCode: regressed ? 1 : 0,
    spendPerCallBefore: b,
    spendPerCallAfter: a,
    spendDeltaPct,
    wastePctBefore: before.savablePct,
    wastePctAfter: after.savablePct,
    wasteDeltaPts,
    verdict,
    crossModel: before.model !== after.model,
  };
}

const arrow = (d: number) => (d > 0 ? "▲" : d < 0 ? "▼" : "•");

export function renderDiffText(before: Report, after: Report, r: DiffResult): string {
  const L: string[] = [];
  const bar = "─".repeat(56);
  L.push(bar);
  L.push(`  TokenDam diff — ${r.verdict.toUpperCase()}`);
  L.push(bar);
  L.push(
    `  models     ${before.model} → ${after.model}` + (r.crossModel ? "  ⚠ different models" : "")
  );
  L.push(`  calls      ${before.numCalls} → ${after.numCalls}`);
  L.push(
    `  spend/call ${usd(r.spendPerCallBefore)} → ${usd(r.spendPerCallAfter)}  ${arrow(
      r.spendDeltaPct
    )} ${r.spendDeltaPct >= 0 ? "+" : ""}${r.spendDeltaPct.toFixed(1)}%`
  );
  L.push(
    `  waste      ${r.wastePctBefore.toFixed(0)}% → ${r.wastePctAfter.toFixed(0)}%  ${arrow(
      r.wasteDeltaPts
    )} ${r.wasteDeltaPts >= 0 ? "+" : ""}${r.wasteDeltaPts.toFixed(0)} pts`
  );
  L.push(bar);
  L.push(
    r.verdict === "regressed"
      ? "  ✗ This change increased token cost."
      : r.verdict === "improved"
      ? "  ✓ This change reduced token cost."
      : "  • No meaningful change in token cost."
  );
  if (r.crossModel)
    L.push("  ⚠ Different models — this delta reflects the model change, not just token usage.");
  L.push(bar);
  return L.join("\n");
}
