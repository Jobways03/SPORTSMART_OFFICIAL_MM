# Deferred ONLINE order creation (Option B) — operator runbook

Capability runbook for the deferred-order-creation feature: what it is, how to
operate it, how to roll it back, and the staging QA recipe (Phase 8) to run
before enabling it in production.

## What it is

By default ("Option A", legacy) an ONLINE checkout creates the `MasterOrder`
**up front** (status `PENDING_PAYMENT`) and then sends the customer to Razorpay.
A failed or abandoned payment therefore leaves a real order row that has to be
hidden/cancelled.

**Option B — deferred order creation** flips that: an ONLINE checkout creates a
`CheckoutSession` *intent* instead of an order. The real `MasterOrder` is
**materialized only when the gateway payment is captured**. A never-completed
checkout simply expires as a `CheckoutSession` — **no half-made order ever
reaches the customer's order list or the admin**.

- **COD** and **wallet-fully-covered** checkouts are unaffected (they have no
  pending-gateway gap and are placed immediately).
- Materialization is **exactly-once** via a `CheckoutSession` CAS
  (`CREATED → PAID → ORDER_CREATED`) and runs from three paths: the synchronous
  customer verify, the Razorpay **webhook** (covers "customer closed the tab"),
  and a backstop **recovery cron**.
- A captured payment whose order can't be created (stock gone, etc.) lands the
  session in `FAILED`, and the **reconciler cron auto-refunds** the captured
  gateway payment.

The whole feature is gated behind `CHECKOUT_DEFERRED_ORDER_CREATION` (default
`false`); with it off the system behaves exactly as the legacy create-first
path.

Key code:
- `apps/api/.../checkout/application/services/deferred-order.service.ts` — the
  `CheckoutSession` state machine.
- `checkout.service.ts` — `createDeferredOnlineCheckout`, `verifyAndMaterializeDeferred`,
  `materializeFromGateway`, `materializeOrderFromSession`.
- `checkout/application/jobs/deferred-capture-recovery.cron.ts` — missed-webhook
  capture backstop.
- `checkout/application/jobs/checkout-session-reconciliation.cron.ts` — re-link /
  fail / refund / expire reconciler.
- `checkout/application/event-handlers/gateway-capture-unresolved.handler.ts` —
  consumes the webhook's `payments.gateway_capture_unresolved` event.
- `payments/.../payment-webhook.controller.ts` — emits that event when a
  captured payment has no MasterOrder.
- Table: `checkout_sessions` (`apps/api/prisma/schema/checkout-session.prisma`).

## Operating envelope

All flags live in `apps/api/.env.example`; defaults in `bootstrap/env/env.schema.ts`.

| Env var | Default | Meaning |
| --- | --- | --- |
| `CHECKOUT_DEFERRED_ORDER_CREATION` | `false` | Master switch. Off ⇒ legacy create-first. Turn ON only after the pre-prod recipe below passes. |
| `PAYMENT_WINDOW_MINUTES` | `30` | Session payment window (also the legacy order window). |
| `DEFERRED_CAPTURE_BATCH` | `20` | Recovery-cron per-tick session scan cap. |
| `DEFERRED_CAPTURE_BACKOFF_SECONDS` | `180` | Min seconds between recovery-cron polls of the same session. |
| `CHECKOUT_SESSION_RECONCILIATION_ENABLED` | `true` | Pauses the reconciler for incident response. Reconciler also requires the master switch on. |
| `CHECKOUT_SESSION_RECONCILE_BATCH` | `50` | Reconciler per-tick scan cap. |
| `CHECKOUT_SESSION_STUCK_GRACE_MINUTES` | `5` | How long a PAID-with-no-order session must sit before it's treated as a crashed materialize (re-link or fail). Must comfortably exceed normal materialize latency. |

Crons (leader-elected, only run when the master switch is on):
- `deferred-capture-recovery` — every minute; polls Razorpay for captured
  payments on `CREATED` sessions and materializes them.
- `checkout-session-reconciliation` — every 5 minutes; re-links/fails stuck PAID
  sessions, auto-refunds FAILED sessions, expires abandoned CREATED sessions.

Observability:
- Logs: grep `[reconcile]`, `[deferred-capture]`, `GatewayCaptureUnresolvedHandler`,
  `materializeFromGateway`, `Materialized order`.
- A refund the gateway rejects opens a `PaymentMismatchAlert`
  (`kind=ORPHAN_PAYMENT`, `sourceType=RECONCILIATION`) on the payment-ops
  dashboard — alert on these.

## Rollback

The feature is flag-gated and additive (a new table + columns; no change to
existing order tables), so rollback is a flag flip — **no migration revert**.

1. Set `CHECKOUT_DEFERRED_ORDER_CREATION=false` and redeploy/restart the API.
   New ONLINE checkouts immediately use the legacy create-first path.
2. **Do NOT** flip off while there are in-flight `PAID` sessions mid-materialize
   if you can avoid it — but it is safe: `materializeFromGateway` and the
   reconciler do **not** gate on the master switch for an existing session
   (session existence is the signal), so already-created sessions still
   materialize / get reconciled / get refunded after the flip. Only NEW sessions
   stop being created.
3. To pause just the reconciler (e.g. during a payment-ops incident) without
   reverting the feature: `CHECKOUT_SESSION_RECONCILIATION_ENABLED=false`.
4. Drain check before considering the rollout fully reverted:
   `SELECT status, count(*) FROM checkout_sessions GROUP BY status;` — wait for
   `CREATED`/`PAID` to drain to 0 (all moved to `ORDER_CREATED`/`EXPIRED`/`FAILED`).

The `checkout_sessions` table and the `MasterOrder` deferred columns are inert
when the flag is off; they can be left in place.

## Test in pre-prod

Run this in **staging** with a Razorpay **test** account. Engineering pre-flight
(already green on the branch): `pnpm --filter @sportsmart/api exec tsc --noEmit`
= 0; `pnpm --filter @sportsmart/web-storefront exec tsc --noEmit` = 0; the
checkout/payments/orders suites pass except the 6 pre-existing
`prisma-checkout.repository` NaN→BigInt fixture failures (unrelated to Option B).

Set in staging:
```
CHECKOUT_DEFERRED_ORDER_CREATION=true
CHECKOUT_SESSION_RECONCILIATION_ENABLED=true
# (leave the *_BATCH / *_BACKOFF / *_GRACE knobs at defaults; lower
#  CHECKOUT_SESSION_STUCK_GRACE_MINUTES to 1–2 to speed up the stuck-session test)
```
Apply the Option B migrations first:
`20260617110254_checkout_session`, `20260619120000_checkout_session_last_polled`,
`20260619140000_checkout_session_refund_reference`.

Razorpay test success card: `4111 1111 1111 1111`, any future expiry, any CVV/OTP.

Handy assertion query (run after each scenario):
```sql
SELECT id, status, razorpay_order_id, razorpay_payment_id, master_order_id,
       refunded_at, refund_reference, failure_reason, expires_at
FROM checkout_sessions ORDER BY created_at DESC LIMIT 5;
```

### Scenario 1 — happy path (exactly one order)
1. Storefront: add to cart → checkout → choose ONLINE → Place Order.
2. Confirm the place-order response is `deferred:true` with a `checkoutSessionId`
   and **no** orderNumber (devtools network tab). Session row: `status=CREATED`,
   `razorpay_order_id` set, `master_order_id` NULL.
3. Pay with the test card. The page should navigate to `/orders/<orderNumber>`.
4. **Expect:** exactly one `MasterOrder` (`PLACED`/`PAID`); session
   `status=ORDER_CREATED`, `master_order_id` set. No duplicate order.
5. Idempotency: re-POST the same verify (same `X-Idempotency-Key`,
   same razorpay ids) → still one order, returns the same `orderNumber`.

### Scenario 2 — customer closes the tab after paying
1. Begin Scenario 1, pay, but **close the tab before the verify completes**.
2. With the Razorpay webhook configured → the order materializes within seconds
   (session `→ ORDER_CREATED`). Confirm in admin + the assertion query.
3. To test the backstop instead: temporarily point the webhook away (or disable
   it) and repeat — the `deferred-capture-recovery` cron materializes the order
   within ~1 minute. Watch for `[deferred-capture] materialized order` in logs.

### Scenario 3 — abandoned checkout (no order anywhere)
1. Place a deferred ONLINE order, get the Razorpay modal, **dismiss it** (don't
   pay). Storefront shows "payment was not completed… try again".
2. Wait past `expires_at` + the reconciler tick. Session `→ EXPIRED`.
3. **Expect:** NO `MasterOrder` exists for this checkout — nothing in the
   customer's order list, nothing in admin. Held stock + discount reservations
   were released by the existing 15-min reservation TTL crons (verify stock
   is back).

### Scenario 4 — materialize failure → auto-refund
1. Create a deferred session, then make the order un-creatable before paying —
   e.g. drain the product's stock to 0 (another order / admin) so stock-confirm
   fails at materialize.
2. Pay with the test card.
3. **Expect:** verify returns the "payment succeeded but the order could not be
   created — a refund will be issued automatically" message (storefront shows
   it). Session `→ FAILED`.
4. Within a reconciler tick (≤5 min): session gets `refunded_at` + a
   `refund_reference`; the Razorpay test dashboard shows a refund for the
   captured payment. Log: `[reconcile] refunded FAILED session`.
5. If the gateway refund is rejected, confirm a `PaymentMismatchAlert`
   (`ORPHAN_PAYMENT`) is opened for manual follow-up.

### Scenario 5 — wallet-assisted failure (verify the orphan-order wallet refund)
This validates the one Phase-5-deferred assumption: a deferred order that
debited the wallet then failed materialize must have its wallet portion
reversed by the **legacy** `cancel-expired → OrderExpiredHandler` path (Option B
refunds only the gateway portion).
1. Apply wallet credit to the test customer; place a wallet-assisted deferred
   ONLINE order; force materialize to fail *after* the wallet debit (e.g. break
   the discount/tax step or drain stock such that the post-debit step throws).
2. Pay.
3. **Expect:** the gateway portion is refunded by the reconciler (Scenario 4);
   AND the orphan `PENDING_PAYMENT` order (created by `placeOrderTransaction`,
   `razorpay_payment_id` NULL) is picked up by the legacy `cancel-expired`
   poller → `OrderExpiredHandler` credits the wallet portion back. Confirm the
   customer's wallet balance is whole. **If this does not happen, do not enable
   in production** — wire the wallet reversal into the deferred FAILED path.

### Scenario 6 — flag-off control
With `CHECKOUT_DEFERRED_ORDER_CREATION=false`, repeat Scenario 1 and confirm the
legacy behavior is unchanged (order created up front as `PENDING_PAYMENT`, then
flipped to `PAID` on verify).

## Production cutover criteria

Enable `CHECKOUT_DEFERRED_ORDER_CREATION=true` in production only after:
- Scenarios 1–6 pass in staging (Scenario 5's wallet reversal explicitly
  confirmed).
- The `deferred-capture-recovery` and `checkout-session-reconciliation` crons
  are observed running (leader-elected, no errors) in staging.
- A monitor/alert is wired on `PaymentMismatchAlert` (`kind=ORPHAN_PAYMENT`,
  `sourceType=RECONCILIATION`).
- A dashboard query on `checkout_sessions` by `status` is available to ops.

Roll out behind a low-traffic window first; watch the session-status distribution
and the refund/mismatch alerts for the first hours.
