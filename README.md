# 🧱 TokenDam

**A linter for your LLM token spend.** Paste your agent's trace — TokenDam finds where you're
burning tokens and tells you how to stop. Runs 100% in your browser or as a local CLI.
**Nothing is uploaded.**

Production agents leak money in boringly consistent ways: the same 2,000-token system prompt
resent uncached on every call, a whole scraped page dumped into context when 10% mattered, a
kitchen-sink MCP server exposing 30 tools the model never calls, an ever-growing message history.
TokenDam reads a trace and points at each one with a dollar figure and a fix.

## What it catches

| Detector | What it finds |
|---|---|
| **Unused prompt cache** | A large static prefix (system + tools + fixed examples) resent at full price across calls, when caching would charge ~10% (Anthropic/DeepSeek) or ~50% (OpenAI) on the repeats. |
| **Bloated context** | Oversized variable payloads — whole pages / files / API dumps — where most of it is boilerplate the model doesn't need. |
| **Redundant tools** | Tool / MCP schemas shipped on every call but never actually invoked. |
| **Uncompacted history** | Long-running agent loops that resend the entire conversation every turn instead of compacting old turns. |
| **Duplicate content** | The same (or near-identical) document pasted more than once within a call — you pay for every copy. |
| **Reasoning-token waste** | Reasoning models (o-series, GPT-5, deepseek-reasoner, Claude thinking) burning uncapped hidden reasoning tokens on simple tasks, billed at the output rate. |
| **Duplicate requests** | The same request (same task/query, ignoring the static system prompt) sent to the model more than once in a trace — a response/semantic cache would skip the repeat entirely. |
| **Model overkill** | A flagship model (Opus, GPT-4o, GPT-5) used for a simple task a cheaper sibling would nail — model price gaps of 10–20x, often larger than any prompt-side saving. |

## Reads (paste any of these)

OpenAI / Anthropic request bodies · LangSmith runs · Langfuse observations · OpenAI Batch
output · Vercel AI SDK (`onFinish` + `UIMessage[]`) · generic `{request,response}` JSONL ·
OpenAI Usage Admin API. Single object, an array, `{calls:[...]}`, or JSONL all work.

**For autonomous agents:** TokenDam ships an [MCP server](docs/mcp.md) (`tokendam mcp`) so an
agent can run it **on itself, in its own loop** — analyze its recent calls, get a fix, and
self-throttle its token spend. Nothing uploaded; every cost decision is a measurement.

It's also an [AI-native project](docs/standing-agents.md): a standing crew (PM + CTO + detector-R&D
scientist + uptime sentinel) runs the roadmap, keeps prices current, and proposes new detectors — so
the tool self-evolves, with a human-approve gate on anything that ships.

## Try it

**Web:** open the hosted page, click a demo, or paste your own trace. It never leaves the tab.

**CLI:**

```bash
npx tokendam ./trace.json          # analyze a file
cat trace.json | npx tokendam      # or pipe it in
npx tokendam --example sd          # built-in scraper-agent demo
npx tokendam --example agent       # built-in coding-agent demo
npx tokendam --json ./trace.json   # machine-readable Report
```

## Capture a trace

The one thing TokenDam needs is your agent's request payload(s). Grab a few from a
single run — cross-call waste (caching, history, duplicate docs) only shows across
multiple calls:

```ts
import { tap, writeTrace } from "tokendam/capture";

// wrap your request args — works with any SDK, zero behavior change:
await openai.chat.completions.create(tap({ model, messages, tools }));

// after a representative run:
await writeTrace("traces/agent.json");   // then: tokendam traces/agent.json
```

Or scaffold everything (config + traces dir + CI workflow) with `npx tokendam init`.
No SDK? Just `console.log(JSON.stringify({ model, messages, tools }))` and paste that.

## Input format

Anything that looks like one or more chat-completion request bodies:

- A single OpenAI request: `{ "model": "...", "messages": [...], "tools": [...] }`
- A single Anthropic request: `{ "model": "...", "system": "...", "messages": [...], "tools": [...] }`
- An **array** of them (a multi-call trace — this is where caching/history findings come alive)
- A wrapper: `{ "calls": [ ... ] }`

Include `usage` on each call if you have it and output-cost will be included too.

## How the numbers work

- Token counts use the OpenAI **o200k** tokenizer — exact-ish for OpenAI, and within ~10–15% for
  Claude/DeepSeek (flagged in the report as an estimate).
- Prices are list prices from a small, editable table in [`src/core/pricing.ts`](src/core/pricing.ts).
  Unknown models fall back to a mid-range price (and say so).
- Savings estimates are deliberately **conservative** and clearly labeled. Overlapping findings are
  capped so the headline stays honest. TokenDam gives you a ranked place to look, not a guarantee.

## Development

```bash
npm install
npm run cli -- --example agent   # run the CLI from source
npm run dev                      # web app (Vite) at localhost:5173
npm run build:web                # static build → dist-web/
```

The analysis engine ([`src/core/`](src/core/)) is pure, dependency-light TypeScript with zero I/O —
the same code powers the CLI and the browser app.

## License

MIT. Not affiliated with OpenAI, Anthropic, or any provider.
