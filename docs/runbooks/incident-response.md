# Runbook — Incident Response

Owner: platform-security team. Cross-cutting; every capability runbook references this one.

## What it is

The framework every other runbook implicitly assumes. When a sibling runbook says "page returns-platform" or "this is an SEV-2," this document defines what those phrases mean: who pages whom via what channel, what response time is committed for each severity, who runs the incident, and what happens after.

The framework is intentionally lightweight — most production issues are small enough that the runbook for the affected capability already tells you what to do. This document covers the cases where (a) the affected runbook isn't enough, (b) the issue spans multiple capabilities, or (c) the issue is user-visible and requires coordinated communication.

## SEV ladder

The severity tier picks the response shape — pager target, response time, comms cadence, postmortem requirement.

### SEV-1 — Critical, customer-visible, no automatic recovery

Examples:
- API is down (5xx rate > 5% sustained, or `/health/live` returning 5xx)
- Money loss: refunds processed twice, payments captured but order not created, wallet balance drift detected and trending
- Auth bypass: `JWT secret collision` somehow shipped to prod, or `ADMIN_MFA_ENCRYPTION_KEY` lost (every enrolled admin in panic recovery)
- Data corruption: a write that the codebase did not author appears in `admins.passwordHash`, `wallet_balances`, or any money column
- Compliance: a DPDPA / GDPR erasure deadline missed because `ERASURE_PROCESSOR_ENABLED` was off

Response: PagerDuty SEV-1 page goes to the on-call for the owning team AND to the `platform-security` on-call. Response time committed: 5 minutes acknowledged, 15 minutes engaged. Engineering Lead is paged automatically.

### SEV-2 — Significant, partial degradation, mitigation possible

Examples:
- A specific feature is broken (one endpoint 500s, one cron stopped)
- DLQ rate > 0 for the outbox publisher (`transactional-outbox.md`)
- Wallet ledger reconciliation drift detected on one wallet
- Refund-gateway recon found > 10 stuck refunds in the last hour (`refund.gateway.stuck`)
- File integrity verifier emitted a SHA-256 mismatch
- A scheduled cron stopped (heartbeat missed > 2 expected intervals)

Response: PagerDuty SEV-2 page goes to the on-call for the owning team only. Response time committed: 15 minutes acknowledged, 1 hour engaged. Engineering Lead is notified async (no page).

### SEV-3 — Minor, non-customer-visible, can wait for business hours

Examples:
- Single instance of a transient error (`Idempotency key resolution race`)
- A non-critical metric drifted from baseline but the gauge hasn't crossed an alert threshold
- A flag was off in prod that should have been on, caught at the next deploy by the env validator
- A staging-only failure that doesn't recur in prod

Response: filed as a Linear ticket on the owning team's board. No page. Business-hours response committed within one business day.

## Owning teams and their domains

Every page goes to a named team. The owning-team map (consistent with the `Owner:` line at the top of each capability runbook):

| Team | Owns | Pager rotation | Domain |
|---|---|---|---|
| `platform-security` | env validator, secrets management, MFA, encryption-key rotation, migration ordering, the incident-response framework itself | platform-security-oncall | Phases 3 / 6 / 9 / 10 / 11 |
| `returns-platform` | idempotency middleware, transactional outbox, case-duplicate prevention, paise migration, refunds, disputes, returns, SLA breach detection | returns-platform-oncall | Phases 1 / 2 / 7, ADRs 3 / 6 / 7 / 8 |
| `payments` | Razorpay integration, payment-success callback HMAC, refund gateway, COD payouts, wallet ledger | payments-oncall | Razorpay-prefixed envs, wallet recon |
| `files` | S3 client, file integrity verifier, retention enforcer, erasure processor | files-oncall | S3-prefixed envs, KYC docs, evidence files |
| `identity` | customer / seller / admin / franchise / affiliate auth and sessions | identity-oncall | `*_JWT_SECRET` envs, session tables |

If a page lands on the wrong team, the receiving on-call hands it off via PagerDuty's `/transfer` after a quick read of the symptom. Cross-team handoff is friction by design — it forces the page to land somewhere accountable rather than on a generic queue.

## Incident roles

For SEV-1 (and SEV-2 if the issue is widening), three roles activate:

### Incident Commander

One person. Owns the response decision-making. Their job is to keep the incident moving forward — assign tasks, decide rollback vs forward-fix, decide when to call for help. They do NOT do the engineering work themselves; if they're the most-qualified engineer in the room, they should hand command to someone else.

By default, the IC is the on-call who took the page. They can hand off command explicitly ("IC is now <name>") if their attention is needed on the technical work.

### Communications Lead

One person, often the IC themselves on SEV-2, distinct on SEV-1. Owns the status page, customer-comms drafts, and the internal Slack thread cadence (every 15 minutes for SEV-1, every 30 minutes for SEV-2 until the incident closes).

### Engineering Lead

One or more people. Does the actual investigation, fix, deploy. Reports findings to the IC; the IC decides the response.

These are roles, not titles. The same person can hold two roles if the incident is small enough; on a large incident, each role is held by a different person.

## Symptoms & responses

### "How do I know which SEV this is?"

If users are affected right now: SEV-1.
If a feature is degraded but users aren't blocked: SEV-2.
If nothing is currently broken but a guard tripped: SEV-3.

When unsure, escalate up rather than down. A SEV-2 that turns out to be SEV-3 is cheap to downgrade; a SEV-3 that turns out to be a quiet SEV-1 is expensive.

### "Which runbook do I look at?"

Match the symptom to the capability:

- 5xx rate on a specific endpoint → service log + the capability's runbook
- Cron stopped (heartbeat missed) → the capability's runbook (the cron has its own runbook section, usually under "Symptoms & responses")
- Boot failure → `prod-boot-failures.md` (validator error chain)
- Schema-related error (`column does not exist`) → `migration-ordering.md`
- MFA-related issue → `admin-mfa.md`
- Outbox issue → `transactional-outbox.md`
- Idempotency issue → `idempotency-keys.md`
- Paise / money issue → `money-paise-migration.md`
- Case duplicate complaint → `case-duplicate-prevention.md`

If the symptom doesn't map to any runbook, page `platform-security` and we'll write the runbook section in the postmortem.

### "The page woke me up but the symptom isn't in any runbook"

Acknowledge the page. Open the incident channel. Drop the alert payload + log excerpt. Page `platform-security` for triage if the symptom is unfamiliar.

The expected runbook coverage today is the seven capability runbooks tracked by `test/unit/runbooks-coverage.spec.ts` plus the four meta-runbooks (this one, `prod-boot-failures`, `migration-ordering`, `admin-mfa`). A page outside that coverage is itself a finding — record it in the postmortem so the next operator has a runbook to grep.

### "I'm rolling back a deploy mid-incident"

Standard rollback path: `gh workflow run rollback.yml -f sha=<previous-sha>`. The pipeline redeploys the prior image; estimated time-to-restoration is 2-4 minutes.

For env-only rollbacks (flag flips, secret rotations), update the prod secret manager and re-trigger the deploy without changing the image SHA.

Critical: rolling back a deploy that included a schema migration requires reading `migration-ordering.md` first. A blind image rollback when the migration shipped a column the code now writes to leaves the new column unwritten on every subsequent insert — and the next image deploy carries forward the gap.

## Operating envelope

| Setting | Value |
|---|---|
| Page channel | PagerDuty |
| Ticketing channel | Linear |
| Incident channel | Slack `#incidents` (created per-incident as `#inc-YYYYMMDD-<short-name>`) |
| Status page | status.sportsmart.com (Communications Lead owns updates) |
| SEV-1 response time | 5 min ack, 15 min engaged |
| SEV-2 response time | 15 min ack, 1 hr engaged |
| SEV-3 response time | 1 business day |
| SEV-1 comms cadence | 15 min while open |
| SEV-2 comms cadence | 30 min while open |
| Postmortem requirement | SEV-1: always within 5 business days. SEV-2: when the cause is non-obvious or the response was slow. SEV-3: optional. |
| Postmortem template | `docs/templates/postmortem.md` (Phase 11 backlog) |
| On-call handoff cadence | Weekly per team, Monday 10:00 IST |

## Rollback

There is no rollback for this runbook — it's a framework document. What you CAN do during an incident:

1. **Downgrade the SEV** — if a SEV-1 page turns out to be a SEV-2 (e.g. the impact is narrower than the alert suggested), the IC downgrades explicitly in the incident channel. Comms cadence and pager pressure drop accordingly.

2. **Upgrade the SEV** — if a SEV-2 widens, the IC upgrades. Engineering Lead is paged if not already.

3. **Hand off command** — explicit verbal handoff in the incident channel. "<name> is now IC." Old IC then steps back to engineering work.

4. **Call for help** — page another team via PagerDuty's transfer flow. The original page stays open until the issue is resolved; the new team's involvement is additive, not a handoff.

5. **Close the incident** — IC says "incident closed at <time>, postmortem to follow if SEV-1 or by request." Comms Lead posts the final status update. Slack channel stays open for 24h for any follow-up.

## Test in pre-prod

```bash
# 1. Run a quarterly incident drill. Pick a hypothetical: "Razorpay
#    webhook secret was rotated without updating the env." Walk the
#    flow:
#    - Who would notice? (refund-gateway recon cron, customer reports)
#    - Who pages? (alert → payments on-call)
#    - What SEV? (SEV-1 if customers are affected, SEV-2 if just degraded)
#    - Which runbook? (refund-gateway recon section of money-paise-migration.md
#      OR a follow-up dedicated runbook)
#    - Who's IC? Who's Comms? Who's Engineering Lead?
#    The drill is over when the participants agree on the response.

# 2. Verify PagerDuty rotations exist for each named team:
#    platform-security-oncall, returns-platform-oncall, payments-oncall,
#    files-oncall, identity-oncall. Test page to each (during business
#    hours, with the receiver's consent).

# 3. Verify a non-runbooked symptom routes to platform-security.
#    Trigger a contrived alert (e.g. a metric the receiver doesn't
#    have a runbook for). Confirm the page lands on platform-security
#    as the catch-all.

# 4. Postmortem dry-run: pick a recently-closed Linear ticket that
#    would have been a SEV-2. Walk the postmortem template against
#    it. Output should be a 1-2 page document with: timeline,
#    contributing factors, what we did well, what we'd do differently,
#    runbook updates needed.
```

The incident framework is a habit, not a deliverable. The quarterly drill is the gate — if a drill identifies a missing runbook, a missing rotation, or a missing role, those gaps are tracked as Linear tickets on `platform-security`.
