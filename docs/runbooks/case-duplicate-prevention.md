# Runbook — Case Duplicate Prevention

Owner: returns-platform team. ADR-006.

## What it is

Application-level guard at the create-paths for returns / disputes / tickets, gated by `CASE_DUPLICATE_PREVENTION_ENABLED`. Rejections return HTTP 409 with type `https://api.sportsmart.com/problems/duplicate-case` and a `duplicateOfId` extension pointing at the existing active case.

## Symptoms

### Sudden spike in 409 `duplicate-case`

Either (a) the rules are too tight, (b) we just shipped a feature that legitimately retries a create, or (c) genuine duplicate-attempt abuse.

**Action**:

1. `SELECT reason, count(*) FROM case_duplicates WHERE created_at > now() - interval '1 hour' GROUP BY reason ORDER BY 2 DESC;` — which rule is firing?
2. If skewed to one `actor_id`, check that actor for abuse / a buggy retry loop.
3. If skewed across many actors but tightly to one `reason`, the rule may need loosening — refer to ADR-006 + Phase 5 changes.

### Customers complain "system says I have an open return but I don't see one"

Likely cause: the existing return is in a state the customer's UI hides (e.g. PICKUP_SCHEDULED but they cancelled the courier informally).

**Action**:

```sql
-- Find the duplicate-of return for the affected order item.
SELECT r.id, r.return_number, r.status, r.created_at, r.closed_at
FROM returns r
JOIN return_items ri ON ri.return_id = r.id
WHERE ri.order_item_id = '<orderItemId>'
ORDER BY r.created_at DESC;
```

If the existing return is genuinely abandoned: cancel it via the admin UI, then the customer can submit a new one.

### Rule fires but no `case_duplicates` row written

Audit-write is best-effort by design. A failure here logs an error but does NOT block the user-visible 409 — the customer correctly sees the rejection. Find the log:

```
grep "case-duplicate audit write failed" <api-log-stream>
```

Investigate the underlying DB error (usually a connection-pool exhaustion event, not a per-write logic bug).

### A legitimate scenario keeps tripping the rule

Examples:

* Customer's first return for `orderItem-A` was `REJECTED` last month; under the forfeit policy they can't resubmit (handled by `ReturnEligibilityService.validateReturnRequest`'s `previouslyRejected` check, not by R1). If the customer is hitting R1 in this scenario, the rule's inactive list may be wrong — verify `ReturnInactiveStatuses` in `case-duplicate.service.ts`.
* Two distinct disputes legitimately needed for the same order — different kinds (R3 already supports this; double-check the `kind` arg matches).
* Admin needs to file a duplicate ticket intentionally — pass `allowDuplicate: true` (R4 supports this; only admins should ever set the flag).

## Tightening race tolerance (when needed)

Today's rule is SELECT-then-throw and accepts a small concurrent-create window. If Phase 5 makes the rule load-bearing for downstream money flows, two upgrades are queued:

1. **Postgres advisory locks**:

   ```ts
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('return-create:' || ${orderItemId}, 0))`;
   ```

   Add inside `validateReturnRequest`'s wrapping transaction. Cheap. Limits concurrent creates per natural key to 1.

2. **Denormalised active-key column**:

   ```sql
   ALTER TABLE return_items ADD COLUMN active_dedup_key TEXT
     GENERATED ALWAYS AS (
       CASE WHEN return_id IN (SELECT id FROM returns WHERE status NOT IN (...))
            THEN order_item_id
            ELSE NULL
       END
     ) STORED;
   CREATE UNIQUE INDEX ON return_items (active_dedup_key) WHERE active_dedup_key IS NOT NULL;
   ```

   Stronger guarantee; higher schema cost; non-trivial migration.

Make the call when Phase 5 ships and we have real duplicate-attempt rate data.

## Operating envelope

| Knob | Default | Recommended |
|---|---|---|
| `CASE_DUPLICATE_PREVENTION_ENABLED` | `false` | `true` after PR 1.6 staging soak |

## Rollback

Set the flag to `false`. Existing `case_duplicates` rows can stay (they're audit data). No schema rollback needed.

## Test in pre-prod

```bash
# Create a return — succeeds.
curl -X POST $API/customer/returns ... -d '{ "subOrderId": "...", "items": [{ "orderItemId": "X", ...}], ... }'

# Try to create another return for the SAME orderItemId — must 409.
curl -X POST $API/customer/returns ... -d '{ "subOrderId": "...", "items": [{ "orderItemId": "X", ...}], ... }'
# →  409
# Body should include:  type: ".../duplicate-case",  duplicateOfId: "RET-2026-...",  rule: "ACTIVE_RETURN_EXISTS_FOR_ORDER_ITEM"

# Verify the audit row exists.
psql -c "SELECT reason, attempted_natural_key, duplicate_of_source_id FROM case_duplicates ORDER BY created_at DESC LIMIT 1;"
```
