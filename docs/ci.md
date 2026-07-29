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

## GitHub Actions

```yaml
# .github/workflows/tokendam.yml
name: token-budget
on: [pull_request]
jobs:
  tokendam:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      # Your test run should write representative request payloads to traces/*.json
      - run: node your-capture-script.js      # produces traces/
      - run: npx tokendam --ci --format github traces/agent.json
```

`--format github` emits `::error::`/`::warning::` annotations that show up inline
on the PR. To post a Markdown comment instead, capture `--format markdown` output
and pipe it to `gh pr comment`.

## How teams capture traces

The trace is just the request payload(s) your agent sends. In your integration
test, log the params object (see the in-app "How do I get my trace?" guide) to
`traces/*.json`. Commit a few representative ones; the gate then catches
regressions on every PR.
