# Sportsmart Implementation Plans

This directory holds the implementation roadmap for completing the Sportsmart marketplace. It exists so that any engineer (human or AI) can pick up a feature, understand its current state, and know exactly what "done" looks like — without having to re-derive context every time.

## What's in here

| File | Purpose |
|---|---|
| `MASTER_PLAN.md` | The phased roadmap. Reads top-to-bottom: which phase a feature belongs to, why it sits there, what it depends on, and what unlocks once it ships. |
| `STATUS_TRACKER.md` | One row per feature, single source of truth for status. Updated as features move through `planned → in_progress → review → done`. |
| `_template.md` | The per-feature plan template. Every feature plan follows this shape so reviews and hand-offs are consistent. |
| `phase-N-*/` | One subdirectory per phase. Inside each, one `<NN>-<feature-name>.md` file per feature, written from `_template.md`. |

## How to use these plans

**Before starting a feature** — open the plan file. It tells you:
- What already exists in the codebase (with file paths)
- What's missing
- The exact endpoints, DB models, and frontend pages you need to add
- Which edge cases must be handled
- How "done" is defined

**During implementation** — keep tasks granular (ideally <½ day each). Update the plan file inline when assumptions change; treat the plan as living, not a contract.

**On completion** — flip the row in `STATUS_TRACKER.md` to `done` with the PR/commit reference. Move blockers into the next feature's plan if they're now unblocked.

## Conventions

- **Plans are not specs.** They commit to acceptance criteria and architecture decisions, not to a line-by-line design. Implementation details live in code, not here.
- **Plans are revisable.** If the audit reality differs from the plan when you pick it up, fix the plan before writing code.
- **Dependencies are real.** A plan in Phase 4 cannot start until its declared dependencies are `done`. If you find a missing dependency, that's a blocker — log it and revisit the master plan.
- **Edge cases must be enumerated** before implementation, not discovered during. Missing edge-case lists are why bugs ship.
- **Every plan has a test plan.** No plan is complete without it.

## Status vocabulary

| Status | Meaning |
|---|---|
| `planned` | Plan written, no code |
| `in_progress` | Branch open, code being written |
| `review` | PR open, awaiting review |
| `done` | Merged, deployed to dev, smoke-tested |
| `blocked` | Waiting on a dependency or external decision |

## Why this structure exists

Most projects fail not because individual features are hard, but because nobody can see the whole roadmap, dependencies are implicit, and "done" is fuzzy. This directory fixes those three failure modes with three artifacts (master plan, tracker, per-feature plans).
