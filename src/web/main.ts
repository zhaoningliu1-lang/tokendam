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
function setBusy(busy: boolean) {
  runEl.disabled = busy;
  runEl.innerHTML = busy
    ? `analyzing…<span class="cursor"> ▍</span>`
    : `tokendam analyze ./trace.json<span class="cursor">▍</span>`;
}

const sevClass: Record<string, string> = { high: "sev-high", medium: "sev-med", low: "sev-low" };
const sevLabel: Record<string, string> = { high: "HIGH", medium: "MED", low: "LOW" };

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

function findingCard(usd: Core["usd"], f: Finding, _i: number): string {
  const dollars =
    f.wastedUSD > 0 || f.wastedTokens > 0
      ? `<span class="waste"><span class="tok">~${f.wastedTokens.toLocaleString()} tok</span><span class="dol">${usd(
          f.wastedUSD
        )}</span></span>`
      : "";
  const evidence = f.evidence?.length
    ? `<ul class="evidence">${f.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`
    : "";
  return `
    <div class="finding ${sevClass[f.severity]}">
      <div class="finding-bar"></div>
      <div class="finding-body">
        <div class="finding-head">
          <span class="tag">[${sevLabel[f.severity]}]</span>
          <span class="ftitle">${esc(f.title)}</span>
          ${dollars}
        </div>
        <p class="detail">${esc(f.detail)}</p>
        ${evidence}
        <div class="fix"><span>${esc(f.fix)}</span></div>
      </div>
    </div>`;
}

function render(core: Core, report: Report) {
  const usd = core.usd;

  // Command echo + parse line — the report opens like streamed stdout.
  const echo = `<div class="echo"><span class="prompt">~/agent&nbsp;$</span> tokendam analyze ./trace.json</div>
    <div class="echo"><span class="ok">✓</span> parsed ${report.numCalls} call(s) · ${esc(
    report.vendor
  )} · o200k</div>`;

  // Box-drawn summary block.
  const TW = 48;
  const bar = (pct: number) => {
    const n = Math.max(0, Math.min(10, Math.round(pct / 10)));
    return "▇".repeat(n) + "░".repeat(10 - n);
  };
  const line = (label: string, val: string) =>
    ("│  " + (label.padEnd(9) + val)).padEnd(TW - 1) + "│";
  const boxTop = "┌─ summary " + "─".repeat(TW - 12) + "┐";
  const boxBot = "└" + "─".repeat(TW - 2) + "┘";
  const saveVal =
    report.savableUSD > 0
      ? `${bar(report.savablePct)}  ${report.savablePct.toFixed(0)}% · ${usd(report.savableUSD)}`
      : "no obvious waste found";
  const boxText = [
    boxTop,
    line("spend", `${usd(report.totalUSD)} / run`),
    line("savings", saveVal),
    line("input", `${report.totalInputTokens.toLocaleString()} tok`),
    boxBot,
  ].join("\n");
  const sumbox = `<div class="sumbox">${esc(boxText)
    .replace(/\$[\d.,]+/g, (m) => `<span class="dol">${m}</span>`)
    .replace(/▇+/g, (m) => `<span class="pct">${m}</span>`)
    .replace(/(\d+%)/g, (m) => `<span class="pct">${m}</span>`)}</div>`;

  // Projection — the "toy → tool" lever, styled as a command.
  const projection =
    report.perCallSavableUSD > 0
      ? `<div class="project"><span class="prompt">~/agent&nbsp;$</span> tokendam project --calls <input id="cpd" type="number" min="1" value="1000" />/day → <b id="permo">${usd(
          report.perCallSavableUSD * 1000 * 30
        )}</b>/mo saved</div>`
      : "";

  const actions = `<div class="report-actions">
    <button id="copy-fix" class="run-btn">copy fix prompt →</button>
    <button id="copy-md" class="run-btn alt">copy audit (markdown)</button>
    <button id="dl-report" class="run-btn alt">report for your boss (PDF) →</button>
    <span class="copied" id="copied"></span>
  </div>`;

  const findings = report.findings.length
    ? report.findings.map((f, i) => findingCard(usd, f, i)).join("")
    : `<p class="empty"># nothing flagged — your prompts are lean.</p>`;

  const notes = report.notes.length
    ? `<div class="notes">${report.notes.map((n) => `<div># ${esc(n)}</div>`).join("")}</div>`
    : "";

  // Teaching state: caching/history/duplicate waste only shows across MULTIPLE calls.
  const banner =
    report.numCalls === 1
      ? `<div class="teach">
           <b>You pasted 1 call.</b> The biggest wins — <em>uncached prefixes, uncompacted history, duplicated context</em> — only show up <b>across several calls</b>. Capture a few from one run:
           <pre>globalThis.__td ??= [];
const tap = a =&gt; (globalThis.__td.push(a), a);
// wrap your request args:
//   openai.chat.completions.create(tap({ model, messages, tools }))
// then, in your console:
//   copy(JSON.stringify(globalThis.__td))   // paste here
</pre>
         </div>`
      : "";

  // Upsell — this is one trace; TokenDam Cloud watches every PR. The touchpoint
  // that tells free users the paid tier exists.
  const upsell = `<div class="upsell">
    <div class="upsell-text"><b>That's one trace.</b> TokenDam Cloud audits <b>every PR</b> automatically and alerts you the moment token cost regresses — trends, per-agent attribution, auto-fix PRs.</div>
    <a href="/pricing">See Pro →</a>
  </div>`;

  reportEl.innerHTML = `${echo}${banner}${sumbox}${projection}${actions}<div class="findings">${findings}</div>${upsell}${notes}`;
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
  // Paper report — the shareable one-pager an engineer forwards to their manager.
  // Generated fully client-side (nothing uploaded); opens in a new tab so the user
  // can Cmd/Ctrl-P → "Save as PDF". Falls back to a download if popups are blocked.
  document.getElementById("dl-report")?.addEventListener("click", () => {
    const n = Math.max(1, Number((document.getElementById("cpd") as HTMLInputElement | null)?.value) || 1000);
    const html = core.renderOnePager(report, n);
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const w = window.open(url, "_blank");
    if (!w) {
      const a = document.createElement("a");
      a.href = url;
      a.download = "tokendam-report.html";
      a.click();
    }
    flash("report opened — Cmd/Ctrl-P → Save as PDF ✓");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
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
