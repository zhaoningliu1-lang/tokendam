// TokenDam Cloud — cost-trend data for the dashboard.
// GET /api/history?repo=owner/name  → { repo, enabled, audits: [...] }  (oldest→newest)
import { getAudits, storeEnabled, listRepos } from "./_store.js";

export default async function handler(req, res) {
  const repo = (req.query?.repo || "").trim();
  if (!repo) {
    // No repo → list which repos have recorded history (for the dashboard picker).
    const repos = await listRepos().catch(() => []);
    return res.status(200).json({ enabled: storeEnabled(), repos });
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return res.status(400).json({ error: "repo must look like owner/name" });
  }
  try {
    const audits = await getAudits(repo);
    return res.status(200).json({ repo, enabled: storeEnabled(), audits });
  } catch (e) {
    return res.status(500).json({ error: String(e).slice(0, 200) });
  }
}
