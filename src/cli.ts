#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { analyze } from "./core/analyze.js";
import { renderText } from "./core/format.js";
import { evaluateCi, renderMarkdown, renderGithub, DEFAULT_CI, type CiConfig } from "./core/ci.js";
import { renderFixPrompt, renderFixPlan } from "./core/fixPrompt.js";
import { diffReports, renderDiffText } from "./core/diff.js";
import { renderOnePager } from "./core/onePager.js";
import { applyFixes } from "./core/fix.js";
import type { Severity } from "./core/types.js";
import pc from "picocolors";

const here = dirname(fileURLToPath(import.meta.url));

const HELP = `${pc.bold("tokendam")} — a linter for your LLM token spend

Usage:
  tokendam init                    Scaffold .tokendam.json + traces/ + CI workflow
  tokendam mcp                     Run as an MCP server (agents self-optimize their own token use)
  tokendam <trace.json>            Analyze a trace (OpenAI/Anthropic/LangSmith/…)
  tokendam diff <before> <after>   Deterministic before/after cost regression (CI)
  tokendam fix <trace.json> [--apply]  Apply the safe prompt-cache fix in place (.bak kept)
  tokendam --example sd|agent      Run a built-in demo
  cat trace.json | tokendam        Read a trace from stdin (JSON or JSONL)

Capture a trace with the helper:  import { tap, writeTrace } from "tokendam/capture"

Output:
  --json                           Emit the raw Report as JSON
  --format human|markdown|github|html   Report format (html = shareable one-pager → PDF)
  --fix-prompt                     Emit a fix pack to paste into your coding agent
  --calls-per-day <n>              Project savings to N calls/day (default 1000)

CI gate (fails the build when waste exceeds budget):
  --ci                             Exit non-zero if over budget
  --max-waste <pct>                Budget: max % of spend recoverable (default 25)
  --max-waste-per-call <usd>       Budget: max recoverable $ per call
  --fail-on high|medium|low        Fail if any finding at/above this severity
  --pr-comment                     Post the audit + fix pack as a PR comment (GitHub Actions)
  (or put maxWastePct / maxWasteUSDPerCall / failOnSeverity in .tokendam.json)

Nothing is uploaded. Analysis runs locally.`;

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function loadExample(name: string): string {
  const file = name.startsWith("sd") ? "sd-tender-radar.json" : "coding-agent.json";
  for (const c of [join(here, "..", "examples", file), join(here, "..", "..", "examples", file)]) {
    try {
      return readFileSync(c, "utf8");
    } catch {
      /* try next */
    }
  }
  throw new Error(`Example not found: ${file}`);
}

function loadConfig(): CiConfig {
  try {
    const raw = readFileSync(join(process.cwd(), ".tokendam.json"), "utf8");
    const c = JSON.parse(raw);
    return {
      maxWastePct: c.maxWastePct,
      maxWasteUSDPerCall: c.maxWasteUSDPerCall,
      failOnSeverity: c.failOnSeverity,
    };
  } catch {
    return {};
  }
}

function flagVal(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

/** Flatten one file/stdin blob (JSON object, array, {calls:[]}, or JSONL) into
 *  raw call elements. */
function toElements(raw: string): unknown[] {
  const s = raw.trim();
  try {
    const p: any = JSON.parse(s);
    if (Array.isArray(p)) return p;
    if (p && typeof p === "object") {
      return p.calls ?? p.requests ?? p.trace ?? p.data ?? [p];
    }
    return [p];
  } catch {
    // JSONL: one JSON record per line.
    return s
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter((x) => x !== null);
  }
}

const GH_ACTION = `name: token-budget
on: [pull_request]
permissions:
  contents: read
  pull-requests: write   # lets tokendam post the audit + fix pack as a PR comment
jobs:
  tokendam:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      # Your test run should write representative request payloads to traces/*.json
      # (see the tokendam/capture helper, or log JSON.stringify of your request args).
      - run: npx tokendam --ci --pr-comment traces/*.json
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;

const CAPTURE_SNIPPET = `  // Capture a trace with the tokendam/capture helper:
  //   import { tap, writeTrace } from "tokendam/capture";
  //   await openai.chat.completions.create(tap({ model, messages, tools }));
  //   await writeTrace("traces/agent.json");   // then: tokendam traces/agent.json
  // Or with zero SDK changes, log your request args:
  //   console.log(JSON.stringify({ model, messages, tools }));`;

function doInit() {
  const cwd = process.cwd();
  const write = (p: string, content: string) => {
    if (existsSync(p)) {
      console.log(pc.dim(`  exists   ${p}`));
    } else {
      writeFileSync(p, content);
      console.log(pc.green(`  created  ${p}`));
    }
  };
  console.log(pc.bold("tokendam init") + " — scaffolding a token budget + CI gate\n");
  write(join(cwd, ".tokendam.json"), JSON.stringify({ maxWastePct: 15, failOnSeverity: ["high"] }, null, 2) + "\n");
  mkdirSync(join(cwd, "traces"), { recursive: true });
  write(join(cwd, "traces", ".gitkeep"), "");
  mkdirSync(join(cwd, ".github", "workflows"), { recursive: true });
  write(join(cwd, ".github", "workflows", "tokendam.yml"), GH_ACTION);
  console.log("\nNext: capture a trace, then run " + pc.bold("tokendam traces/agent.json") + "\n");
  console.log(CAPTURE_SNIPPET);
}

/** Post/update a PR comment when running in a GitHub Actions pull_request job.
 *  No-ops gracefully outside CI. Upserts by an HTML marker so it doesn't spam. */
async function ghPrComment(body: string): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return "pr-comment: skipped (no GITHUB_TOKEN / GITHUB_REPOSITORY)";
  let pr: string | number | undefined;
  try {
    if (process.env.GITHUB_EVENT_PATH) {
      const evt = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
      pr = evt.pull_request?.number ?? evt.number;
    }
  } catch {
    /* ignore */
  }
  if (!pr) {
    const m = (process.env.GITHUB_REF || "").match(/refs\/pull\/(\d+)/);
    if (m) pr = m[1];
  }
  if (!pr) return "pr-comment: skipped (not a pull_request event)";
  const base = `https://api.github.com/repos/${repo}`;
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "user-agent": "tokendam",
    "content-type": "application/json",
  };
  try {
    const list = await (await fetch(`${base}/issues/${pr}/comments`, { headers })).json();
    const existing = Array.isArray(list)
      ? list.find((c: any) => typeof c.body === "string" && c.body.includes("<!-- tokendam -->"))
      : null;
    if (existing) {
      await fetch(`${base}/issues/comments/${existing.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ body }),
      });
      return "pr-comment: updated";
    }
    await fetch(`${base}/issues/${pr}/comments`, {
      method: "POST",
      headers,
      body: JSON.stringify({ body }),
    });
    return "pr-comment: posted";
  } catch (e) {
    return "pr-comment: failed — " + String(e).slice(0, 140);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    console.log(HELP);
    return;
  }
  if (args[0] === "init") {
    doInit();
    return;
  }
  if (args[0] === "mcp") {
    const { startMcp } = await import("./mcp.js");
    startMcp();
    return;
  }
  if (args[0] === "diff") {
    const files = args.slice(1).filter((a) => !a.startsWith("--"));
    if (files.length < 2) {
      console.error(pc.red("Usage: tokendam diff <before.json> <after.json> [--max-regression <pct>]"));
      process.exit(2);
    }
    const load = (p: string) => {
      const raw = readFileSync(p, "utf8");
      try {
        return analyze(JSON.parse(raw));
      } catch {
        return analyze(raw);
      }
    };
    const before = load(files[0]);
    const after = load(files[1]);
    const tol = Number(flagVal(args, "--max-regression"));
    const result = diffReports(before, after, Number.isFinite(tol) ? tol : 1);
    console.log(
      renderDiffText(before, after, result)
        .replace(/REGRESSED|✗.*/g, (m) => pc.red(m))
        .replace(/IMPROVED|✓.*/g, (m) => pc.green(m))
    );
    process.exit(result.exitCode);
  }

  // --- fix: actually APPLY the safe, behavior-preserving fixes (prompt caching) ---
  // Dry-run by default (shows the diff); --apply writes the fixed files in place
  // (a .bak copy is kept). Only touches the mechanical fix; behavior-changing
  // advice still lives in the fix pack.
  if (args[0] === "fix") {
    const apply = args.includes("--apply");
    const files = args.slice(1).filter((a) => !a.startsWith("--"));
    if (files.length === 0) {
      console.error(pc.red("Usage: tokendam fix <trace-or-request.json ...> [--apply]"));
      process.exit(2);
    }
    let anyChange = false;
    for (const file of files) {
      const raw = readFileSync(file, "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        console.error(pc.yellow(`  skip ${file} (not a single JSON document)`));
        continue;
      }
      const wasArray = Array.isArray(parsed);
      const container =
        !wasArray && parsed && typeof parsed === "object" && (parsed as any).calls ? (parsed as any).calls : parsed;
      const { fixed, result } = applyFixes(container);
      if (!result.changed) {
        console.log(pc.dim(`  ${file}: nothing to fix (already cached or no static prefix)`));
        continue;
      }
      anyChange = true;
      console.log(pc.bold(file));
      for (const c of result.changes) console.log("  " + pc.green("✓ ") + c);
      if (apply) {
        writeFileSync(file + ".bak", raw);
        let out: unknown = fixed;
        if (!wasArray && parsed && typeof parsed === "object" && (parsed as any).calls)
          out = { ...(parsed as any), calls: fixed };
        else if (!wasArray) out = fixed[0];
        writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
        console.log("  " + pc.green(`wrote ${file}`) + pc.dim(` (backup: ${file}.bak)`));
      }
    }
    if (!apply && anyChange)
      console.log(pc.dim("\nDry run. Re-run with --apply to write these changes (a .bak is kept)."));
    console.log(
      pc.dim(
        "\nNote: this applies prompt caching to request payloads. If your prompts are built in source code, paste `tokendam --fix-prompt` into your coding agent instead."
      )
    );
    process.exit(anyChange ? 0 : 0);
  }

  const asJson = args.includes("--json");
  const ciMode = args.includes("--ci");
  const format = flagVal(args, "--format") ?? (ciMode ? "github" : "human");
  const callsPerDay = Number(flagVal(args, "--calls-per-day")) || 1000;

  // Flag values (by INDEX, so a trace file named like a flag value isn't eaten)
  // must not be treated as the input path.
  const consumedIdx = new Set<number>();
  for (const f of ["--format", "--calls-per-day", "--max-waste", "--max-waste-per-call", "--fail-on", "--example"]) {
    const i = args.indexOf(f);
    if (i !== -1) consumedIdx.add(i + 1);
  }
  const rest = args.filter((a, idx) => !a.startsWith("--") && !consumedIdx.has(idx));

  // Assemble the input. Multiple files/globs (e.g. `traces/*.json` expanded by
  // the shell) are aggregated into ONE trace — otherwise a CI gate would only
  // see the first file and silently pass (fail open).
  let input: unknown;
  const exIdx = args.indexOf("--example");
  if (exIdx !== -1) {
    input = toElements(loadExample(args[exIdx + 1] ?? "agent"));
  } else if (rest.length > 0) {
    input = rest.flatMap((f) => toElements(readFileSync(f, "utf8")));
  } else {
    const stdin = readStdin();
    if (!stdin.trim()) {
      console.log(HELP);
      process.exit(1);
    }
    input = toElements(stdin);
  }
  if (Array.isArray(input) && input.length === 0) {
    console.error(pc.red("No LLM calls found in the input."));
    process.exit(2);
  }

  let report;
  try {
    report = analyze(input);
  } catch (e) {
    console.error(pc.red((e as Error).message));
    process.exit(2);
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // --- Fix pack: a prompt to paste into your coding agent ---
  if (args.includes("--fix-prompt")) {
    if (format === "json") console.log(JSON.stringify(renderFixPlan(report), null, 2));
    else console.log(renderFixPrompt(report, callsPerDay));
    return;
  }

  // --- CI gate ---
  if (ciMode) {
    const cfg: CiConfig = { ...DEFAULT_CI, ...loadConfig() };
    // A CI gate must FAIL SAFE: bad flags must error out, never silently pass.
    const numArg = (name: string, cur?: number): number | undefined => {
      const v = flagVal(args, name);
      if (v === undefined) return cur;
      const n = Number(v);
      if (!Number.isFinite(n)) {
        console.error(pc.red(`${name} needs a number, got "${v}"`));
        process.exit(2);
      }
      return n;
    };
    cfg.maxWastePct = numArg("--max-waste", cfg.maxWastePct);
    cfg.maxWasteUSDPerCall = numArg("--max-waste-per-call", cfg.maxWasteUSDPerCall);
    const fo = flagVal(args, "--fail-on");
    if (fo !== undefined) {
      const order = ["high", "medium", "low"] as const;
      const idx = order.indexOf(fo as (typeof order)[number]);
      if (idx === -1) {
        console.error(pc.red(`--fail-on must be high|medium|low, got "${fo}"`));
        process.exit(2);
      }
      cfg.failOnSeverity = order.slice(0, idx + 1) as Severity[];
    }
    const result = evaluateCi(report, cfg);
    if (format === "markdown") console.log(renderMarkdown(report, result, callsPerDay));
    else if (format === "json") console.log(JSON.stringify({ report, ci: result }, null, 2));
    else console.log(renderGithub(report, result));
    // Optionally post the audit + fix pack as a PR comment (GitHub Actions).
    if (args.includes("--pr-comment")) {
      const body =
        "<!-- tokendam -->\n" +
        renderMarkdown(report, result, callsPerDay) +
        "\n\n<details><summary>🛠️ fix pack — paste into your coding agent</summary>\n\n```\n" +
        renderFixPrompt(report, callsPerDay) +
        "\n```\n</details>\n";
      console.error(await ghPrComment(body));
    }
    process.exit(result.exitCode);
  }

  // --- Normal report ---
  if (format === "html") {
    // Shareable, print-to-PDF one-pager for non-engineers (send it to the boss).
    console.log(renderOnePager(report, callsPerDay));
    return;
  }
  if (format === "markdown") {
    console.log(renderMarkdown(report, undefined, callsPerDay));
    return;
  }
  const text = renderText(report, callsPerDay)
    .replace(/\[HIGH\]/g, pc.red("[HIGH]"))
    .replace(/\[MED\]/g, pc.yellow("[MED]"))
    .replace(/\[LOW\]/g, pc.dim("[LOW]"))
    .replace(/▶ Potential savings: (\S+)/, (_m, p) => `▶ Potential savings: ${pc.green(pc.bold(p))}`);
  console.log(text);
}

main().catch((e) => {
  console.error(pc.red(String(e?.message ?? e)));
  process.exit(2);
});
