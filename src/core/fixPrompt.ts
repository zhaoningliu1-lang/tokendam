import type { Report, Finding } from "./types.js";
import { usd } from "./pricing.js";

// Machine-readable fix plan — for a CI coding-agent step to consume programmatically
// (each step is a discrete, applyable instruction), rather than the prose fix pack.
export interface FixStep {
  detector: string;
  severity: string;
  title: string;
  estimatedSavingUSD: number;
  instruction: string;
  evidence: string[];
}
export interface FixPlan {
  summary: { model: string; calls: number; savableUSD: number; savablePct: number; perCallSavableUSD: number };
  steps: FixStep[];
}

export function renderFixPlan(report: Report): FixPlan {
  const steps = report.findings.filter(isActionable).map((f) => ({
    detector: f.detector,
    severity: f.severity,
    title: f.title,
    estimatedSavingUSD: f.wastedUSD,
    instruction: f.fix,
    evidence: f.evidence ?? [],
  }));
  return {
    summary: {
      model: report.model,
      calls: report.numCalls,
      savableUSD: report.savableUSD,
      savablePct: report.savablePct,
      perCallSavableUSD: report.perCallSavableUSD,
    },
    steps,
  };
}

// Turn a Report into a "fix pack" — a prompt the user pastes straight into their
// own coding agent (Claude Code, Cursor, …). TokenDam is the brain (precise
// diagnosis + instructions); their coding agent is the hands (it has their code
// and applies the change). We never see their codebase — trust intact.

function isActionable(f: Finding): boolean {
  // Skip pure "you're already doing this, good" advisories — they aren't fixes.
  if (f.detector === "unused-cache" && f.wastedUSD === 0 && /already active/i.test(f.title))
    return false;
  return true;
}

export function renderFixPrompt(report: Report, callsPerDay = 1000): string {
  const findings = report.findings.filter(isActionable);
  if (!findings.length) {
    return "TokenDam found no actionable token waste in this trace — nothing to fix. 🎉";
  }

  const monthly = report.perCallSavableUSD * callsPerDay * 30;
  const L: string[] = [];
  L.push("# TokenDam fix pack");
  L.push("");
  L.push(
    "I ran TokenDam (a local LLM token-waste linter) on my agent's LLM calls and it found the token waste below. Please apply these fixes to my codebase."
  );
  L.push("");
  L.push("Rules:");
  L.push("- These are COST optimizations — keep model behavior identical.");
  L.push("- Make the minimal diff; don't touch unrelated code.");
  L.push("- If a change could alter the model's outputs, ask me before doing it.");
  L.push("- After applying, run my tests and summarize exactly what changed in which files.");
  L.push("");
  if (report.savableUSD > 0) {
    L.push(
      `Estimated impact: ${usd(report.perCallSavableUSD)}/call · ~${report.savablePct.toFixed(
        0
      )}% of this trace's spend · ≈ ${usd(monthly)}/month at ${callsPerDay.toLocaleString()} calls/day.`
    );
    L.push("");
  }
  L.push("## Fixes (highest impact first)");

  findings.forEach((f, i) => {
    L.push("");
    const dollars = f.wastedUSD > 0 ? `  (~${usd(f.wastedUSD)} of this trace)` : "";
    L.push(`### ${i + 1}. ${f.title}${dollars}`);
    L.push(f.fix);
    if (f.evidence?.length) {
      L.push("");
      L.push("Seen in the trace:");
      for (const e of f.evidence.slice(0, 6)) L.push(`- ${e}`);
    }
  });

  L.push("");
  L.push(
    "Apply only the changes above. When done, tell me the before/after token or cost impact you expect for each."
  );
  return L.join("\n");
}
