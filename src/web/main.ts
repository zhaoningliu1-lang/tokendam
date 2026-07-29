import "./style.css";
import type { Report, Finding } from "../core/types.js";

// The analysis engine (with the ~2MB tokenizer vocabulary) is loaded ON DEMAND
// the first time you analyze, so the landing page paints instantly. Examples
// are fetched from /examples on click rather than inlined into the bundle.
type Core = typeof import("../core/index.js");
let corePromise: Promise<Core> | null = null;
function loadCore(): Promise<Core> {
  if (!corePromise) corePromise = import("../core/index.js");
  return corePromise;
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const traceEl = $<HTMLTextAreaElement>("#trace");
const runEl = $<HTMLButtonElement>("#run");
const errEl = $<HTMLElement>("#err");
const reportEl = $<HTMLElement>("#report");
const fileEl = $<HTMLInputElement>("#file");

function setError(msg: string) {
  errEl.textContent = msg;
}
function setBusy(busy: boolean, label = "Analyze →") {
  runEl.disabled = busy;
  runEl.textContent = busy ? "Analyzing…" : label;
}

const sevClass: Record<string, string> = { high: "sev-high", medium: "sev-med", low: "sev-low" };
const sevLabel: Record<string, string> = { high: "HIGH", medium: "MEDIUM", low: "LOW" };

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

function findingCard(usd: Core["usd"], f: Finding, i: number): string {
  const dollars =
    f.wastedUSD > 0 || f.wastedTokens > 0
      ? `<div class="waste"><span class="tok">~${f.wastedTokens.toLocaleString()} tok</span><span class="dol">${usd(
          f.wastedUSD
        )}</span></div>`
      : "";
  const evidence = f.evidence?.length
    ? `<ul class="evidence">${f.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`
    : "";
  return `
    <div class="finding ${sevClass[f.severity]}">
      <div class="finding-head">
        <span class="sev">${sevLabel[f.severity]}</span>
        <span class="ftitle">${i + 1}. ${esc(f.title)}</span>
        ${dollars}
      </div>
      <p class="detail">${esc(f.detail)}</p>
      ${evidence}
      <div class="fix"><span>FIX</span> ${esc(f.fix)}</div>
    </div>`;
}

function render(core: Core, report: Report) {
  const usd = core.usd;
  const headline =
    report.savableUSD > 0
      ? `<div class="save">Potential savings <b>${usd(report.savableUSD)}</b> <span>~${report.savablePct.toFixed(
          0
        )}% of this trace</span></div>`
      : `<div class="save clean">No obvious waste found 🎉</div>`;

  // Project one trace to production volume — the "toy → tool" lever.
  const projection =
    report.perCallSavableUSD > 0
      ? `<div class="project">If you run <input id="cpd" type="number" min="1" value="1000" /> calls/day shaped like this →
           <b id="permo">${usd(report.perCallSavableUSD * 1000 * 30)}</b><span>/month saved</span>
           <span class="permo-note">(${usd(report.perCallSavableUSD)}/call × calls/day × 30)</span></div>`
      : "";

  const stats = `
    <div class="stats">
      <div><span>${esc(report.model)}</span><label>model</label></div>
      <div><span>${report.numCalls}</span><label>calls</label></div>
      <div><span>${report.totalInputTokens.toLocaleString()}</span><label>input tok</label></div>
      <div><span>${usd(report.totalUSD)}</span><label>spend (as-is)</label></div>
    </div>`;

  const findings = report.findings.length
    ? report.findings.map((f, i) => findingCard(usd, f, i)).join("")
    : `<p class="empty">Nothing flagged. Your prompts are lean.</p>`;

  const notes = report.notes.length
    ? `<div class="notes">${report.notes.map((n) => `<div>ⓘ ${esc(n)}</div>`).join("")}</div>`
    : "";

  const actions = `<div class="report-actions">
    <button id="copy-fix" class="primary">Copy fix prompt →</button>
    <button id="copy-md" class="ghost">Copy audit as Markdown</button>
    <span class="copied" id="copied"></span>
  </div>`;

  // Teaching state: several detectors (caching, history, duplicate docs) can only
  // fire across MULTIPLE calls. If the user pasted one, tell them how to get more.
  const banner =
    report.numCalls === 1
      ? `<div class="teach">
           <b>You pasted 1 call.</b> The biggest wins — <em>uncached prefixes, uncompacted history, duplicated context</em> — only show up <b>across several calls</b>. Capture a few from one agent run:
           <pre>globalThis.__td ??= [];
const tap = a =&gt; (globalThis.__td.push(a), a);
// wrap your request args:
//   openai.chat.completions.create(tap({ model, messages, tools }))
// after the run, in your console:
//   copy(JSON.stringify(globalThis.__td))   // then paste here
</pre>
         </div>`
      : "";

  reportEl.innerHTML = `${banner}${headline}${projection}${stats}${actions}<div class="findings">${findings}</div>${notes}`;
  reportEl.classList.remove("hidden");
  reportEl.scrollIntoView({ behavior: "smooth", block: "start" });

  const flash = (msg: string) => {
    const c = document.getElementById("copied");
    if (c) {
      c.textContent = msg;
      setTimeout(() => (c.textContent = ""), 1800);
    }
  };
  // Fix pack — paste straight into Claude Code / Cursor to apply the fixes.
  document.getElementById("copy-fix")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(core.renderFixPrompt(report, 1000));
    flash("fix prompt copied → paste into Claude Code / Cursor ✓");
  });
  // Markdown audit — same as `tokendam --format markdown`, for a PR/issue.
  document.getElementById("copy-md")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(core.renderMarkdown(report, undefined, 1000));
    flash("audit copied ✓");
  });

  // Live-update the monthly projection as the user changes calls/day.
  const cpd = document.getElementById("cpd") as HTMLInputElement | null;
  const permo = document.getElementById("permo");
  if (cpd && permo) {
    cpd.addEventListener("input", () => {
      const n = Math.max(0, Number(cpd.value) || 0);
      permo.textContent = usd(report.perCallSavableUSD * n * 30);
    });
  }
}

async function run() {
  setError("");
  const raw = traceEl.value.trim();
  if (!raw) {
    setError("Paste a trace first (or click an example).");
    return;
  }
  // Try JSON first; on failure pass the raw string so normalize() can handle
  // JSONL (one JSON record per line) instead of rejecting an advertised format.
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    input = raw;
  }
  setBusy(true);
  try {
    const core = await loadCore();
    render(core, core.analyze(input));
  } catch (e) {
    setError((e as Error).message);
  } finally {
    setBusy(false);
  }
}

runEl.addEventListener("click", run);
traceEl.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
});

const base = import.meta.env.BASE_URL;
document.querySelectorAll<HTMLButtonElement>("[data-example]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    setError("");
    const file = btn.dataset.example === "sd" ? "sd-tender-radar.json" : "coding-agent.json";
    try {
      const res = await fetch(`${base}examples/${file}`);
      traceEl.value = JSON.stringify(await res.json(), null, 2);
      run();
    } catch {
      setError("Couldn't load the example.");
    }
  });
});

fileEl.addEventListener("change", async () => {
  const file = fileEl.files?.[0];
  if (!file) return;
  traceEl.value = await file.text();
  run();
});
