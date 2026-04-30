---
feature: Notifications — admin controllers, template management API, dispatch endpoint
phase: 1
status: planned
owner: unassigned
priority: P1
estimate_days: 5
depends_on:
  - phase-0-foundation/01-fix-typescript-errors.md
  - phase-0-foundation/05-logging-baseline.md
unblocks:
  - phase-2-customer/05-order-tracking.md  (push notifications optional)
  - phase-6-support/01-helpdesk.md          (ticket emails)
---

# Notifications — wire to API

## 1. Context
Today, the API sends order-confirmation emails and WhatsApp messages when an `OrderCreatedEvent` fires (handler exists in `application/event-handlers/order-notification.handler.ts`). However:

- There is **no admin API** to manage templates (subject, body, channel-specific copy).
- There is **no log API** to inspect what was sent, to whom, when, or whether it succeeded.
- There is **no manual-dispatch endpoint** — ops cannot resend a confirmation if the auto-send failed.
- The Prisma schema is **missing `NotificationTemplate` and `NotificationLog`** tables; the domain entities (`notification-template.entity.ts`, `notification-log.entity.ts`) are stubs with one-line fields.

This blocks: (a) editing copy without a code release, (b) debugging "why didn't this customer get an email?", (c) compliance asking "show me every WhatsApp sent in March".

## 2. Current state

| Artifact | Path | Status |
|---|---|---|
| Domain entity (Template) | `apps/api/src/modules/notifications/domain/entities/notification-template.entity.ts` | stub (one-line) |
| Domain entity (Log) | `apps/api/src/modules/notifications/domain/entities/notification-log.entity.ts` | stub (one-line) |
| Repository interfaces | `apps/api/src/modules/notifications/domain/repositories/*.ts` | exist |
| Email port | `apps/api/src/modules/notifications/application/ports/outbound/email-sender.port.ts` | exists |
| WhatsApp port | `apps/api/src/modules/notifications/application/ports/outbound/whatsapp-sender.port.ts` | exists |
| Email adapter | `apps/api/src/modules/notifications/infrastructure/adapters/email.adapter.ts` | exists (SMTP via nodemailer) |
| WhatsApp adapter | `apps/api/src/modules/notifications/infrastructure/adapters/whatsapp.adapter.ts` | exists |
| Prisma repository | `apps/api/src/modules/notifications/infrastructure/persistence/prisma/notifications.prisma-repository.ts` | exists, but no Prisma model to back it |
| Public facade | `apps/api/src/modules/notifications/application/facades/notifications-public.facade.ts` | exists, used by other modules |
| Order event handler | `apps/api/src/modules/notifications/application/event-handlers/order-notification.handler.ts` | working in prod |
| **Prisma `NotificationTemplate` model** | (not present) | **missing** |
| **Prisma `NotificationLog` model** | (not present) | **missing** |
| **Admin controllers** | `presentation/controllers/.gitkeep` only | **missing** |
| **Admin UI** | (none) | **missing** |

## 3. Goals & non-goals

**Goals**
- Admins can list, view, edit, and create notification templates (email + SMS + WhatsApp) via API and UI.
- Admins can search and filter notification logs (by recipient, channel, status, date).
- Ops can re-dispatch a single notification (idempotently) when auto-send failed.
- Every notification dispatched through the system is persisted to `notification_logs` with status (`QUEUED → SENT → DELIVERED → FAILED`).

**Non-goals (deferred)**
- SMS (Twilio/MSG91) — not in current adapter set; do later.
- Push notifications (FCM/APNs) — Phase 8.
- Bulk campaigns / segmentation — out of scope for this feature.
- Customer-side notification preferences page — out of scope; default-on for transactional.

## 4. Architecture decisions

- **Templates stored in DB, not code.** **Why:** ops must change copy without a deploy. Templates have versions; the latest active version is rendered.
- **Render via Handlebars** (already a transitive dep). **Why:** safe, well-known, no expressions that can execute code.
- **Logs are append-only.** **Why:** compliance and debug. No update except status transitions; no delete.
- **Use the existing event-driven flow** (modules emit events; notifications listens and dispatches). **Why:** preserves loose coupling. Don't refactor existing handlers.
- **Idempotency on re-dispatch** keyed by `notification_log.id`. **Why:** prevents accidental double-send when ops retries.

## 5. API surface

All endpoints under `AdminAuthGuard` + permission `notifications:manage`.

| Method | Path | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/v1/admin/notifications/templates` | `?channel=&search=&page=` | paginated list | |
| GET | `/api/v1/admin/notifications/templates/:id` | — | `NotificationTemplate` | |
| POST | `/api/v1/admin/notifications/templates` | `CreateTemplateDto` | created | |
| PATCH | `/api/v1/admin/notifications/templates/:id` | `UpdateTemplateDto` | bumps version |
| POST | `/api/v1/admin/notifications/templates/:id/activate` | — | activates this version, deactivates others with same `key` |
| GET | `/api/v1/admin/notifications/logs` | `?recipient=&channel=&status=&from=&to=&page=` | paginated list | |
| GET | `/api/v1/admin/notifications/logs/:id` | — | full log + payload | |
| POST | `/api/v1/admin/notifications/logs/:id/redispatch` | — | enqueues retry | idempotent on log id |
| POST | `/api/v1/admin/notifications/dispatch` | `{ key, channel, recipientId, params }` | log id | manual one-off |
| POST | `/api/v1/admin/notifications/test-render` | `{ templateId, params }` | `{ subject, body }` | dry-run, no send |

DTOs go in `presentation/dtos/`. Existing `send-notification.dto.ts` is a starting point.

## 6. Data model changes

Add to `apps/api/prisma/schema/notifications.prisma` (new file):

```prisma
enum NotificationChannel { EMAIL  SMS  WHATSAPP  PUSH }
enum NotificationStatus  { QUEUED SENT DELIVERED FAILED }

model NotificationTemplate {
  id          String              @id @default(cuid())
  key         String              // e.g. "order.placed", "return.approved"
  channel     NotificationChannel
  version     Int                 @default(1)
  isActive    Boolean             @default(false)
  subject     String?             // EMAIL only
  body        String              // Handlebars source
  metadata    Json?
  createdBy   String
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt
  @@unique([key, channel, version])
  @@index([key, channel, isActive])
}

model NotificationLog {
  id          String              @id @default(cuid())
  templateKey String
  channel     NotificationChannel
  recipientId String              // user/seller/franchise/affiliate id
  recipientTo String              // email or phone (denormalised)
  status      NotificationStatus  @default(QUEUED)
  payloadIn   Json                // params used to render
  rendered    Json                // {subject?, body} after render
  providerRef String?             // SES/Twilio/WhatsApp message id
  error       String?             @db.Text
  attempts    Int                 @default(0)
  sentAt      DateTime?
  deliveredAt DateTime?
  failedAt    DateTime?
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt
  @@index([recipientId])
  @@index([status, createdAt])
  @@index([templateKey, channel, createdAt])
}
```

**Backfill / migration strategy:** none — net-new tables. Existing `order-notification.handler.ts` will need a small change to also write to `notification_logs` after dispatch (one-line addition, covered in tasks).

## 7. Events emitted/consumed

- **Consumes (already wired):** `OrderCreatedEvent`, `OrderShippedEvent`, `ReturnApprovedEvent` from `orders` and `returns`.
- **Consumes (new):** none required, but prepare for future consumption from `disputes`, `payouts`, `helpdesk`.
- **Emits:** `NotificationDispatchedEvent` (template key, recipient, channel, log id) — useful for downstream observability counters.

## 8. Frontend impact

Admin UI lives in `apps/web-admin/src/app/dashboard/notifications/*`.

| App | Route | Components | Notes |
|---|---|---|---|
| `web-admin` | `/dashboard/notifications/templates` | `TemplateList`, `TemplateEditor` | rich text editor reused from `@sportsmart/ui` |
| `web-admin` | `/dashboard/notifications/templates/[id]` | `TemplateEditor`, `VersionHistory` | preview pane with sample params |
| `web-admin` | `/dashboard/notifications/logs` | `LogTable`, `LogFilters` | filter by recipient/channel/status/date |
| `web-admin` | `/dashboard/notifications/logs/[id]` | `LogDetail`, `RedispatchButton` | shows rendered output + provider response |

## 9. Edge cases

| Scenario | Expected behavior |
|---|---|
| Template missing for an event firing | Log a `NotificationLog` with status FAILED + `error="template not found"`, do NOT throw — never block the source event |
| Render fails (bad Handlebars or missing param) | Status=FAILED, `error` includes the missing key, no retry |
| SMTP/WhatsApp provider 5xx | Status remains QUEUED, `attempts++`, retry via job queue with exponential backoff (max 3) |
| SMTP/WhatsApp provider 4xx (bad address) | Status=FAILED, `error=provider message`, no retry |
| Redispatch on already-DELIVERED log | 409 Conflict, no re-send |
| Redispatch on FAILED log | Allowed; creates a new log row referencing the original (`metadata.redispatchOf=<origId>`) |
| Two activations of templates with the same `(key, channel)` race | Wrap activate in a transaction that deactivates all other versions of `(key, channel)` first |
| Recipient ID exists but `email`/`phone` is null | Status=FAILED, `error="recipient missing contact"`, surface in admin so they can update the user |
| Notification sent to a soft-deleted recipient | Block — return 422 to caller |
| PII redaction in logs | `payloadIn` stored in full but redacted in API responses to admins without `notifications:view-pii` permission |

## 10. Failure modes & rollback
- **Worst case if shipped broken:** automatic order/return notifications stop, customers don't hear back, but no money is at risk.
- **Rollback:** revert the controller PR; the existing event handler keeps working as before. The DB tables and adapters are independent.
- **Blast radius:** all transactional notifications. Mitigate by feature flag `notifications.useDbTemplates` — when false, falls back to hardcoded copy.

## 11. Security & compliance
- All admin endpoints behind `AdminAuthGuard` + permission `notifications:manage` (read endpoints can use `notifications:view`).
- Log rows contain rendered email bodies — treat as PII. Restrict full-body access to roles with `notifications:view-pii`.
- Audit: every template create/update/activate must hit `audit_logs` (admin id, before/after diff).
- Rate limit on `/dispatch` and `/redispatch`: 100/min per admin to prevent accidental floods.

## 12. Observability
- Log: `notification.dispatched`, `notification.delivered`, `notification.failed` with structured fields (templateKey, channel, recipientId, logId).
- Metrics: counter `notifications_total{channel,status}`; histogram `notification_dispatch_duration_seconds{channel}`.
- Alerts: (i) FAILED rate >5% over 10m for any channel pages oncall; (ii) QUEUED depth >500 for >5m.

## 13. Test plan
- **Unit:** template render with missing param raises `RenderError`; activate-deactivate other versions in transaction; idempotent redispatch.
- **Integration:** controller happy path + each edge case in §9; auth/permission checks; rate limit.
- **E2E manual:**
  1. Create email template `order.placed` v1 → activate.
  2. Place an order → confirm log row created and email arrives.
  3. Edit copy → save as v2 → activate v2 → place another order → confirm v2 copy used.
  4. Filter logs by status=FAILED → should be empty.
  5. Manually redispatch a SENT log → 409.
  6. Dispatch to a soft-deleted user → 422.

## 14. Tasks (ordered, ≤½ day each)
1. Add Prisma schema in `notifications.prisma`; run `prisma migrate dev --name notifications-tables`.
2. Replace stub domain entities with full `NotificationTemplate`/`NotificationLog` aggregates (validation in domain).
3. Implement `NotificationTemplate` repository (Prisma) + tests.
4. Implement `NotificationLog` repository (Prisma) + tests.
5. Application service: `NotificationDispatcherService` (render → adapter → log). Reuse existing ports.
6. Add Handlebars-based `TemplateRenderer` infra service.
7. Update `order-notification.handler.ts` to call the new dispatcher (delete old direct adapter call).
8. Controller: `AdminNotificationsTemplatesController` + DTOs + Swagger.
9. Controller: `AdminNotificationsLogsController` + redispatch endpoint.
10. Permission: register `notifications:manage`, `notifications:view`, `notifications:view-pii` in identity seeder.
11. Frontend: `web-admin` template list + editor pages.
12. Frontend: `web-admin` log table + detail page + redispatch button.
13. Audit hooks on template create/update/activate.
14. Rate limit middleware on dispatch/redispatch.
15. Smoke test against dev DB.
16. Update `STATUS_TRACKER.md`.

## 15. Acceptance criteria
- [ ] All §5 endpoints responding with correct codes (verified via curl/Postman).
- [ ] Every §9 edge case has a test that catches its regression.
- [ ] Migration runs cleanly on a fresh DB and on the existing `sportsmart_dev`.
- [ ] Admin UI loads at `localhost:4001/dashboard/notifications/{templates,logs}` and round-trips against API on `:8000`.
- [ ] Order placed → log row appears within 5s; email/WhatsApp received.
- [ ] No new TS or lint errors introduced.
- [ ] `STATUS_TRACKER.md` flipped to `done`.
- [ ] ADR not required (this is wiring of existing decisions).

## 16. Open questions
- Do we need SMS in this feature, or can it be deferred? (Default: defer.)
- Which provider for WhatsApp — current adapter wraps which API? Need to verify before implementing template variables that depend on provider syntax.
- Audit log granularity: every body edit, or only activation events? (Default: every edit, with diff.)

## 17. Notes / references
- Existing event handler: `apps/api/src/modules/notifications/application/event-handlers/order-notification.handler.ts`
- Existing adapters: `apps/api/src/modules/notifications/infrastructure/adapters/{email,whatsapp}.adapter.ts`
- ADR `001-strict-modular-monolith.md` (do not call repositories across module boundaries; use the public facade).
