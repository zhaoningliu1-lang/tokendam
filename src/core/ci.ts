import type { Report, Severity } from "./types.js";
import { usd } from "./pricing.js";

// CI gate: turn a Report into a pass/fail against a budget, plus renderers for
// GitHub Actions annotations and a Markdown audit (PR comment / share). This is
// the paid surface — a team drops `tokendam --ci` into their pipeline and the
// build fails when a prompt change makes token waste regress past a threshold.

export interface CiConfig {
  /** Fail if savablePct ($ waste as a share of spend) exceeds this (0-100). */
  maxWastePct?: number;
  /** Fail if wasteRatePct (share of TOKENS that were waste) exceeds this (0-100).
   *  The "Effective Tokens" gate — volume-independent, so it's stable as traffic grows. */
  maxWasteRatePct?: number;
  /** Fail if per-call recoverable waste exceeds this many USD. */
  maxWasteUSDPerCall?: number;
  /** Fail if any finding at these severities is present. */
  failOnSeverity?: Severity[];
}

export const DEFAULT_CI: CiConfig = { maxWastePct: 25 };

export interface CiResult {
  pass: boolean;
  exitCode: number; // 0 pass, 1 fail
  violations: string[];
}

export function evaluateCi(report: Report, cfg: CiConfig): CiResult {
  const violations: string[] = [];
  if (cfg.maxWastePct != null && report.savablePct > cfg.maxWastePct)
    violations.push(
      `token waste ${report.savablePct.toFixed(0)}% exceeds budget of ${cfg.maxWastePct}%`
    );
  if (cfg.maxWasteRatePct != null && report.wasteRatePct > cfg.maxWasteRatePct)
    violations.push(
      `effective-token waste ${report.wasteRatePct.toFixed(0)}% of tokens exceeds budget of ${cfg.maxWasteRatePct}%`
    );
  if (cfg.maxWasteUSDPerCall != null && report.perCallSavableUSD > cfg.maxWasteUSDPerCall)
    violations.push(
      `waste ${usd(report.perCallSavableUSD)}/call exceeds budget of ${usd(cfg.maxWasteUSDPerCall)}/call`
    );
  if (cfg.failOnSeverity?.length) {
    // Only actionable findings can fail a build — never a zero-waste "good news"
    // advisory (e.g. "caching already active"). Punishing correct behavior is
    // worse than no gate.
    const hits = report.findings.filter(
      (f) => f.wastedUSD > 0 && cfg.failOnSeverity!.includes(f.severity)
    );
    if (hits.length)
      violations.push(
        `${hits.length} finding(s) at severity ${cfg.failOnSeverity.join("/")}: ${hits
          .map((f) => f.detector)
          .join(", ")}`
      );
  }
  const pass = violations.length === 0;
  return { pass, exitCode: pass ? 0 : 1, violations };
}

/** Markdown audit — for PR comments, sharing, or the web "copy" button. */
export function renderMarkdown(report: Report, ci?: CiResult, callsPerDay = 1000): string {
  const L: string[] = [];
  const status = ci ? (ci.pass ? "✅ pass" : "❌ fail") : "";
  L.push(`### 🧱 TokenDam audit ${status}`);
  if (report.savableUSD > 0) {
    L.push(
      `**Potential savings: ${usd(report.savableUSD)} (~${report.savablePct.toFixed(
        0
      )}% of spend)** · ${usd(report.perCallSavableUSD)}/call · at ${callsPerDay.toLocaleString()} calls/day ≈ **${usd(
        report.perCallSavableUSD * callsPerDay * 30
      )}/month**`
    );
  } else {
    L.push(`No obvious token waste found. 🎉`);
  }
  L.push(`\n_model \`${report.model}\` · ${report.numCalls} call(s) · ${report.totalInputTokens.toLocaleString()} input tokens_`);
  if (ci && !ci.pass) {
    L.push(`\n**Budget violations:**`);
    for (const v of ci.violations) L.push(`- ❌ ${v}`);
  }
  if (report.findings.length) {
    L.push(`\n| Sev | Finding | ~Tokens | $ |`);
    L.push(`|---|---|--:|--:|`);
    for (const f of report.findings) {
      L.push(
        `| ${f.severity.toUpperCase()} | ${f.title.replace(/\|/g, "\\|")} | ${f.wastedTokens.toLocaleString()} | ${
          f.wastedUSD > 0 ? usd(f.wastedUSD) : "—"
        } |`
      );
    }
  }
  L.push(`\n<sub>Analyzed locally by TokenDam — no data uploaded.</sub>`);
  return L.join("\n");
}

/** GitHub Actions workflow-command annotations (show up inline on the run). */
export function renderGithub(report: Report, ci: CiResult): string {
  const L: string[] = [];
  for (const f of report.findings) {
    const level = f.severity === "high" ? "error" : f.severity === "medium" ? "warning" : "notice";
    L.push(`::${level}::TokenDam: ${f.title} (~${f.wastedTokens.toLocaleString()} tok, ${f.wastedUSD > 0 ? usd(f.wastedUSD) : "n/a"})`);
  }
  if (!ci.pass) {
    for (const v of ci.violations) L.push(`::error::TokenDam budget: ${v}`);
  }
  L.push(
    `::${ci.pass ? "notice" : "error"}::TokenDam ${ci.pass ? "passed" : "FAILED"} — savings ${usd(
      report.savableUSD
    )} (~${report.savablePct.toFixed(0)}% of spend)`
  );
  return L.join("\n");
}
