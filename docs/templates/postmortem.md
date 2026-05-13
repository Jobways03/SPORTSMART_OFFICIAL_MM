# Postmortem — <FILL IN: incident short-name>

| Field | Value |
|---|---|
| Incident ID | `inc-<FILL IN: YYYYMMDD-short-name>` |
| Date | <FILL IN: YYYY-MM-DD> |
| SEV | <FILL IN: SEV-1 / SEV-2 / SEV-3> |
| Duration | <FILL IN: start UTC → end UTC, total minutes> |
| Incident Commander | <FILL IN: name> |
| Communications Lead | <FILL IN: name> |
| Engineering Lead(s) | <FILL IN: names> |
| Author | <FILL IN: name; usually the IC> |
| Status | DRAFT |

> Owner reminder: SEV-1 postmortems are due within 5 business days of incident close. SEV-2 postmortems are required when the cause is non-obvious or the response was slow. Update `Status` to `PUBLISHED` once review is complete.

## Summary

<FILL IN: 1–3 sentences. What happened, what was the user-visible impact, what was the root resolution. A reader who only reads this section should understand whether the same class of issue could happen again.>

## Timeline

All timestamps in UTC. Include the trigger, the page, every major investigation step, the fix, and the close.

| Time (UTC) | Event |
|---|---|
| <FILL IN: HH:MM> | <FILL IN: first observable signal — alert fired, customer report, metric drift> |
| <FILL IN: HH:MM> | <FILL IN: PagerDuty page to <team>> |
| <FILL IN: HH:MM> | <FILL IN: IC acknowledged, incident channel opened> |
| <FILL IN: HH:MM> | <FILL IN: investigation step / finding> |
| <FILL IN: HH:MM> | <FILL IN: mitigation deployed / flag flipped / rollback initiated> |
| <FILL IN: HH:MM> | <FILL IN: user-visible recovery confirmed> |
| <FILL IN: HH:MM> | <FILL IN: incident closed> |

## Impact

### User-facing

<FILL IN: which user actions failed or degraded, for how long, estimated affected user count. If unknown, say "unknown — see Action items".>

### Internal

<FILL IN: which engineering / ops workflows were disrupted. E.g. deploys blocked, dashboard noise, on-call pages to adjacent teams.>

### Money / data

<FILL IN: any money loss, double-charge, refund miss, or data corruption. Include exact paise amounts if quantifiable. Reference the audit-trail rows that captured the impact. If none, write "no money or data impact confirmed".>

## Contributing factors

The contributing factors that combined to produce this incident. Avoid single-cause framing — most incidents are a chain of small things, each of which on its own would have been benign.

- <FILL IN: factor 1 — e.g. "Flag X was off in prod following the Tuesday rollback; the env-validator did not catch it because Y.">
- <FILL IN: factor 2>
- <FILL IN: factor 3>

## What we did well

Explicit positive lessons. The point of this section is to make sure good practices we hit by reflex are recognized so we keep doing them.

- <FILL IN: e.g. "The IC handed off engineering work within 5 minutes of taking the page, which kept incident command focused on decisions.">
- <FILL IN: e.g. "The rollback recipe in <runbook>.md was followed verbatim and worked first try.">

## What we'd do differently

Explicit negative lessons. Frame as system / process improvements, not individual mistakes.

- <FILL IN: e.g. "The alert that fired pointed at the symptom (5xx rate), not the cause (flag X off). Add a derived alert that fires on flag-off-in-prod within 5 minutes of deploy.">
- <FILL IN: e.g. "Runbook for capability Y didn't cover this failure mode. Add a new section.">

## Action items

Each action item has a single named owner, a due date, and a tracking ticket. Action items without a Linear ticket are not committed.

| ID | Action | Owner | Due | Linear |
|---|---|---|---|---|
| AI-1 | <FILL IN: concrete change> | <FILL IN: name> | <FILL IN: YYYY-MM-DD> | <FILL IN: PSEC-XXXX> |
| AI-2 | <FILL IN: ...> | <FILL IN: name> | <FILL IN: YYYY-MM-DD> | <FILL IN: ...> |

## Runbook updates needed

Which runbook(s) under `docs/runbooks/` would have shortened or prevented this incident if they had the right content. Each entry points at a specific runbook file + the section that should be updated/added.

- <FILL IN: e.g. "`prod-boot-failures.md` — add a Category 2 entry for FLAG_X with the off-state symptom.">
- <FILL IN: e.g. "`incident-response.md` — owning-team map should include new role <X>.">
- <FILL IN: or, if the existing runbook coverage was adequate: "No runbook updates needed — existing coverage matched the failure mode.">

---

**Author note**: after the action items ship, append a `## Follow-up` section here summarizing what landed and link the merged PRs / commits. Keep this document immutable below that section — postmortems are historical record, not living docs.
