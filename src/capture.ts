// tokendam/capture — record the request payloads your agent sends so you can
// feed them to TokenDam. Works with ANY SDK: wrap the request args with tap().
// Node- and browser-safe (fs is only touched in writeTrace, lazily).
//
//   import { tap, writeTrace } from "tokendam/capture";
//   await openai.chat.completions.create(tap({ model, messages, tools }));
//   // ...after a representative run:
//   writeTrace("traces/agent.json");   // then: tokendam traces/agent.json

const buffer: unknown[] = [];

/** Record a request payload and return it unchanged, so it drops into any call. */
export function tap<T>(requestArgs: T): T {
  try {
    buffer.push(JSON.parse(JSON.stringify(requestArgs)));
  } catch {
    buffer.push(requestArgs);
  }
  return requestArgs;
}

/** All captured calls so far (a copy). Paste this into TokenDam, or write it out. */
export function getTrace(): unknown[] {
  return buffer.slice();
}

/** Clear the buffer (e.g. between test cases). */
export function resetTrace(): void {
  buffer.length = 0;
}

/** Write the captured trace to a JSON file (Node only). Returns the count. */
export async function writeTrace(path = "tokendam-trace.json"): Promise<number> {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(path, JSON.stringify(buffer, null, 2));
  return buffer.length;
}

/** Dump the trace automatically when the process exits (Node only). */
export function installExitDump(path = "tokendam-trace.json"): void {
  if (typeof process !== "undefined" && process.on) {
    process.on("exit", () => {
      try {
        // Sync write on exit — dynamic import won't resolve during 'exit'.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        (0, eval)("require")("node:fs").writeFileSync(path, JSON.stringify(buffer, null, 2));
      } catch {
        /* best effort */
      }
    });
  }
}

/**
 * Wrap global fetch to capture OpenAI/Anthropic request bodies with zero changes
 * to your call sites. Assign the result to globalThis.fetch before your agent runs.
 */
export function wrapFetch(orig: typeof fetch = fetch): typeof fetch {
  return (async (input: any, init?: any) => {
    try {
      const url = String(typeof input === "string" ? input : input?.url ?? "");
      if (init?.body && /openai\.com|anthropic\.com|\/chat\/completions|\/messages/.test(url)) {
        buffer.push(JSON.parse(typeof init.body === "string" ? init.body : String(init.body)));
      }
    } catch {
      /* ignore capture failures — never break the real request */
    }
    return orig(input, init);
  }) as typeof fetch;
}
