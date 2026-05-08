# Runbook — Idempotency Keys

Owner: returns-platform team. ADR-003.

## What it is

A small middleware that lets clients retry-safely on the seven endpoints
listed in ADR-003. Backed by the `idempotency_keys` Postgres table.

## Symptoms you might see

### "Idempotency key resolution race; please retry" (HTTP 409)

Vanishingly rare. Means: a client INSERTed a PENDING row, then before
they could read the row back to confirm replay semantics, another
process (the sweeper, or a manual cleanup) removed it. Client retry
will succeed.

**Action**: none unless it's spamming. If >1/min, page returns-platform.

### "X-Idempotency-Key was reused with a different request body" (HTTP 409)

A client misuse — they sent the same key with a changed body. The
server is correctly refusing to silently overwrite.

**Action**: surface the client/partner to ops; ask them to use a fresh
UUID per logical operation.

### "A previous request with this idempotency key is still being processed" (HTTP 409)

Two of the same request landed within ~60 seconds. Common when a
mobile retry beat the original.

**Action**: client should retry with backoff. If you see thousands of
these, look at handler latency — something is taking longer than 60s.

### Table growing unboundedly

Sweeper cron isn't running. Symptoms: `idempotency_keys` row count
climbing, oldest row > `expires_at + a few hours`.

**Action**:
1. `pnpm --filter @sportsmart/api logs | grep idempotency-sweeper` —
   confirm the cron actually ticks.
2. If it never logged: `IDEMPOTENCY_ENABLED` is `false` (sweeper
   skips when feature is off, by design — but expired rows shouldn't
   exist either, so look at history of when the flag flipped).
3. If it ticks but `count` grows: bump `IDEMPOTENCY_SWEEP_INTERVAL_MINUTES`
   down or run a one-shot manual sweep:
   ```sql
   DELETE FROM idempotency_keys
    WHERE state = 'COMPLETED' AND expires_at < now();
   DELETE FROM idempotency_keys
    WHERE state = 'PENDING'  AND created_at < now() - interval '60 seconds';
   ```

### Replays returning stale data

Customer says: "I created a return, refreshed, and now I see an old
return that doesn't match what I just typed."

**Likely cause**: the request hash collided OR (more probable) the
client is reusing an idempotency key across logical requests.

**Action**:
1. Pull the row: `SELECT key, request_hash, response_status, created_at FROM idempotency_keys WHERE key = '...';`
2. Verify the timestamp matches the original creation (not a replay).
3. If hash collision is suspected (extremely unlikely with sha256),
   page returns-platform.

## Operating envelope

| Knob | Default | Recommended |
|---|---|---|
| `IDEMPOTENCY_ENABLED` | `false` | `true` after PR 1.6 |
| `IDEMPOTENCY_TTL_HOURS` | 24 | 24 (Stripe-equivalent) |
| `IDEMPOTENCY_SWEEP_INTERVAL_MINUTES` | 15 | 15 |

## Rollback

Setting `IDEMPOTENCY_ENABLED=false` reverts the system to today's
behaviour with **no schema rollback**. The table can be left in place
indefinitely. If you ever want it gone, drop after the flag has been
off for a full TTL cycle (24h) so no in-flight client expects a replay.

## Test in pre-prod

```bash
KEY=$(uuidgen)

# First call — creates the return
curl -X POST https://api-staging.sportsmart.com/api/v1/customer/returns \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Idempotency-Key: $KEY" \
  -H "Content-Type: application/json" \
  --data '{"subOrderId":"...","items":[...],"forfeitConsent":true,"evidenceFileUrls":["..."]}'

# Replay — same key, same body, must return identical body and not create a new return
curl -X POST ... -H "X-Idempotency-Key: $KEY" --data '<same body>'

# Conflict — same key, changed body, must 409
curl -X POST ... -H "X-Idempotency-Key: $KEY" --data '<different body>'
```

`SELECT count(*) FROM returns WHERE created_at > now() - interval '5 min';`
should be `1`, not `2`.
