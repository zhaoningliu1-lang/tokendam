// Verifies the CI gate: budgets, exit codes, and that cached-token pricing +
// cache-aware unused-cache behave honestly.
import { analyze } from "../src/core/analyze.ts";
import { evaluateCi, renderMarkdown } from "../src/core/ci.ts";
import { renderFixPrompt } from "../src/core/fixPrompt.ts";

let failed = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`); if (!c) failed++; };

const bigSys = "You are a careful engineering assistant. " + "Follow the rules precisely. ".repeat(220);
const wasteful = [
  { model: "gpt-4o", messages: [{ role: "system", content: bigSys }, { role: "user", content: "a" }] },
  { model: "gpt-4o", messages: [{ role: "system", content: bigSys }, { role: "user", content: "b" }] },
  { model: "gpt-4o", messages: [{ role: "system", content: bigSys }, { role: "user", content: "c" }] },
];

// --- CI gate: fails on a tight budget, passes on a loose one ---
{
  const r = analyze(wasteful);
  const fail = evaluateCi(r, { maxWastePct: 5 });
  const pass = evaluateCi(r, { maxWastePct: 95 });
  ok("CI fails when waste > budget", !fail.pass && fail.exitCode === 1, `(${r.savablePct.toFixed(0)}% waste)`);
  ok("CI passes when under budget", pass.pass && pass.exitCode === 0);
  ok("markdown audit renders a table", renderMarkdown(r, fail).includes("| Sev |"));
}

// --- failOnSeverity ---
{
  const r = analyze(wasteful);
  const res = evaluateCi(r, { failOnSeverity: ["high"] });
  ok("fail-on high triggers when a high finding exists", r.findings.some(f => f.severity === "high") ? !res.pass : res.pass);
}

// --- cached-token pricing: observed cache lowers 'spend as-is' ---
{
  const cachedTrace = wasteful.map((c) => ({ ...c, usage: { prompt_tokens: 1500, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 1400 } } }));
  const bare = analyze(wasteful);
  const cached = analyze(cachedTrace);
  ok("observed cache lowers total spend", cached.totalUSD < bare.totalUSD, `${cached.totalUSD.toFixed(5)} < ${bare.totalUSD.toFixed(5)}`);
}

// --- unused-cache honesty: when usage shows the prefix is already cached, don't nag ---
{
  // Every call reports ~all input served from cache → should NOT claim big waste.
  const cachedTrace = wasteful.map((c) => ({ ...c, usage: { prompt_tokens: 3000, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 2900 } } }));
  const r = analyze(cachedTrace);
  const uc = r.findings.find((f) => f.detector === "unused-cache");
  ok("unused-cache doesn't bill waste when already cached", !uc || uc.wastedUSD === 0, uc ? `(sev=${uc.severity}, $${uc.wastedUSD})` : "(no finding)");
}

// --- fix pack: produces a paste-able prompt with the fixes, or a clean "nothing" ---
{
  const r = analyze(wasteful);
  const fp = renderFixPrompt(r);
  ok("fix prompt contains a fix pack header", fp.includes("# TokenDam fix pack"));
  ok("fix prompt includes the actual fixes", fp.includes("Fixes (highest impact first)") && fp.length > 200);
  const clean = renderFixPrompt(analyze([{ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }]));
  ok("fix prompt says nothing-to-fix on a clean trace", /nothing to fix/i.test(clean));
}

console.log(failed ? `\nFAILED (${failed})` : "\nALL CI CHECKS PASSED");
process.exit(failed ? 1 : 0);
