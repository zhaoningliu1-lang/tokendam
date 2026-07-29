#!/usr/bin/env node
// tokendam-mcp — a Model Context Protocol server so an autonomous agent can run
// TokenDam ON ITSELF, inside its own loop: analyze its recent calls, see the
// token waste + dollar figure, get a fix, and self-correct — no human, no upload.
//
// Minimal stdio JSON-RPC 2.0 MCP server (newline-delimited). Exposes three tools:
//   analyze_trace · fix_prompt · token_diff
// Add it to an MCP client (Claude Desktop/Code, Cursor, or your own agent):
//   { "mcpServers": { "tokendam": { "command": "npx", "args": ["-y","tokendam","mcp"] } } }

import { createInterface } from "node:readline";
import { analyze } from "./core/analyze.js";
import { renderMarkdown } from "./core/ci.js";
import { renderFixPrompt } from "./core/fixPrompt.js";
import { diffReports, renderDiffText } from "./core/diff.js";

type Json = any;

const PROTOCOL = "2024-11-05";
const TOOLS = [
  {
    name: "analyze_trace",
    description:
      "Analyze an LLM request trace (your own recent calls) for token waste. Returns a report with the wasted-token/dollar breakdown, a $/month projection, and concrete fixes. Use this on your OWN calls to self-optimize your token spend. Nothing is uploaded — analysis is local.",
    inputSchema: {
      type: "object",
      properties: {
        trace: {
          description:
            "One OpenAI/Anthropic request body, an array of them, {calls:[...]}, or an export from LangSmith/Langfuse/OpenAI-Batch/Vercel-AI-SDK. May be a JSON object or a JSON/JSONL string.",
        },
        callsPerDay: { type: "number", description: "Optional: project savings to N calls/day (default 1000)." },
      },
      required: ["trace"],
    },
  },
  {
    name: "fix_prompt",
    description:
      "Turn a trace's findings into a ready-to-apply 'fix pack' — precise instructions to reduce the token waste (add prompt caching, trim context, drop unused tools, cap reasoning, etc.). An autonomous agent can act on these to self-correct.",
    inputSchema: {
      type: "object",
      properties: {
        trace: { description: "Same trace formats as analyze_trace." },
        callsPerDay: { type: "number" },
      },
      required: ["trace"],
    },
  },
  {
    name: "token_diff",
    description:
      "Compare two traces (before vs after a change) and report whether token cost improved, regressed, or is unchanged — deterministic, so it works as a self-check after you adjust your prompts.",
    inputSchema: {
      type: "object",
      properties: {
        before: { description: "Trace before the change." },
        after: { description: "Trace after the change." },
      },
      required: ["before", "after"],
    },
  },
];

function send(msg: Json) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function ok(id: Json, result: Json) {
  send({ jsonrpc: "2.0", id, result });
}
function fail(id: Json, code: number, message: string) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}
function text(t: string) {
  return { content: [{ type: "text", text: t }] };
}
function asTrace(v: Json): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v; // let normalize() handle JSONL / raw
  }
}

function callTool(name: string, a: Json): Json {
  if (name === "analyze_trace") {
    const report = analyze(asTrace(a.trace));
    return text(renderMarkdown(report, undefined, a.callsPerDay ?? 1000));
  }
  if (name === "fix_prompt") {
    const report = analyze(asTrace(a.trace));
    return text(renderFixPrompt(report, a.callsPerDay ?? 1000));
  }
  if (name === "token_diff") {
    const before = analyze(asTrace(a.before));
    const after = analyze(asTrace(a.after));
    return text(renderDiffText(before, after, diffReports(before, after)));
  }
  throw new Error(`unknown tool: ${name}`);
}

function handle(msg: Json) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return ok(id, {
      protocolVersion: PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: { name: "tokendam", version: "0.1.0" },
    });
  }
  if (method === "notifications/initialized" || method?.startsWith("notifications/")) return;
  if (method === "ping") return ok(id, {});
  if (method === "tools/list") return ok(id, { tools: TOOLS });
  if (method === "tools/call") {
    try {
      return ok(id, callTool(params?.name, params?.arguments ?? {}));
    } catch (e) {
      return ok(id, { content: [{ type: "text", text: "Error: " + (e as Error).message }], isError: true });
    }
  }
  if (id !== undefined) return fail(id, -32601, `method not found: ${method}`);
}

export function startMcp() {
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    const s = line.trim();
    if (!s) return;
    let msg: Json;
    try {
      msg = JSON.parse(s);
    } catch {
      return;
    }
    try {
      handle(msg);
    } catch (e) {
      if (msg?.id !== undefined) fail(msg.id, -32603, (e as Error).message);
    }
  });
}

// Run directly (bin) — the CLI's `tokendam mcp` subcommand calls startMcp() too.
if (process.argv[1] && /mcp(\.[cm]?[jt]s)?$/.test(process.argv[1])) startMcp();
