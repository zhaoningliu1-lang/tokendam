# TokenDam in CI — fail the build when token waste regresses

The free linter tells you where you're wasting tokens once. In CI, TokenDam
becomes a **budget gate**: capture representative traces in your test suite, run
`tokendam --ci`, and the build fails when a prompt change pushes token waste past
your budget. It runs entirely in your pipeline — nothing is uploaded.

## Budget config — `.tokendam.json`

```json
{
  "maxWastePct": 15,
  "maxWasteUSDPerCall": 0.01,
  "failOnSeverity": ["high"]
}
```

Any of the three is optional. Flags override the file:
`--max-waste 15`, `--max-waste-per-call 0.01`, `--fail-on high`.

## Local

```bash
# fails (exit 1) if >15% of spend is recoverable
tokendam --ci --max-waste 15 traces/checkout-agent.json

# machine outputs
tokendam --ci --format markdown traces/*.json   # PR comment body
tokendam --ci --format github  traces/*.json     # inline run annotations
tokendam --format json traces/*.json             # raw Report
```

Exit codes: `0` pass · `1` over budget · `2` bad input.

## GitHub Actions — gate + auto-comment the fix pack

```yaml
# .github/workflows/tokendam.yml   (also written by `tokendam init`)
name: token-budget
on: [pull_request]
permissions:
  contents: read
  pull-requests: write        # lets tokendam post a PR comment
jobs:
  tokendam:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: node your-capture-script.js          # writes traces/*.json
      - run: npx tokendam --ci --pr-comment traces/*.json
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

`--pr-comment` posts (and updates on each push) a single PR comment with the audit,
the $/month projection, the pass/fail budget result, **and the ready-to-paste fix
pack**. So the fix lands right in the review flow — a human, or your own coding
agent, applies it. `--format github` additionally emits inline `::error::`
annotations if you want them.

## Opt-in: let CI open a fix PR automatically

TokenDam stays out of your codebase by design — it emits the *fix pack*, and your
own coding agent applies it. If you already run an agent (Claude Code, etc.) in CI,
compose them: pipe the fix pack in and let the agent edit code + open a PR.

```yaml
      - name: capture fix pack
        run: npx tokendam --fix-prompt traces/*.json > /tmp/fixpack.md
      - name: let the agent apply it and open a PR
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          # your coding-agent step reads /tmp/fixpack.md, edits the prompt code,
          # and opens a PR. TokenDam is the brain; the agent is the hands — your
          # code and keys never pass through us.
          your-coding-agent --instructions /tmp/fixpack.md --open-pr
```

This keeps the zero-upload guarantee intact: the agent runs **in your CI, on your
runner, with your keys** — the fixes are applied by your agent, never by us.

## How teams capture traces

The trace is just the request payload(s) your agent sends. In your integration
test, log the params object (see the in-app "How do I get my trace?" guide) to
`traces/*.json`. Commit a few representative ones; the gate then catches
regressions on every PR.
