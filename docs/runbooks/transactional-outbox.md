# Runbook — Transactional Outbox

Owner: returns-platform team. ADR-008.

## What it is

Five-flag staged cutover that makes domain-event delivery durable. Writers persist `outbox_events` rows in the same DB transaction that mutates the aggregate; a publisher cron drains them; handlers dedupe via `event_deduplication`.

## Deploy checklist (Phase 2)

```bash
# 1. Apply schema migration. No code path activates yet.
pnpm --filter @sportsmart/api prisma:deploy

# 2. STAGING: turn the feature on.
echo 'OUTBOX_ENABLED=true'      >> staging.env
echo 'OUTBOX_DUAL_WRITE=true'   >> staging.env
echo 'EVENT_DEDUP_ENABLED=true' >> staging.env
# Keep OUTBOX_AUTHORITATIVE=false for the soak.

# 3. Soak for 2 weeks. Watch outbox_events drain (see queries below).
#    Verify zero double-emission (dedup table grows monotonically with no gaps).

# 4. Once parity is confirmed, flip authoritative.
echo 'OUTBOX_AUTHORITATIVE=true' >> staging.env
# Re-deploy. Env validator refuses boot if AUTHORITATIVE=true without
# ENABLED + DUAL_WRITE.

# 5. Repeat in prod.
```

## Health queries

### Pending depth + age

```sql
SELECT
  count(*)                                    AS pending,
  min(created_at)                             AS oldest,
  max(attempts)                               AS worst_retries,
  max(extract(epoch from now() - created_at)) AS oldest_age_seconds
FROM outbox_events
WHERE state = 'PENDING';
```

A growing `pending` or `oldest_age_seconds` > a few seconds means the publisher is behind. `worst_retries` close to `OUTBOX_MAX_ATTEMPTS` (default 10) means a listener is failing.

### DLQ rate (events that gave up)

```sql
SELECT date_trunc('hour', dead_at) AS hour, count(*)
FROM outbox_dead_letters
WHERE dead_at > now() - interval '24 hours'
GROUP BY 1 ORDER BY 1;
```

DLQ rate should be 0 in steady state. Anything non-zero is an SEV-2.

### Dedup hit-rate (replays caught)

```sql
SELECT handler, count(*) AS consumed_count
FROM event_deduplication
WHERE consumed_at > now() - interval '1 hour'
GROUP BY 1 ORDER BY 2 DESC;
```

This is the count of times a handler ran. Compare to the count of events published — if equal, no replays caught. If lower, the helper is working.

## Symptoms & responses

### Pending depth growing without bound

The publisher cron isn't ticking, OR every event is failing.

```bash
# 1. Is the publisher running?
grep "Outbox publisher" <api-log-stream> | tail -20

# 2. Is the Redis lock stuck (e.g. crashed instance held it)?
redis-cli get lock:outbox-publisher
# If non-empty and old: redis-cli del lock:outbox-publisher
```

If the publisher is running but every dispatch fails: pull a sample row's last_error.

```sql
SELECT id, event_name, attempts, last_error, next_attempt_at
FROM outbox_events
WHERE state = 'PENDING' AND attempts > 0
ORDER BY next_attempt_at LIMIT 10;
```

### A specific event replays hundreds of times

Handler is failing every dispatch. Possible causes:

- The handler depends on something that doesn't exist for that event (FK to a deleted aggregate, missing config).
- The handler throws on a payload shape it doesn't recognize (event-version mismatch).
- The handler dedup is broken (every retry counts as "first time" because `eventId` differs across retries).

Inspect:

```sql
SELECT id, event_name, attempts, last_error
FROM outbox_events
WHERE state = 'PENDING'
ORDER BY attempts DESC
LIMIT 5;
```

Fix the listener, then either:

- Wait — the row will retry on the next backoff and now succeed.
- Force immediate retry: `UPDATE outbox_events SET next_attempt_at = now() WHERE id = '...';`

### Replay an event from the dead-letter table

```sql
INSERT INTO outbox_events (id, event_name, aggregate, aggregate_id, payload, occurred_at, state)
SELECT gen_random_uuid(), event_name, aggregate, aggregate_id, payload, now(), 'PENDING'
FROM outbox_dead_letters
WHERE id = '<dlq-row-id>';

-- Optional: drop the dead-letter row once replay succeeds
DELETE FROM outbox_dead_letters WHERE id = '<dlq-row-id>';
```

The replayed row gets a NEW id, so handler dedup considers it a fresh event and runs. This is intentional — a DLQ replay should re-fire the side-effect.

### Boot fails with "OUTBOX_AUTHORITATIVE=true requires …"

The env-schema interlock fired. Fix: turn on the missing flags before flipping authoritative:

```bash
# Right order:
OUTBOX_ENABLED=true       # publisher cron drains rows
OUTBOX_DUAL_WRITE=true    # writers create outbox rows
OUTBOX_AUTHORITATIVE=true # publisher is sole emitter
```

### Direct emit broken because authoritative is on but cron isn't running

Symptoms: events are being written to `outbox_events` (good) but no listeners ever fire (bad). The boot check should have caught this — if you're seeing this in prod, somebody bypassed the validator.

Immediate response: flip `OUTBOX_AUTHORITATIVE=false`. Direct emit resumes. Restart pubilsher cron.

## Operating envelope

| Knob | Default | Recommended |
|---|---|---|
| `OUTBOX_ENABLED` | false | true after staging soak |
| `OUTBOX_DUAL_WRITE` | false | true after staging soak |
| `OUTBOX_AUTHORITATIVE` | false | true after 2-week soak |
| `EVENT_DEDUP_ENABLED` | false | true after staging soak |
| `OUTBOX_POLL_INTERVAL_MS` | 1000 | 1000-5000 depending on event-rate |
| `OUTBOX_BATCH_SIZE` | 100 | tune up if pending depth grows |
| `OUTBOX_MAX_ATTEMPTS` | 10 | bump to 20 only after the underlying retry-backoff is verified well-tuned |

## Rollback

Set `OUTBOX_AUTHORITATIVE=false`. Direct emit resumes immediately. Existing outbox rows stay in `state=PENDING` and continue to be drained by the publisher (so listeners are now hit twice — once via direct emit, once via outbox — until the dual-write flag is also turned off).

To fully disable: `OUTBOX_DUAL_WRITE=false` (no new outbox rows), `OUTBOX_ENABLED=false` (publisher stops).

Schema (`outbox_events`, `outbox_dead_letters`, `event_deduplication`) can stay indefinitely. They're additive.

## Test in pre-prod

```bash
# 1. Confirm the publisher is ticking.
curl localhost:8000/api/v1/health/live

# 2. Trigger a money event (e.g. dispute decision).
curl -X POST $API/admin/disputes/<id>/decide ... -d '{"outcome":"RESOLVED_BUYER","amountInPaise":50000,"rationale":"..."}'

# 3. Verify the outbox row was created (within the same tx as the dispute update).
psql -c "SELECT id, event_name, state, attempts FROM outbox_events ORDER BY created_at DESC LIMIT 1;"
# state should be PENDING for ≤1 second, then PUBLISHED.

# 4. Verify the wallet credit landed (proves end-to-end delivery).
psql -c "SELECT amount_in_paise FROM wallet_transactions WHERE reference_id = 'dispute:<id>' ORDER BY created_at DESC LIMIT 1;"
# Should be 50000.

# 5. Verify dedup is preventing replays — manually re-emit:
psql -c "UPDATE outbox_events SET state='PENDING', next_attempt_at=now() WHERE id='<id>';"
# Wait 1s.
# Wallet should have ONE row, not two.
```
