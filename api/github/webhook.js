// TokenDam Cloud — hosted GitHub App webhook.
//
// On every pull request, our server fetches the repo's committed trace files,
// runs the TokenDam engine, and posts (or updates) a single audit comment with
// the $/month waste + fix pack. This is the PAID tier's core value: zero setup
// for the customer (vs the free tier where they wire their own GitHub Action).
//
// Uses the SAME analysis engine as the CLI/web (imported from the built core).

import { verifySignature, installationToken, gh } from "./_gh.js";
import { analyze, renderMarkdown, renderFixPrompt } from "../../dist/core/index.js";

const MARKER = "<!-- tokendam-cloud -->";
const TRACE_DIR = process.env.TOKENDAM_TRACE_DIR || "traces";

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
    const body =
      `${MARKER}\n` +
      renderMarkdown(report, undefined, 1000) +
      "\n\n<details><summary>🛠️ fix pack — paste into your coding agent</summary>\n\n```\n" +
      renderFixPrompt(report, 1000) +
      "\n```\n</details>\n\n<sub>TokenDam Cloud · analyzed on our runner · <a href=\"https://tokendam.dev/pricing\">manage</a></sub>";
    await upsertComment(token, owner, name, pr, body);

    return res.status(200).json({ ok: true, calls: report.numCalls, savableUSD: report.savableUSD });
  } catch (e) {
    return res.status(500).json({ error: String(e).slice(0, 300) });
  }
}
