// TokenDam Cloud — GitHub App Manifest redirect handler.
//
// GitHub redirects here (?code=...) right after the user clicks "Create GitHub App"
// on the manifest flow (public/github-setup.html). We exchange the one-time code
// for the app's credentials (app id, private key, webhook secret) via the official
// conversions endpoint, then show them so they can be wired into Vercel env in one
// step. The code is single-use and expires in ~1 hour — nothing is stored server-side.

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

export default async function handler(req, res) {
  const code = req.query?.code;
  if (!code) {
    res.setHeader("content-type", "text/html; charset=utf-8");
    return res
      .status(400)
      .send(page("Missing code", `<p>Open <a href="/github-setup.html">/github-setup.html</a> and click the create button — GitHub sends you back here with a one-time code.</p>`));
  }

  let app;
  try {
    const r = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
      method: "POST",
      headers: { accept: "application/vnd.github+json", "user-agent": "tokendam-setup" },
    });
    app = await r.json();
    if (!r.ok) throw new Error(app?.message || `GitHub returned ${r.status}`);
  } catch (e) {
    res.setHeader("content-type", "text/html; charset=utf-8");
    return res.status(502).send(page("Conversion failed", `<p>${esc(String(e))}</p><p>The code is single-use and expires quickly — <a href="/github-setup.html">start over</a>.</p>`));
  }

  const appId = app.id;
  const secret = app.webhook_secret || "(none generated)";
  const pem = app.pem || "";
  const installUrl = app.html_url ? `${app.html_url}/installations/new` : "https://github.com";

  const body = `
    <p>✅ Created <b>${esc(app.name || "TokenDam")}</b> in your account. It's live in your GitHub settings; now wire these three values into Vercel and Cloud is on.</p>
    <h2>1 · App ID</h2>
    <pre>GITHUB_APP_ID=${esc(appId)}</pre>
    <h2>2 · Webhook secret</h2>
    <pre>GITHUB_WEBHOOK_SECRET=${esc(secret)}</pre>
    <h2>3 · Private key</h2>
    <p class="muted">Set <code>GITHUB_APP_PRIVATE_KEY</code> to the whole block below (paste as-is):</p>
    <pre>${esc(pem)}</pre>
    <div class="cta">
      <p><b>Hand these three to your assistant</b> — it will set the Vercel env vars and redeploy. Or set them yourself under Vercel → tokendam → Settings → Environment Variables, then redeploy.</p>
      <p>After that: <a href="${esc(installUrl)}">install the app on a repo →</a> (one with a <code>traces/</code> folder), open a PR, and the audit comment appears.</p>
    </div>
    <p class="muted">⚠️ These are shown once and not stored on our servers. If this screen isn't just you, regenerate the key in the app's settings.</p>`;

  res.setHeader("content-type", "text/html; charset=utf-8");
  return res.status(200).send(page("TokenDam Cloud — app created", body));
}

function page(title, inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  body{margin:0;background:#0a0b0d;color:#e6e8ec;font:15px/1.6 -apple-system,system-ui,sans-serif}
  .wrap{max-width:680px;margin:0 auto;padding:56px 20px}
  h1{font:600 22px "JetBrains Mono",ui-monospace,monospace;letter-spacing:-.02em}
  h2{font:600 14px "JetBrains Mono",ui-monospace,monospace;color:#5eead4;margin:26px 0 8px}
  p{color:#8b909b} b{color:#e6e8ec} a{color:#5eead4}
  code{font:13px "JetBrains Mono",monospace;background:#16181d;padding:1px 5px;border-radius:4px}
  pre{font:12.5px/1.5 "JetBrains Mono",monospace;background:#16181d;border:1px solid #23262e;border-radius:8px;padding:12px 14px;white-space:pre-wrap;word-break:break-all;color:#e6e8ec}
  .muted{font-size:13px;color:#565c68} .cta{border-top:1px solid #23262e;margin-top:24px;padding-top:16px}
</style></head><body><div class="wrap"><h1>🧱 ${esc(title)}</h1>${inner}</div></body></html>`;
}
