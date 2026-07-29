// TokenDam Cloud — hosted GitHub App webhook.
//
// On every pull request, our server fetches the repo's committed trace files,
// runs the TokenDam engine, and posts (or updates) a single audit comment with
// the $/month waste + fix pack. This is the PAID tier's core value: zero setup
// for the customer (vs the free tier where they wire their own GitHub Action).
//
// Uses the SAME analysis engine as the CLI/web (imported from the built core).

import { verifySignature, installationToken, gh } from "./_gh.js";
import { isProAccount } from "./_pro.js";
import { pushAudit } from "../_store.js";
import { analyze, renderMarkdown, renderFixPrompt } from "../../dist/core/index.js";

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
    const pro = isProAccount(owner);

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

    const body = pro ? fullComment(report) : teaserComment(report, monthlyUSD);
    await upsertComment(token, owner, name, pr, body);

    return res.status(200).json({ ok: true, pro, calls: report.numCalls, savableUSD: report.savableUSD });
  } catch (e) {
    return res.status(500).json({ error: String(e).slice(0, 300) });
  }
}
