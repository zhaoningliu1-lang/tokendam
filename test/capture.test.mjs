// Verifies the capture helper records request args and that captured traces
// feed straight into analyze().
import { tap, getTrace, resetTrace, wrapFetch } from "../src/capture.ts";
import { analyze } from "../src/core/analyze.ts";

let failed = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`); if (!c) failed++; };

resetTrace();
const bigSys = "You are a careful assistant. " + "Follow the rules. ".repeat(200);

// tap() returns its arg unchanged and records a deep copy.
const args = { model: "gpt-4o", messages: [{ role: "system", content: bigSys }, { role: "user", content: "hi" }] };
const returned = tap(args);
ok("tap returns the same object reference", returned === args);
tap({ model: "gpt-4o", messages: [{ role: "system", content: bigSys }, { role: "user", content: "bye" }] });

const trace = getTrace();
ok("getTrace collected 2 calls", trace.length === 2, `→ ${trace.length}`);
ok("mutating original after tap doesn't change capture (deep copy)", (() => {
  args.messages[1].content = "MUTATED";
  return trace[0].messages[1].content === "hi";
})());

// The captured trace feeds straight into analyze().
const r = analyze(trace);
ok("captured trace analyzes into a report", r.numCalls === 2, `→ ${r.numCalls} calls`);

// wrapFetch records OpenAI/Anthropic bodies without breaking the request.
resetTrace();
let called = false;
const fakeFetch = async () => { called = true; return { ok: true }; };
const wrapped = wrapFetch(fakeFetch);
await wrapped("https://api.openai.com/v1/chat/completions", { body: JSON.stringify({ model: "gpt-4o", messages: [] }) });
ok("wrapFetch calls through to the real fetch", called);
ok("wrapFetch captured the request body", getTrace().length === 1);

console.log(failed ? `\nFAILED (${failed})` : "\nALL CAPTURE CHECKS PASSED");
process.exit(failed ? 1 : 0);
