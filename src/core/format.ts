import type { Report, Severity } from "./types.js";
import { usd } from "./pricing.js";

// Plain-text report renderer shared by the CLI (and handy for tests). The web
// UI renders from the Report object directly, so this stays dependency-free.

const BAR = "─".repeat(60);

function sevTag(s: Severity): string {
  return s === "high" ? "[HIGH]  " : s === "medium" ? "[MED]   " : "[LOW]   ";
}

export function renderText(report: Report, callsPerDay = 1000): string {
  const L: string[] = [];
  L.push(BAR);
  L.push(`  TokenDam report`);
  L.push(BAR);
  L.push(
    `  model      ${report.model}  (${report.vendor})`
  );
  L.push(`  calls      ${report.numCalls}`);
  L.push(
    `  input      ${report.totalInputTokens.toLocaleString()} tok` +
      (report.totalOutputTokens
        ? `   output ${report.totalOutputTokens.toLocaleString()} tok`
        : "")
  );
  L.push(`  spend      ${usd(report.totalUSD)}  (this trace, as-is)`);
  L.push("");
  if (report.savableUSD > 0) {
    L.push(
      `  ▶ Potential savings: ${usd(report.savableUSD)}  (~${report.savablePct.toFixed(
        0
      )}% of spend)`
    );
    L.push(
      `    ${usd(report.perCallSavableUSD)}/call · at ${callsPerDay.toLocaleString()} calls/day ≈ ${usd(
        report.perCallSavableUSD * callsPerDay * 30
      )}/month`
    );
  } else {
    L.push(`  ▶ No obvious waste found. Nice.`);
  }
  if (report.totalTokens > 0 && report.wastedTokens > 0) {
    L.push(
      `  ▶ Effective tokens: ${(100 - report.wasteRatePct).toFixed(0)}% did essential work` +
        ` · ${report.wasteRatePct.toFixed(0)}% (${report.wastedTokens.toLocaleString()} tok) avoidable or repriceable`
    );
  }
  L.push(BAR);
  L.push("");

  if (report.byAgent?.length) {
    L.push("  Cost by agent  (which agent/step is burning spend)");
    for (const a of report.byAgent) {
      L.push(
        `    ${(a.pctOfSpend.toFixed(0) + "%").padStart(4)}  ${usd(a.usd).padEnd(9)}` +
          `  ${String(a.calls).padStart(3)} call(s) · ${a.tokens.toLocaleString()} tok   ${a.id}`
      );
    }
    L.push(BAR);
    L.push("");
  }

  if (!report.findings.length) {
    L.push("  No findings.");
  }
  report.findings.forEach((f, i) => {
    L.push(`${sevTag(f.severity)}${i + 1}. ${f.title}`);
    if (f.wastedUSD > 0 || f.wastedTokens > 0)
      L.push(
        `        ~${f.wastedTokens.toLocaleString()} tok  ·  ${usd(f.wastedUSD)}`
      );
    L.push(wrap(f.detail, "        "));
    if (f.evidence?.length) for (const e of f.evidence) L.push(`          - ${e}`);
    L.push(`        FIX: ${wrap(f.fix, "             ").trimStart()}`);
    L.push("");
  });

  if (report.notes.length) {
    L.push(BAR);
    for (const n of report.notes) L.push(`  note: ${n}`);
  }
  L.push(BAR);
  if (report.savableUSD > 0) {
    L.push(`  ▸ Get this on every PR automatically + trends & alerts:`);
    L.push(`    TokenDam Cloud → https://tokendam.dev/pricing`);
    L.push(BAR);
  }
  return L.join("\n");
}

function wrap(text: string, indent: string, width = 76): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = indent;
  for (const w of words) {
    if ((cur + " " + w).length > width && cur.trim()) {
      lines.push(cur);
      cur = indent + w;
    } else {
      cur = cur.trim() === "" ? indent + w : cur + " " + w;
    }
  }
  if (cur.trim()) lines.push(cur);
  return lines.join("\n");
}
