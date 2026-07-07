# Workflow

Sensible defaults for a small research-tooling project. Adjust as the team
prefers.

## Testing / TDD
**Flexible** — tests are recommended, not gated. The repo has no suite today.
Because most of the pipeline shells out to external CLIs (hard to unit test),
prioritize:
- **Unit tests** for the pure logic that's easy to get wrong: geometry
  fingerprinting / group verification, colorspace-conversion decisions, and
  manifest assembly.
- **Integration smoke tests** running the console scripts against a small sample
  object (a trimmed version of the `mvs` example) and asserting the emitted
  manifest + asset set.
- The viewer's critical invariant — **camera preserved across a band switch** —
  should have at least one automated check.

## Commits
Descriptive messages; no strict conventional-commit format required (matches the
existing history, which merges feature branches into `develop`). Commit-message
and MR-description drafts should be generated with the cheapest capable model.

## Branching & code review
- Work on feature branches; merge into `develop` via GitLab **merge requests**.
- Review **required for non-trivial changes**; small/mechanical fixes may
  self-merge.

## Verification checkpoints
**After each phase** (see [../docs/implementation-plan.md](../docs/implementation-plan.md)).
Each phase has explicit acceptance criteria; verify against real `mvs` data
before moving on. Phase 0 (the toolchain spike) is itself a verification gate for
the whole approach.

## Task lifecycle
`todo → in_progress → verifying → done`. A task is *done* only when its phase's
relevant acceptance criteria are met on real data, not merely when code compiles.
