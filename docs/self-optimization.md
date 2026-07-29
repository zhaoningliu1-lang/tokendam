# Autonomous self-optimization

TokenDam improves itself on a schedule. What used to be a human running a critique
army each round (see `optimization-log.md`, rounds 1–10) becomes a **standing loop**:
the tool proposes and verifies its own improvements; a human approves what ships.

This is the aligned shape of an autonomous agent — **autonomous discovery, human-approved
evolution**. It can find and fix, but it cannot ship itself.

## The loop (each scheduled run)

```
1. read optimization-log.md            # what's done / parked — don't repeat
2. critique (multi-lens, reads real code)
      correctness · adversarial · product/target-user
3. synthesize a ranked backlog (impact ÷ effort)
4. implement ONLY the top 2–3 small, low-risk, test-covered fixes
      → on a NEW branch  selfopt/<date>
5. verify:  npm test  &&  tsc --noEmit
      → if not all green, revert the changes and just report the backlog
6. append a "Round N (autonomous)" entry to optimization-log.md
7. commit to the branch, push it, and report a digest:
      found · fixed-on-branch · needs-human-review · parked
8. STOP.
```

## Hard guardrails (never crossed by the autonomous run)

- **Branch only.** Works on `selfopt/<date>`; **never commits to `main`.**
- **Never deploys** to production and **never `npm publish`es.**
- **Tests must stay green** — if a change breaks the suite, it's reverted, not shipped.
- **Human merges.** A person reviews the branch/PR and merges + deploys if it's good.
  Shipping is a human decision, always.

## Human review

Each run leaves a `selfopt/<date>` branch + a digest. To accept: review the diff,
merge to `main`, then `npm run deploy`. To reject: delete the branch. To adjust
cadence or pause: use the schedule/routine controls.

## Cost

A run spends model tokens (a lighter critique than a full manual round — ~a few
hundred K tokens). Cadence is set conservatively; raise/lower it based on how fast
the product is moving. The loop is a compounding investment in quality, not a
one-off — but it is a recurring cost, on by choice.
