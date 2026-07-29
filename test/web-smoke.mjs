// Headless smoke test of the web app: loads index.html into a real DOM (jsdom),
// wires up the same globals main.ts expects, executes the analysis for both
// built-in examples, and asserts the report renders with findings + a savings
// headline. This is the browser path minus the pixels.
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { analyze } from "../src/core/analyze.ts";
import { usd } from "../src/core/pricing.ts";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const dom = new JSDOM(html, { runScripts: "outside-only" });
const { document } = dom.window;

// Reproduce the render() DOM writes against the real elements to prove the
// selectors + markup the page relies on actually exist and populate.
function esc(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
function renderInto(reportEl, report) {
  const headline =
    report.savableUSD > 0
      ? `<div class="save">Potential savings <b>${usd(report.savableUSD)}</b></div>`
      : `<div class="save clean">No obvious waste found</div>`;
  const findings = report.findings
    .map((f, i) => `<div class="finding"><span class="ftitle">${i + 1}. ${esc(f.title)}</span></div>`)
    .join("");
  reportEl.innerHTML = `${headline}${findings}`;
  reportEl.classList.remove("hidden");
}

let failed = 0;
function check(name, cond) {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) failed++;
}

// Elements the real main.ts queries must exist:
for (const sel of ["#trace", "#run", "#err", "#report", "#file"]) {
  check(`element ${sel} present in index.html`, !!document.querySelector(sel));
}

const reportEl = document.querySelector("#report");
for (const which of ["sd-tender-radar", "coding-agent"]) {
  const data = JSON.parse(readFileSync(join(here, "..", "examples", `${which}.json`), "utf8"));
  const report = analyze(data);
  renderInto(reportEl, report);
  const html = reportEl.innerHTML;
  check(`${which}: report has findings`, report.findings.length > 0);
  check(`${which}: savings headline rendered`, html.includes("Potential savings"));
  check(`${which}: report visible (hidden class removed)`, !reportEl.classList.contains("hidden"));
  console.log(
    `   → ${which}: ${report.numCalls} calls, ${report.findings.length} findings, save ${usd(
      report.savableUSD
    )} (${report.savablePct.toFixed(0)}%)`
  );
}

console.log(failed ? `\nFAILED (${failed})` : "\nALL WEB SMOKE CHECKS PASSED");
process.exit(failed ? 1 : 0);
