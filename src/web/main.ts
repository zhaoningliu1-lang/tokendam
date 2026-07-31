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

// --- Anonymous, privacy-preserving usage signal (see /privacy) -------------
// PROD only. Two things, BOTH content-free: (1) Vercel Web Analytics — cookieless
// page visits/referrers; (2) a ping to /api/hit when an analysis actually runs.
// NEITHER sends your trace or prompts — those are analyzed entirely in this tab.
type TdSource = "paste" | "example" | "file";
const PROD = /(^|\.)tokendam\.dev$/.test(location.hostname) || location.hostname.endsWith(".vercel.app");
if (PROD) {
  const s = document.createElement("script");
  s.defer = true;
  s.src = "/_vercel/insights/script.js";
  document.head.appendChild(s);
}
function ping(source: TdSource) {
  if (!PROD) return;
  try {
    const body = new Blob([JSON.stringify({ source })], { type: "application/json" });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/hit", body);
    else void fetch("/api/hit", { method: "POST", body, keepalive: true }).catch(() => {});
  } catch {
    /* usage counting must never affect the user */
  }
}

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

// Copy to clipboard with a fallback for http:// origins and older browsers where
// navigator.clipboard is unavailable or throws. Returns false if every path fails
// so the caller can flash an error instead of failing silently.
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to execCommand */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
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
  )}</div>`;

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
    line(
      "effective",
      report.wasteRatePct > 0
        ? `${report.wasteRatePct.toFixed(0)}% avoidable/repriceable · ${(100 - report.wasteRatePct).toFixed(0)}% essential`
        : "all working"
    ),
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
        )}</b>/mo saved</div>
      <div class="project-hint"># enter YOUR real calls/day (ask your engineer or check your provider dashboard). The <b>${report.savablePct.toFixed(
        0
      )}% of spend</b> above doesn't depend on volume — that's your true waste rate.</div>`
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

  // Per-agent cost tree — only for traces that carried agent identity.
  const byAgentBlock = report.byAgent?.length
    ? `<div style="margin:14px 0;border:1px solid #23262e;border-radius:10px;padding:12px 14px;background:rgba(255,255,255,.02)">
        <div style="font:600 12px/1.4 'JetBrains Mono',ui-monospace,monospace;color:#8b909b;margin-bottom:9px"># cost by agent — where the spend goes</div>
        ${report.byAgent
          .map((a) => {
            const w = Math.max(4, Math.min(100, a.pctOfSpend));
            return `<div style="display:flex;align-items:center;gap:10px;margin:5px 0;font:500 13px 'JetBrains Mono',ui-monospace,monospace">
              <span style="width:38px;text-align:right;color:#5eead4">${a.pctOfSpend.toFixed(0)}%</span>
              <span style="flex:1;position:relative;height:8px;background:#1a1d23;border-radius:4px;overflow:hidden"><span style="position:absolute;top:0;left:0;bottom:0;width:${w}%;background:linear-gradient(90deg,#5eead4,#2f6f65)"></span></span>
              <span style="min-width:110px;color:#e6e8ec;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.id)}</span>
              <span class="dol">${usd(a.usd)}</span>
              <span style="color:#565c68;font-size:11px;white-space:nowrap">${a.calls}× · ${a.tokens.toLocaleString()} tok</span>
            </div>`;
          })
          .join("")}
      </div>`
    : "";

  reportEl.innerHTML = `${echo}${banner}${sumbox}${projection}${byAgentBlock}${actions}<div class="findings">${findings}</div>${upsell}${notes}`;
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
    const ok = await copyText(core.renderFixPrompt(report, 1000));
    flash(ok ? "fix prompt copied → paste into Claude Code / Cursor ✓" : "couldn't copy — select the text and copy manually");
  });
  // Markdown audit — same as `tokendam --format markdown`, for a PR/issue.
  document.getElementById("copy-md")?.addEventListener("click", async () => {
    const ok = await copyText(core.renderMarkdown(report, undefined, 1000));
    flash(ok ? "audit copied ✓" : "couldn't copy — select the text and copy manually");
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
      const n = Math.max(1, Number(cpd.value) || 1);
      permo.textContent = usd(report.perCallSavableUSD * n * 30);
    });
  }
}

async function run(source: TdSource = "paste") {
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
    ping(source);
  } catch (e) {
    setError(`Couldn't read that trace — ${(e as Error).message}. Check it's valid JSON (or click an example).`);
  } finally {
    setBusy(false);
  }
}

runEl.addEventListener("click", () => run("paste"));
traceEl.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run("paste");
});

// "Not a developer?" — copy the hand-off note to email an engineer.
document.getElementById("copy-fwd")?.addEventListener("click", async () => {
  const note = document.getElementById("fwd-note")?.textContent || "";
  const ok = await copyText(note);
  const btn = document.getElementById("copy-fwd");
  if (btn) {
    const prev = btn.textContent;
    btn.textContent = ok ? "copied ✓ — paste into an email" : "select the text above and copy manually";
    setTimeout(() => (btn.textContent = prev), 2200);
  }
});

const base = import.meta.env.BASE_URL;
document.querySelectorAll<HTMLButtonElement>("[data-example]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    setError("");
    const file = btn.dataset.example === "sd" ? "sd-tender-radar.json" : "coding-agent.json";
    try {
      const res = await fetch(`${base}examples/${file}`);
      traceEl.value = JSON.stringify(await res.json(), null, 2);
      run("example");
    } catch {
      setError("Couldn't load the example.");
    }
  });
});

fileEl.addEventListener("change", async () => {
  const file = fileEl.files?.[0];
  if (!file) return;
  traceEl.value = await file.text();
  run("file");
});
