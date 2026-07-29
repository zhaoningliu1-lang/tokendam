// Exercises the MCP stdio server: initialize → tools/list → tools/call.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const trace = JSON.parse(readFileSync(join(root, "examples", "coding-agent.json"), "utf8"));

let failed = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`); if (!c) failed++; };

const child = spawn(join(root, "node_modules/.bin/tsx"), [join(root, "src/cli.ts"), "mcp"], {
  stdio: ["pipe", "pipe", "inherit"],
});

const responses = new Map();
let buf = "";
child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined) responses.set(msg.id, msg);
    } catch { /* ignore */ }
  }
});

const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
const waitFor = (id, ms = 8000) =>
  new Promise((res, rej) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (responses.has(id)) { clearInterval(iv); res(responses.get(id)); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error("timeout waiting for " + id)); }
    }, 25);
  });

try {
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {} } });
  const init = await waitFor(1);
  ok("initialize returns serverInfo.name = tokendam", init.result?.serverInfo?.name === "tokendam");
  ok("initialize advertises tools capability", !!init.result?.capabilities?.tools);

  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const list = await waitFor(2);
  const names = (list.result?.tools ?? []).map((t) => t.name);
  ok("tools/list has analyze_trace, fix_prompt, token_diff", ["analyze_trace", "fix_prompt", "token_diff"].every((n) => names.includes(n)), `→ ${names.join(",")}`);

  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "analyze_trace", arguments: { trace } } });
  const call = await waitFor(3);
  const out = call.result?.content?.[0]?.text ?? "";
  ok("analyze_trace returns a report with savings", /savings|waste|TokenDam audit/i.test(out) && !call.result?.isError, `→ ${out.slice(0, 40)}…`);

  send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "fix_prompt", arguments: { trace } } });
  const fix = await waitFor(4);
  ok("fix_prompt returns a fix pack", /fix pack/i.test(fix.result?.content?.[0]?.text ?? ""));
} catch (e) {
  ok("mcp protocol exchange", false, e.message);
} finally {
  child.stdin.end();
  child.kill();
}

console.log(failed ? `\nFAILED (${failed})` : "\nALL MCP CHECKS PASSED");
process.exit(failed ? 1 : 0);
