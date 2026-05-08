# ADR-005: Problem-Details (RFC 7807) Error Envelope

**Status**: Accepted

**Date**: 2026-05-05

**Phase**: 1.3 of the 10-phase Returns + Disputes redesign

## Context

Today every error response uses an ad-hoc shape:

```json
{
  "success": false,
  "message": ["X-Idempotency-Key header is required"],
  "code": "BAD_REQUEST",
  "timestamp": "2026-05-05T11:23:45.000Z"
}
```

That worked while the API only had one client, but Phase 10 will expose
a public partner API. Public clients need:

* A **stable, dereferenceable type identifier** so they can switch on
  error kind without parsing free-text messages.
* Structured **field-level breakdown** for validation failures (today
  every validator message lands in `message: [...]` as a flat array).
* A **standard the rest of the industry already speaks** — Stripe,
  PayPal, Twilio, AWS, Microsoft Graph all use Problem Details (or a
  near-equivalent) for their error envelopes.

[RFC 7807 — Problem Details for HTTP APIs](https://datatracker.ietf.org/doc/html/rfc7807)
defines the canonical envelope. Modern frameworks ship support out of
the box (ASP.NET Core, Spring Boot 3, Quarkus, FastAPI via plugins).

## Decision

Add a Problem-Details emit path to `GlobalExceptionFilter`, gated by
`PROBLEM_DETAILS_ENABLED`. When ON, every error response uses
`Content-Type: application/problem+json` with this shape:

```json
{
  "type":      "https://api.sportsmart.com/problems/idempotency-key-conflict",
  "title":     "Conflict",
  "status":    409,
  "detail":    "X-Idempotency-Key was reused with a different request body",
  "instance":  "/api/v1/customer/returns",
  "code":      "CONFLICT",
  "timestamp": "2026-05-05T11:23:45.000Z",
  "errors": [
    { "field": "subOrderId", "message": "subOrderId must be a UUID" }
  ]
}
```

* `type` — stable URI built from `PROBLEM_DETAILS_BASE_URI` + a
  per-error slug declared in `core/filters/problem-types.ts`. Adding a
  new error class also adds a slug. Slugs are kebab-case, never
  renamed, and serve as the long-term partner-facing identifier.
* `title` — short, fixed by HTTP status / app code. Suitable as a UI
  banner.
* `status` — duplicates the HTTP status for clients that can't read
  status codes (e.g. some webhook playbacks).
* `detail` — human-readable. May include user-supplied text. The only
  field that can vary across the same `type`.
* `instance` — request URI. Useful for logs / support tickets.
* `code` — kept from the legacy shape so existing log searches keep
  working. Equivalent to a coarser `type`.
* `errors` (extension, RFC 7807 §3.2) — populated for class-validator
  failures so frontends can highlight the offending field.

### Why a flag rather than a hard cutover

Frontends that parse `body.success === false` continue to work at
flag-OFF. Staging flips it on first; FE teams update parsers; prod
follows. After a full release cycle we can drop the legacy emit path.

### Single normalizer, two emit paths

Translation logic (HttpException, AppException, Prisma errors,
unknowns) lives in **one** method (`normalizeException`) producing a
`NormalizedError` struct. Both legacy and RFC 7807 emit paths read
from that struct. Consequence: behaviour changes (e.g. mapping a new
Prisma code) only happen in one place.

## Consequences

### Positive

* Public-API ready. Stripe-comparable error contract for partners.
* Validation errors expose field info instead of a flat string array.
* Stable problem-type URIs let partners write switch-on-error code
  that survives wording changes to the human-readable `detail`.
* Single filter, single behaviour shift, single env knob — no
  filter ordering surprises.

### Negative / costs

* Frontend teams need to update error parsers when the flag flips.
  Mitigated by the dual-shape interim window.
* `application/problem+json` content type may break naive monitoring
  tools that hard-code `application/json`. Most modern tools accept
  any `+json` suffix per RFC 6839; verify in pre-prod.

### Risks and rollback

* **Risk**: a legacy frontend hard-codes a parse on `body.message[0]`
  and breaks at flag-flip. Mitigated by keeping flag OFF in prod
  until staging soaks for 2 weeks and FE teams confirm parsers updated.
* **Rollback**: set `PROBLEM_DETAILS_ENABLED=false`. Filter degrades
  immediately — the legacy emit path is still compiled in.

## Alternatives considered

* **Custom envelope, partner-API only.** Doesn't help internal callers
  (idempotency, validation, FSM). Two error shapes is worse than one.
* **JSON:API errors.** Heavier and over-engineered for our error
  surface. RFC 7807 is the smallest standard that does what we need.
* **GraphQL `errors[]`.** We're REST-first; consider when/if GraphQL
  is added.

## Stable type slug catalog (initial)

See `apps/api/src/core/filters/problem-types.ts` for the live list.
The slugs declared today:

| Slug | When |
|---|---|
| `bad-request` / `unauthorized` / `forbidden` / `not-found` / `conflict` / `unprocessable-entity` / `rate-limited` / `internal-error` / `upstream-gateway-error` | Generic by HTTP status |
| `validation-failed` | Any class-validator BadRequestException |
| `idempotency-key-missing` / `-invalid` / `-conflict` / `-in-flight` | Phase 1.1 |
| `return-window-expired` / `return-already-requested` / `return-not-eligible` / `forfeit-consent-required` / `evidence-required` | Returns (Phase 5+) |
| `dispute-already-decided` / `dispute-fsm-transition-denied` | Disputes (Phase 5+) |
| `permission-denied` / `resource-policy-denied` | Authorization (Phase 4+) |

## References

* RFC 7807 — Problem Details for HTTP APIs: https://datatracker.ietf.org/doc/html/rfc7807
* IETF draft: extensions to RFC 7807 — https://datatracker.ietf.org/doc/draft-ietf-httpapi-rfc7807bis/
* Stripe API errors: https://stripe.com/docs/api/errors
* JSON:API errors (for the `errors[]` extension precedent): https://jsonapi.org/format/#errors
