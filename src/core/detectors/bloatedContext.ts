import type { Finding, NormMessage, NormTrace } from "../types.js";
import type { ModelPrice } from "../pricing.js";
import { usd } from "../pricing.js";

// Flags oversized VARIABLE content — a single user/tool message that dwarfs
// everything else. Classic case: dumping a whole scraped page / file / API
// response into context when only a slice matters (e.g. sd-tender-radar's
// text[:60_000]). We estimate a conservative trimmable fraction and label it
// as an estimate, never a promise.

const BLOAT_THRESHOLD = 3000; // tokens; a single chunk bigger than this is suspicious
const TRIMMABLE_FRACTION = 0.4; // conservative: assume ~40% is boilerplate/noise

export function bloatedContext(trace: NormTrace, price: ModelPrice): Finding[] {
  const findings: Finding[] = [];
  const perToken = price.input / 1_000_000;

  // Aggregate the biggest non-system chunk per call, then report the worst few.
  type Big = { call: number; msg: NormMessage; tokens: number };
  const bigs: Big[] = [];
  trace.calls.forEach((call, ci) => {
    for (const m of call.messages) {
      if (m.role === "assistant") continue; // model output, not our context waste
      if (m.tokens >= BLOAT_THRESHOLD) bigs.push({ call: ci, msg: m, tokens: m.tokens });
    }
  });
  if (!bigs.length) return findings;

  bigs.sort((a, b) => b.tokens - a.tokens);
  const totalBloatTokens = bigs.reduce((s, b) => s + b.tokens, 0);
  const trimTokens = Math.round(totalBloatTokens * TRIMMABLE_FRACTION);
  const wastedUSD = trimTokens * perToken;

  const worst = bigs.slice(0, 5);
  const evidence = worst.map(
    (b) =>
      `call #${b.call + 1} · ${b.msg.role} message · ${b.tokens.toLocaleString()} tok — "${b.msg.text
        .slice(0, 70)
        .replace(/\s+/g, " ")}…"`
  );

  findings.push({
    detector: "bloated-context",
    severity: totalBloatTokens > 15000 ? "high" : "medium",
    title: `${bigs.length} oversized context chunk(s) — ~${totalBloatTokens.toLocaleString()} tokens of raw payload`,
    detail: `Large chunks of variable content are being pushed into the prompt (biggest: ${worst[0].tokens.toLocaleString()} tokens). Most of a scraped page / file dump / API response is usually boilerplate the model doesn't need. Trimming to the relevant slice before the call is the highest-leverage change for input cost. Estimated trimmable at a conservative ${Math.round(
      TRIMMABLE_FRACTION * 100
    )}% ≈ ${trimTokens.toLocaleString()} tokens (${usd(wastedUSD)}).`,
    fix: "Pre-extract the relevant section before sending: strip nav/footer/boilerplate, keep the sections your task actually reads, or run a cheap regex/heuristic pass first. Replace blind slices like text[:60000] with content-aware extraction.",
    wastedTokens: trimTokens,
    wastedUSD,
    evidence,
  });

  return findings;
}
