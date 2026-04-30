---
feature: <Human-readable feature name>
phase: <0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8>
status: planned
owner: <unassigned | @handle>
priority: <P0 | P1 | P2 | P3>
estimate_days: <rough engineer-days, not calendar>
depends_on:
  - <other feature plan filename, e.g. phase-1-wire-modules/01-notifications-controllers.md>
unblocks:
  - <plans that become startable once this is done>
---

# <Feature name>

## 1. Context (1 paragraph)
Why this feature exists in business terms. Who suffers if we don't ship it. What it costs us today (manual ops, broken flows, lost revenue).

## 2. Current state (evidence-based)
What already exists in the codebase. Cite file paths.

| Artifact | Path | Status |
|---|---|---|
| Prisma model | `apps/api/prisma/schema/<file>.prisma::<Model>` | exists / partial / missing |
| Domain entity | `apps/api/src/modules/<x>/domain/...` | … |
| Service | `apps/api/src/modules/<x>/application/...` | … |
| Controller | `apps/api/src/modules/<x>/presentation/...` | … |
| Frontend page | `apps/web-<actor>/src/app/...` | … |

## 3. Goals & non-goals
**Goals** — concrete outcomes this feature delivers.
- …

**Non-goals** — things deliberately *not* done in this feature, to be picked up later or never.
- …

## 4. Architecture decisions
The 3-5 decisions that shape implementation. Each has a one-line rationale.
- **Decision:** … **Why:** …
- **Decision:** … **Why:** …

If a decision conflicts with an existing pattern in the codebase, call it out explicitly.

## 5. API surface
New or changed endpoints. Use the project convention (`/api/v1/<actor>/<resource>`).

| Method | Path | Auth guard | Request | Response | Notes |
|---|---|---|---|---|---|
| POST | `/api/v1/admin/...` | `AdminAuthGuard` | DTO | DTO | … |

## 6. Data model changes
Migrations, new models, new enums, new indexes. Note backfill needs.

```prisma
// Sketch only — full schema goes in a Prisma migration.
model <X> {
  …
}
```

**Backfill / migration strategy:** …

## 7. Events emitted/consumed
NestJS `EventEmitter` integration. List both directions.
- **Emits:** `<EventName>` — payload shape, who listens
- **Consumes:** `<EventName>` from `<module>` — what it does with it

## 8. Frontend impact
Which apps need new/changed pages. One row per page.

| App | Route | Components | Notes |
|---|---|---|---|
| `web-<actor>` | `/dashboard/...` | `<Component>` | … |

## 9. Edge cases (enumerate, do not discover later)
Each row is a scenario the implementation must handle. Mark how it should resolve.

| Scenario | Expected behavior |
|---|---|
| User submits without required field | 400 with field-level error |
| Concurrent updates to same entity | Optimistic lock / last-write-wins / queue |
| External integration (Shiprocket, Razorpay, etc.) timeout | Retry policy + fallback |
| Soft-deleted parent | Block / cascade / hide |
| Race between worker and API | Idempotency key strategy |

## 10. Failure modes & rollback
- **What breaks if this ships broken?** …
- **How do we roll it back?** Feature flag / DB migration reversibility / etc.
- **What's the blast radius?** Single user / cohort / all traffic.

## 11. Security & compliance
- Auth: which guard, which role, which permission(s).
- Data sensitivity: PII / financial / KYC documents — note redaction in logs.
- Audit: which actions must hit `audit_logs`.
- Rate limits: needed? what threshold?

## 12. Observability
- Log lines (with request-id correlation) for every state transition.
- Metrics: counters, latency histograms, business KPIs.
- Alerts: what condition pages oncall.

## 13. Test plan
- **Unit tests** — service-level invariants.
- **Integration tests** — controller-level happy + critical edge cases.
- **E2E manual test script** — exact clicks/calls to verify pre-ship.

## 14. Tasks (ordered, ≤½ day each)
1. … (DB migration)
2. … (domain entity + repository interface)
3. … (Prisma repository implementation)
4. … (application service)
5. … (controller + DTO + guard)
6. … (event handler if needed)
7. … (frontend page)
8. … (tests)
9. … (docs update)
10. … (smoke test on dev)

## 15. Acceptance criteria (definition of done)
Tick-list — every item must pass before status flips to `done`.
- [ ] All endpoints respond with correct shape and codes (verified via Postman/curl).
- [ ] All edge cases from §9 are tested.
- [ ] Migration runs cleanly on a fresh DB and against current dev DB.
- [ ] Frontend pages render and connect to API on `localhost:8000`.
- [ ] No new TS / lint errors introduced.
- [ ] `STATUS_TRACKER.md` updated.

## 16. Open questions
List unresolved decisions that need a stakeholder. Don't start coding while any P0 question is open.
- …

## 17. Notes / references
Links to incidents, ADRs, Slack threads, prior art.
