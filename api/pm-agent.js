// api/pm-agent.js — The Product Manager.
//
// A dev tool lives or dies by building the RIGHT thing. This agent gathers real
// signal from where TokenDam's users actually complain — Hacker News discussion
// on LLM cost, and the repo's own GitHub issues — then asks Claude to turn it
// into a ranked backlog with short specs. It DRAFTS; you decide.
//
// Weekly cron. No-ops gracefully if creds are missing. Never posts anything.

import { authorize, sendEmail, anthropic, emailShell, escapeHtml } from "./_shared.js";

const HN_QUERIES = [
  "LLM token cost",
  "prompt caching",
  "AI agent cost",
  "reduce LLM cost",
];

// Pull recent, popular HN stories/comments touching our problem space.
async function hnSignal() {
  const out = [];
  for (const q of HN_QUERIES) {
    try {
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(
        q
      )}&tags=(story,comment)&numericFilters=points%3E4&hitsPerPage=5`;
      const r = await fetch(url);
      if (!r.ok) continue;
      const d = await r.json();
      for (const h of d.hits || []) {
        const text = (h.title || h.comment_text || h.story_title || "").replace(/<[^>]+>/g, " ");
        if (text.trim().length < 20) continue;
        out.push(`[${q}] (${h.points ?? "?"}pts) ${text.slice(0, 240)}`);
      }
    } catch {
      /* skip this query */
    }
  }
  return out.slice(0, 24);
}

// Optional: open issues from the repo, if GITHUB_REPO="owner/name" is set.
async function githubIssues() {
  const repo = process.env.GITHUB_REPO;
  if (!repo) return [];
  try {
    const headers = { "user-agent": "TokenDam-PM/1.0", accept: "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const r = await fetch(
      `https://api.github.com/repos/${repo}/issues?state=open&sort=updated&per_page=20`,
      { headers }
    );
    if (!r.ok) return [];
    const d = await r.json();
    return (d || [])
      .filter((i) => !i.pull_request)
      .map((i) => `#${i.number} (${i.comments} comments, ${i.reactions?.total_count ?? 0} reax): ${i.title}`);
  } catch {
    return [];
  }
}

const SYSTEM = `You are the Product Manager for TokenDam, a free, zero-upload, in-browser + CLI "linter for LLM token spend" aimed at developers running AI agents in production. It ingests an LLM trace and flags token waste (uncached prefixes, bloated context, redundant tools, uncompacted history, duplicate substrings, reasoning-token waste) with a dollar figure and a fix.

You are ruthless about focus and honesty. This is a small portfolio/vibe project, not a funded company: prefer a few high-leverage, weekend-sized moves over a sprawling roadmap. Distinguish "real demand with evidence" from "nice idea." Never invent user quotes.`;

function buildPrompt(hn, issues) {
  return `Here is this week's raw signal.

HACKER NEWS (LLM-cost discussion, points-filtered):
${hn.length ? hn.map((x) => "- " + x).join("\n") : "(none fetched this week)"}

OUR GITHUB ISSUES:
${issues.length ? issues.map((x) => "- " + x).join("\n") : "(no repo configured or no open issues)"}

Produce a crisp weekly PM brief in markdown:
1. **Signal read** — 2-3 bullets: what devs are actually frustrated by re: token/LLM cost right now.
2. **Ranked backlog (top 5)** — each: title · why-now (tie to a signal or a clear gap) · rough effort (S/M/L) · which user pain it kills. Rank by (leverage ÷ effort).
3. **This week's ONE thing** — the single item to ship next, and why it beats the others.
4. **Watch-outs** — anything that looks like demand but probably isn't, or scope traps to avoid.
Keep it under ~450 words. Be specific to TokenDam, not generic.`;
}

export default async function handler(req, res) {
  const auth = authorize(req);
  if (!auth.ok) return res.status(auth.code).json({ ok: false, reason: auth.reason });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(200).json({ ok: true, skipped: "ANTHROPIC_API_KEY not set — PM agent dormant" });
  }

  const [hn, issues] = await Promise.all([hnSignal(), githubIssues()]);
  let brief;
  try {
    brief = await anthropic({ system: SYSTEM, user: buildPrompt(hn, issues), maxTokens: 1800 });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e).slice(0, 300) });
  }
  if (!brief) return res.status(200).json({ ok: true, skipped: "no LLM output" });

  const bodyHtml = `${briefToHtml(brief)}
    <details style="margin-top:18px"><summary style="cursor:pointer;color:#888;font-size:12px">signal used (${hn.length} HN + ${issues.length} issues)</summary>
    <ul style="font-size:11px;color:#999">${[...hn, ...issues].map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul></details>`;

  const email = await sendEmail({
    subject: "🧭 TokenDam PM — weekly backlog & the one thing to ship",
    html: emailShell("Product Manager — weekly brief", bodyHtml),
    text: brief,
  });

  return res.status(200).json({ ok: true, emailed: !email.skipped, hn: hn.length, issues: issues.length });
}

function briefToHtml(md) {
  return escapeHtml(md)
    .replace(/^#{1,3} (.*)$/gm, "<h3 style='margin:14px 0 6px'>$1</h3>")
    .replace(/^\s*\d+\. (.*)$/gm, "<div style='margin:4px 0'><b>$1</b></div>")
    .replace(/^\s*[-*] (.*)$/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]*?<\/li>)/g, "<ul style='margin:6px 0'>$1</ul>")
    .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
    .replace(/\n{2,}/g, "<br><br>");
}
