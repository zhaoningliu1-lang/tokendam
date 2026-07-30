// TokenDam Cloud — hosted GitHub App webhook.
//
// On every pull request, our server fetches the repo's committed trace files,
// runs the TokenDam engine, and posts (or updates) a single audit comment with
// the $/month waste + fix pack. This is the PAID tier's core value: zero setup
// for the customer (vs the free tier where they wire their own GitHub Action).
//
// Uses the SAME analysis engine as the CLI/web (imported from the built core).

import { verifySignature, installationToken, gh } from "./_gh.js";
import { isPro } from "./_pro.js";
import { pushAudit } from "../_store.js";
import { analyze, renderMarkdown, renderFixPrompt, applyFixes } from "../../dist/core/index.js";

const MARKER = "<!-- tokendam-cloud -->";
const TRACE_DIR = process.env.TOKENDAM_TRACE_DIR || "traces";
const CALLS_PER_DAY = 1000;

function money(n) {
  return n >= 1 ? `$${n.toFixed(0)}` : `$${n.toFixed(n >= 0.1 ? 2 : 3)}`;
}

// Free accounts get a one-line preview with the headline dollar number + an upgrade
// CTA — enough to prove value, not the full breakdown/fix pack (that's Pro).
function teaserComment(report, monthlyUSD) {
  const issues = report.findings.length;
  return (
    `${MARKER}\n### 🧱 TokenDam · free preview\n` +
    `This PR's traces waste **~${money(monthlyUSD)}/month** (~${report.savablePct.toFixed(0)}% of spend, at ${CALLS_PER_DAY.toLocaleString()} calls/day) — **${issues} issue${issues === 1 ? "" : "s"}** found.\n\n` +
    `🔒 The per-finding breakdown, the copy-paste **fix pack**, and your repo's **cost trend** are TokenDam Pro.\n` +
    `**[Unlock the full audit → tokendam.dev/pricing](https://tokendam.dev/pricing)**\n\n` +
    `<sub>Free preview · one line per PR · no data leaves GitHub + our runner.</sub>`
  );
}

function fullComment(report) {
  return (
    `${MARKER}\n` +
    renderMarkdown(report, undefined, CALLS_PER_DAY) +
    "\n\n<details><summary>🛠️ fix pack — paste into your coding agent</summary>\n\n```\n" +
    renderFixPrompt(report, CALLS_PER_DAY) +
    "\n```\n</details>\n\n" +
    `<sub>TokenDam Cloud · <a href="https://tokendam.dev/dashboard">cost trend</a> · <a href="https://tokendam.dev/pricing">manage</a></sub>`
  );
}

async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString("utf8");
}

async function collectTraces(token, owner, name, sha) {
  let items;
  try {
    items = await gh(token, "GET", `/repos/${owner}/${name}/contents/${TRACE_DIR}?ref=${sha}`);
  } catch {
    return [];
  }
  const elements = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it.name.endsWith(".json")) continue;
    try {
      const file = await gh(token, "GET", `/repos/${owner}/${name}/contents/${it.path}?ref=${sha}`);
      const content = Buffer.from(file.content, "base64").toString("utf8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) elements.push(...parsed);
      else if (parsed && parsed.calls) elements.push(...parsed.calls);
      else if (parsed) elements.push(parsed);
    } catch {
      /* skip unreadable/invalid file */
    }
  }
  return elements;
}

// Per-file variant of collectTraces — keeps path + blob sha so we can rewrite
// each file in place when opening the auto-fix PR.
async function collectTraceFiles(token, owner, name, sha) {
  let items;
  try {
    items = await gh(token, "GET", `/repos/${owner}/${name}/contents/${TRACE_DIR}?ref=${sha}`);
  } catch {
    return [];
  }
  const files = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it.name.endsWith(".json")) continue;
    try {
      const file = await gh(token, "GET", `/repos/${owner}/${name}/contents/${it.path}?ref=${sha}`);
      const content = Buffer.from(file.content, "base64").toString("utf8");
      files.push({ path: it.path, sha: file.sha, parsed: JSON.parse(content) });
    } catch {
      /* skip unreadable */
    }
  }
  return files;
}

// Open (or refresh) a PR that APPLIES the safe prompt-cache fix to the repo's
// trace/request files — TokenDam acting, not just advising. Best-effort: any
// failure returns null and the audit comment still posts. Branches off the PR
// head and targets the PR's own branch, so merging it updates this PR.
async function openFixPr(token, owner, name, pr, headSha, headRef, monthlyUSD) {
  const files = await collectTraceFiles(token, owner, name, headSha);
  const edits = [];
  for (const f of files) {
    const container = Array.isArray(f.parsed) ? f.parsed : f.parsed?.calls ? f.parsed.calls : f.parsed;
    const { fixed, result } = applyFixes(container);
    if (!result.changed) continue;
    let out = fixed;
    if (!Array.isArray(f.parsed) && f.parsed?.calls) out = { ...f.parsed, calls: fixed };
    else if (!Array.isArray(f.parsed)) out = fixed[0];
    edits.push({ path: f.path, sha: f.sha, content: JSON.stringify(out, null, 2) + "\n" });
  }
  if (!edits.length) return null;

  const branch = `tokendam/cache-fix-pr${pr}`;
  // Create the branch off the PR head (delete a stale one first so re-runs are clean).
  try {
    await gh(token, "DELETE", `/repos/${owner}/${name}/git/refs/heads/${branch}`);
  } catch {
    /* no stale branch */
  }
  await gh(token, "POST", `/repos/${owner}/${name}/git/refs`, { ref: `refs/heads/${branch}`, sha: headSha });

  for (const e of edits) {
    await gh(token, "PUT", `/repos/${owner}/${name}/contents/${e.path}`, {
      message: `TokenDam: add prompt-cache breakpoint to ${e.path}`,
      content: Buffer.from(e.content, "utf8").toString("base64"),
      sha: e.sha,
      branch,
    });
  }

  const existing = await gh(token, "GET", `/repos/${owner}/${name}/pulls?head=${owner}:${branch}&state=open`).catch(() => []);
  if (Array.isArray(existing) && existing.length) return existing[0].html_url;

  const created = await gh(token, "POST", `/repos/${owner}/${name}/pulls`, {
    title: `🧱 TokenDam: add prompt-cache breakpoints (est. ~${money(monthlyUSD)}/mo)`,
    head: branch,
    base: headRef,
    body:
      `TokenDam applied the one **behavior-preserving** fix it can apply automatically: a prompt-cache breakpoint on the static prefix of ${edits.length} request file(s). Prompt caching is transparent to the model — outputs are identical — so this is safe to merge.\n\n` +
      `> **Note:** these are the request payloads TokenDam analyzed. If they're captured fixtures, mirror this same \`cache_control\` change into the code that builds your requests. Behavior-changing optimizations (trimming history, pruning tools) stay in the fix pack on the PR — TokenDam never applies those for you.\n\n` +
      `<sub>Opened by TokenDam Cloud · <a href="https://tokendam.dev/pricing">manage</a></sub>`,
  });
  return created?.html_url || null;
}

async function upsertComment(token, owner, name, pr, body) {
  const comments = await gh(token, "GET", `/repos/${owner}/${name}/issues/${pr}/comments`);
  const existing = (comments || []).find((c) => typeof c.body === "string" && c.body.includes(MARKER));
  if (existing)
    return gh(token, "PATCH", `/repos/${owner}/${name}/issues/comments/${existing.id}`, { body });
  return gh(token, "POST", `/repos/${owner}/${name}/issues/${pr}/comments`, { body });
}

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(200).json({ ok: true, service: "tokendam-cloud github webhook" });

  const raw = await readRaw(req);
  if (!verifySignature(raw, req.headers["x-hub-signature-256"]))
    return res.status(401).json({ error: "bad signature" });

  const event = req.headers["x-github-event"];
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: "bad json" });
  }

  if (event === "ping") return res.status(200).json({ ok: true, pong: true });
  if (event !== "pull_request")
    return res.status(200).json({ ok: true, ignored: event });
  if (!["opened", "synchronize", "reopened"].includes(payload.action))
    return res.status(200).json({ ok: true, ignored: payload.action });

  const owner = payload.repository.owner.login;
  const name = payload.repository.name;
  const pr = payload.pull_request.number;
  const sha = payload.pull_request.head.sha;
  const installationId = payload.installation?.id;
  if (!installationId) return res.status(200).json({ ok: true, note: "no installation" });

  try {
    const token = await installationToken(installationId);
    const trace = await collectTraces(token, owner, name, sha);

    if (!trace.length) {
      await upsertComment(
        token,
        owner,
        name,
        pr,
        `${MARKER}\n### 🧱 TokenDam\nNo traces found in \`${TRACE_DIR}/\`. Commit a few representative request payloads (see the \`tokendam/capture\` helper) and I'll audit token cost on every PR — with a $/month projection and a fix pack.`
      );
      return res.status(200).json({ ok: true, note: "no traces" });
    }

    const report = analyze(trace);
    const monthlyUSD = report.perCallSavableUSD * CALLS_PER_DAY * 30;
    const pro = await isPro(owner);

    // Record the audit for the cost-trend dashboard (no-op if KV unconfigured).
    try {
      await pushAudit(`${owner}/${name}`, {
        ts: new Date().toISOString(),
        sha: String(sha).slice(0, 7),
        pr,
        pro,
        numCalls: report.numCalls,
        totalUSD: report.totalUSD,
        savableUSD: report.savableUSD,
        savablePct: report.savablePct,
        monthlyUSD,
        issues: report.findings.length,
      });
    } catch {
      /* trend recording is best-effort; never block the PR comment */
    }

    // Pro: TokenDam doesn't just advise — it opens a PR applying the safe fix.
    // Best-effort; a failure here never blocks the audit comment.
    let fixPrUrl = null;
    if (pro && report.findings.length) {
      try {
        fixPrUrl = await openFixPr(
          token,
          owner,
          name,
          pr,
          sha,
          payload.pull_request.head.ref,
          monthlyUSD
        );
      } catch (e) {
        console.error("openFixPr failed:", String(e).slice(0, 200));
      }
    }

    let body = pro ? fullComment(report) : teaserComment(report, monthlyUSD);
    if (fixPrUrl) body = body.replace(MARKER, `${MARKER}\n> 🛠️ **Auto-fix ready:** I opened [a PR applying the prompt-cache fix](${fixPrUrl}) — review & merge.\n`);
    await upsertComment(token, owner, name, pr, body);

    return res.status(200).json({ ok: true, pro, calls: report.numCalls, savableUSD: report.savableUSD });
  } catch (e) {
    return res.status(500).json({ error: String(e).slice(0, 300) });
  }
}
