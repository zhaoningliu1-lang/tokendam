# TokenDam as an MCP server — let agents self-optimize their own token use

In an autonomous-agent world, agents run 24/7 and their biggest operating cost is
tokens. TokenDam ships an [MCP](https://modelcontextprotocol.io) server so an agent
can run TokenDam **on itself, inside its own loop** — analyze its recent calls, see
the waste + dollar figure, get a fix, and self-correct. No human, nothing uploaded.

## Add it to an MCP client

Claude Desktop / Claude Code / Cursor / any MCP-capable agent:

```json
{
  "mcpServers": {
    "tokendam": { "command": "npx", "args": ["-y", "tokendam", "mcp"] }
  }
}
```

(From a local checkout instead: `"command": "node", "args": ["/path/to/tokendam/dist/cli.js", "mcp"]`.)

## Tools it exposes

| Tool | What the agent does with it |
|---|---|
| `analyze_trace` | Pass your own recent request(s) → get a token-waste report + $/month projection + fixes. |
| `fix_prompt` | Get a ready-to-apply "fix pack" (add caching, trim context, drop unused tools, cap reasoning…). |
| `token_diff` | Before/after check — did my prompt change actually cut cost? Deterministic, so it's a reliable self-test. |

## The self-optimizing loop

```
agent does work
      │
      ├─► analyze_trace(my recent calls)      # how much am I wasting?
      ├─► fix_prompt(...)                      # exactly how do I fix it?
      ├─► self-adjust (trim context, cache,    # apply it to my own prompting
      │    drop tools, lower reasoning effort)
      └─► token_diff(before, after)            # verify I actually got cheaper
```

An agent that self-learns and self-iterates should also **self-throttle**. TokenDam
is that organ — and because it runs locally and deterministically, the agent stays
both efficient *and* auditable: every cost decision is a measurement, not a guess.
