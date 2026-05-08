# Phase 10 — Public API, webhooks, sandbox, OpenAPI runbook

**Owner**: Platform / Partnerships
**ADR**: [015 — Public API keys, webhooks, sandbox mode, OpenAPI split](../decisions/015-public-api-webhooks-sandbox.md)
**Status**: Ready

Final-phase runbook. Four independent surfaces.

## Pre-flight

```bash
pnpm --filter @apps/api exec prisma migrate deploy
```

Required tables:
* `api_keys`, `api_key_usages` (PR 10.1)
* `webhook_endpoints`, `webhook_deliveries` (PR 10.2)

## Surface 1 — API key issuance

Phase 10 ships `ApiKeyService` but no admin controller. To mint a
key today, use the service from a one-off script or insert directly:

```ts
// apps/api/scripts/mint-api-key.ts
import { ApiKeyService } from '../src/core/api-keys/api-key.service';
// … wire prisma + service …
const out = await keys.mint({
  name: 'Acme partner integration',
  environment: 'LIVE',
  scopes: ['orders:read', 'refunds:read'],
});
console.log(out.plaintextKey); // shown ONCE
```

The plaintext starts with `sk_live_` or `sk_test_`. Hand it to the
partner over a secure channel (1Password, signed email).

### Verify a key works

```bash
curl -H "Authorization: Bearer sk_live_abcd…" \
  https://api.production.example.com/public/v1/<endpoint>
```

(No public endpoints exist in v1; the path returns 404, but the
auth check happens first — so 401 means invalid key, 404 means
valid key + missing route.)

### Revoke

```bash
# In production:
psql ... -c "UPDATE api_keys SET status='REVOKED', revoked_at=NOW(), revoked_by='admin@…' WHERE id='…'"
```

The next request from that key 401s within a few seconds (no cache —
`ApiKeyService.verify()` reads fresh).

### Rate-limit tuning

Per-key:
```sql
UPDATE api_keys SET rate_limit_per_minute = 600 WHERE id = '…';
```

Global default in env: `API_DEFAULT_RATE_PER_MINUTE` (default 60).

## Surface 2 — Webhooks

### Add a partner endpoint

```sql
INSERT INTO webhook_endpoints
  (id, name, url, signing_secret, event_types, environment, status, created_at, updated_at)
VALUES
  (gen_random_uuid(),
   'Acme returns',
   'https://acme.com/webhooks/sportsmart',
   '<long-random-secret>',
   ARRAY['returns.*', 'disputes.*'],
   'LIVE',
   'ACTIVE',
   NOW(), NOW());
```

Generate the signing secret with `openssl rand -base64 32`. Share
it with the partner once.

### Flip the cron on

The delivery cron is **not** included in the PR set — it's a
follow-up wiring step. Until then, `WebhookDeliveryService.enqueue()`
populates `webhook_deliveries` rows but nothing fans them out. To
verify enqueue works:

```sql
SELECT id, event_name, status, attempts FROM webhook_deliveries
ORDER BY created_at DESC LIMIT 10;
```

Expect rows with `status='PENDING'` after domain events fire.

### Partner-side verification

Document the format with partners:

```
Header: X-Webhook-Signature: t=<unix_seconds>,v1=<hex_sha256>

Verification:
  signed_input = `${t}.${rawRequestBody}`
  expected_v1 = HMAC_SHA256(signing_secret, signed_input)
  match expected_v1 against the v1= field in constant time
  reject if |now - t| > 300
```

The `verifyPayload` reference helper in
`src/core/webhooks/webhook-signer.ts` is the canonical implementation.

### Manual redeliver

A failed delivery row sits at `status=FAILED_RETRY` with
`next_retry_at` set; the cron picks it up. To force a re-attempt now:

```sql
UPDATE webhook_deliveries SET next_retry_at = NOW() WHERE id = '…';
```

## Surface 3 — Sandbox mode

### Mint a TEST key

```ts
const out = await keys.mint({
  name: 'Acme integration — test',
  environment: 'TEST',
  scopes: ['orders:read', 'refunds:write'],
});
```

Partner uses the same scopes against the same routes. Domain code
that calls `sandbox.isTest(req)` returns the fake response.

### Adoption pattern

In a refund-issuing handler:

```typescript
@Post('refunds')
@UseGuards(ApiKeyAuthGuard)
async issueRefund(@Req() req: any, @Body() body: IssueRefundDto) {
  if (this.sandbox.isTest(req)) {
    return this.sandbox.fakeRefundResponse({
      refundId: body.refundId,
      amountInPaise: body.amountInPaise,
    });
  }
  // … real flow …
}
```

This is per-handler; Phase 10 doesn't auto-stub anything.

### Defensive guardrail

Inside any code path that must NEVER run on test traffic (e.g.
calling the live email provider):

```typescript
this.sandbox.assertLiveOnly(req, 'send-real-customer-email');
```

Throws when `req.apiKey.environment === 'TEST'`.

## Surface 4 — OpenAPI

After deploy, two specs exist:

* `https://api.production.example.com/api/docs` — internal
  (everything we have, JWT auth scheme).
* `https://api.production.example.com/public/v1/docs` — partner
  surface (only routes mounted under `/public/v1/`, API-key auth
  scheme).

Until the first `/public/v1/` controller ships, the partner spec
renders an empty `paths {}` block — that's expected.

### Adding a public endpoint

1. Mount the controller under `/public/v1/...`:
   ```typescript
   @Controller('public/v1/orders')
   ```
2. Apply `@UseGuards(ApiKeyAuthGuard)`.
3. Decorate route handlers with `@ApiTags(...)` so Swagger groups
   them sensibly.
4. Document request + response DTOs with `@ApiProperty`.

The partner spec picks them up on the next deploy.

## Common gotchas

* **`/public/v1/docs` is empty.** Expected until the first public
  controller ships.
* **API key 401 even with valid key.** Check the bearer header is
  `Bearer <key>` not `bearer <key>` or just `<key>`. The guard
  strips both casings but partners sometimes send the raw key.
* **Rate-limit 429 immediately after key creation.** Each pod has its
  own bucket; if your test traffic spans multiple pods (load
  balancer rotation), you're hitting a different bucket each time
  and the bucket starts at burst capacity. Not a bug.
* **Webhook signature mismatch.** Almost always a body whitespace
  difference — the signed input is the EXACT bytes we sent. Don't
  reformat the JSON before verifying.
* **Sandbox flow returns real refund ID.** The handler isn't
  consulting `sandbox.isTest(req)`. Adoption is per-endpoint.
* **OpenAPI shows admin routes in the public spec.** Path prefix
  filter in `clonePublicSpec` only keeps `/public/v1/...` paths. If
  another path is appearing, check the controller's `@Controller(...)`
  argument — it must literally start with `public/v1/`.
