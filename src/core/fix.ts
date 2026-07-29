// Mechanical, behavior-preserving auto-fixes for LLM request payloads.
//
// TokenDam's detectors ADVISE; this module is the part that can actually APPLY a
// fix — but ONLY the transforms that are deterministic and cannot change what the
// model returns. Today that means one flagship fix: adding a prompt-cache
// breakpoint to the static prefix (the single biggest, safest lever). Everything
// that could alter model behavior (trimming history, pruning tools) stays advice
// in the fix pack — we never silently touch those.
//
// Shared by the CLI (`tokendam fix --apply`) and TokenDam Cloud (auto-fix PR), so
// the applied change is identical everywhere.

export interface FixResult {
  changed: boolean;
  changes: string[];
}

// Does this request already declare any prompt-cache breakpoint?
function hasCacheControl(req: any): boolean {
  const scan = (blocks: any) =>
    Array.isArray(blocks) && blocks.some((b) => b && typeof b === "object" && b.cache_control);
  if (scan(req?.system)) return true;
  if (scan(req?.tools)) return true;
  // Anthropic also allows cache_control on message content blocks.
  if (Array.isArray(req?.messages))
    for (const m of req.messages) if (scan(m?.content)) return true;
  return false;
}

// Add cache_control to the last static block of ONE Anthropic-style request.
// Caching is transparent to the model — the output is byte-for-byte identical —
// so this is always safe to apply automatically.
export function applyCacheFix(req: any): FixResult {
  const changes: string[] = [];
  if (!req || typeof req !== "object") return { changed: false, changes };
  if (hasCacheControl(req)) return { changed: false, changes }; // already cached — leave it

  // Normalize a string system prompt into a cacheable text block.
  if (typeof req.system === "string" && req.system.trim()) {
    req.system = [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }];
    changes.push("Converted the string system prompt into a cached text block (cache_control: ephemeral).");
    return { changed: true, changes };
  }

  // Prefer caching the end of the system array (covers the whole static prefix:
  // instructions + persona/bible + tool context up to that breakpoint).
  if (Array.isArray(req.system) && req.system.length) {
    const last = req.system[req.system.length - 1];
    if (last && typeof last === "object") {
      last.cache_control = { type: "ephemeral" };
      changes.push(`Added cache_control to the last of ${req.system.length} system block(s) — caches the static prefix.`);
    }
  }
  // If tools are defined, also cache the tool list (large, identical every call).
  if (Array.isArray(req.tools) && req.tools.length) {
    const last = req.tools[req.tools.length - 1];
    if (last && typeof last === "object") {
      last.cache_control = { type: "ephemeral" };
      changes.push(`Added cache_control to the last of ${req.tools.length} tool schema(s).`);
    }
  }
  return { changed: changes.length > 0, changes };
}

// Apply the cache fix across a whole trace (array of request payloads).
// Mutates copies; returns the fixed array + a human-readable change list.
export function applyFixes(elements: unknown): { fixed: any[]; result: FixResult } {
  const arr = Array.isArray(elements) ? elements : [elements];
  const fixed = arr.map((e) => JSON.parse(JSON.stringify(e)));
  const changes: string[] = [];
  let changedCount = 0;
  for (const req of fixed) {
    const r = applyCacheFix(req);
    if (r.changed) {
      changedCount++;
      for (const c of r.changes) if (!changes.includes(c)) changes.push(c);
    }
  }
  const summary =
    changedCount > 0
      ? [`Applied prompt-cache breakpoints to ${changedCount}/${arr.length} request(s).`, ...changes]
      : [];
  return { fixed, result: { changed: changedCount > 0, changes: summary } };
}
