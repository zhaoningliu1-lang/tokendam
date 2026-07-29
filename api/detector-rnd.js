// api/detector-rnd.js — The Detector R&D scientist.
//
// For TokenDam to keep up in a fast-moving, autonomous-agent world, its set of
// waste detectors must keep GROWING. This agent is the self-evolution organ: it
// scans what's new in LLM efficiency (papers, provider features, community pain)
// and proposes concrete NEW detectors — trigger heuristic, savings formula, fix
// text — that a human can approve into the codebase.
//
// It DRAFTS proposals; it never writes code or ships on its own (the approve gate
// is the alignment guardrail — autonomous discovery, human-approved evolution).
// Weekly cron. Graceful no-op without creds.

import { authorize, sendEmail, anthropic, emailShell, escapeHtml } from "./_shared.js";

// The 7 detectors we already have — so the scientist proposes NEW ground, not dupes.
const HAVE = [
  "unused-cache (static prefix resent without caching)",
  "bloated-context (oversized page/file/API dumps)",
  "redundant-tools (tool schemas defined but never called)",
  "uncompacted-history (growing agent history resent每turn)",
  "duplicate-substring (same doc pasted twice in a call)",
  "reasoning-token-waste (uncontrolled hidden reasoning on simple tasks)",
  "model-overkill (flagship model on a simple task → cheaper sibling)",
];

async function hnSignal() {
  const out = [];
  for (const q of ["LLM token cost", "prompt caching", "agent memory cost", "context compression"]) {
    try {
      const r = await fetch(
        `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=(story,comment)&numericFilters=points%3E5&hitsPerPage=4`
      );
      if (!r.ok) continue;
      const d = await r.json();
      for (const h of d.hits || []) {
        const t = (h.title || h.comment_text || "").replace(/<[^>]+>/g, " ").trim();
        if (t.length > 25) out.push(`[${q}] ${t.slice(0, 200)}`);
      }
    } catch {
      /* skip */
    }
  }
  return out.slice(0, 18);
}

const SYSTEM = `You are the Detector R&D scientist for TokenDam, a deterministic LLM token-waste linter. Your job: propose NEW, concretely-implementable waste detectors that would run over a normalized trace (calls[], each with system/messages/tools, token counts, and usage). You are rigorous and honest — a detector is only worth adding if (a) the waste is real and common, (b) it can be detected with a defensible heuristic and priced conservatively, and (c) it produces few false positives. Prefer measurable, deterministic signals over vibes. Never propose a runtime proxy/router (out of scope by design). Do not duplicate existing detectors.`;

function prompt(signal) {
  const today = new Date().toISOString().slice(0, 10);
  return `Today is ${today}. TokenDam already has these detectors:
${HAVE.map((h) => "- " + h).join("\n")}

Recent community signal on LLM cost (for inspiration, not gospel):
${signal.length ? signal.map((s) => "- " + s).join("\n") : "(none fetched)"}

Propose 2-4 NEW detectors we don't have yet. Candidates worth considering: semantically-duplicate REQUESTS across a session (cacheable), oversized few-shot example banks, verbose tool RESULTS bloating history, structured-output-not-used (format re-explained in prose), retry/loop storms, images/base64 in context, over-long max_tokens, memory/RAG chunks that are never referenced. For EACH proposal give, in markdown:
- **name** + one-line what-it-finds
- **trigger** — concrete heuristic over the normalized trace (be specific: thresholds, what to compare)
- **savings formula** — conservative, and note the cache-aware/secondary handling if it overlaps
- **false-positive risk** — the main wrong-answer scenario + how the heuristic avoids it
- **worth-building** — high/med/low + why (weekend-implementable? big lever?)
End with a 1-line recommendation of which ONE to build next. Under ~500 words.`;
}

export default async function handler(req, res) {
  const auth = authorize(req);
  if (!auth.ok) return res.status(auth.code).json({ ok: false, reason: auth.reason });
  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(200).json({ ok: true, skipped: "ANTHROPIC_API_KEY not set — R&D agent dormant" });

  const signal = await hnSignal();
  let proposals;
  try {
    proposals = await anthropic({ system: SYSTEM, user: prompt(signal), maxTokens: 1800 });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e).slice(0, 300) });
  }
  if (!proposals) return res.status(200).json({ ok: true, skipped: "no LLM output" });

  const body = `${md(proposals)}
    <div style="font-size:11px;color:#aaa;margin-top:14px">Proposals only — approve into the codebase by hand. ${signal.length} signal(s) used.</div>`;
  const email = await sendEmail({
    subject: "🔬 TokenDam R&D — new detector proposals",
    html: emailShell("Detector R&D — new-detector proposals", body),
    text: proposals,
  });
  return res.status(200).json({ ok: true, emailed: !email.skipped });
}

function md(s) {
  return escapeHtml(s)
    .replace(/^#{1,3} (.*)$/gm, "<h3 style='margin:14px 0 6px'>$1</h3>")
    .replace(/^\s*[-*] (.*)$/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]*?<\/li>)/g, "<ul style='margin:6px 0'>$1</ul>")
    .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code style='background:#f3f3f3;padding:1px 4px;border-radius:3px'>$1</code>")
    .replace(/\n{2,}/g, "<br><br>");
}
