# Internal Event Catalog - SPORTSMART MVP

## Event Naming Convention
`<module>.<aggregate>.<action>`

## Identity Events
| Event | Consumers |
|-------|-----------|
| identity.user.registered | notifications, audit |
| identity.user.logged_in | audit |
| identity.user.password_reset_requested | notifications, audit |
| identity.user.password_reset_completed | audit |
| identity.admin.mfa_enabled | audit |
| identity.session.revoked | audit |

## Seller Events
| Event | Consumers |
|-------|-----------|
| seller.onboarding.submitted | notifications, audit, admin-control-tower |
| seller.onboarding.approved | notifications, audit, admin-control-tower |
| seller.onboarding.rejected | notifications, audit |
| seller.status.activated | notifications, audit |
| seller.status.suspended | notifications, audit, admin-control-tower |
| seller.bank.updated | audit |
| seller.pickup_address.updated | audit |

## Catalog Events
| Event | Consumers |
|-------|-----------|
| catalog.product.created | search, audit |
| catalog.product.updated | search, audit |
| catalog.variant.created | search, audit |
| catalog.variant.updated | search, audit |
| catalog.listing.submitted_for_qc | notifications, audit |
| catalog.listing.approved | search, notifications, audit |
| catalog.listing.rejected | notifications, audit |
| catalog.media.updated | search, audit |

## Inventory Events
| Event | Consumers |
|-------|-----------|
| inventory.stock.reserved | audit |
| inventory.stock.released | audit |
| inventory.stock.deducted | audit, search |
| inventory.stock.adjusted | audit, admin-control-tower |
| inventory.stock.out_of_stock | search, admin-control-tower |

## Cart Events
| Event | Consumers |
|-------|-----------|
| cart.created | - |
| cart.item.added | - |
| cart.item.updated | - |
| cart.item.removed | - |
| cart.checked_out | audit |

## Checkout Events
| Event | Consumers |
|-------|-----------|
| checkout.validation.passed | audit |
| checkout.validation.failed | audit |
| checkout.cod.evaluated | audit |
| checkout.session.created | audit |
| checkout.submitted | audit |

## Orders Events
Phase 0 (Gap audit 2026-05-19) — table rewritten to match the names actually emitted by `eventBus.publish` in `apps/api/src/modules/orders`. The pre-audit names (`orders.confirmed`, `orders.failed`, `orders.cancelled`, `orders.sub_order.{accepted,packed,shipped}`) were never wired and any handler subscribing to them was dead.

| Event | Emitted | Consumers |
|-------|---------|-----------|
| orders.master.created | ✅ | payments, settlements, notifications, audit, affiliate, franchise |
| orders.master.routed | ✅ | shipping, notifications, audit |
| orders.master.exception | ✅ | admin-control-tower, notifications, audit |
| orders.sub_order.created | ✅ | shipping, notifications, audit |
| orders.sub_order.status_changed | ✅ | notifications, audit *(covers accept / pack / ship transitions until the dedicated names below land)* |
| orders.sub_order.delivered | ✅ | returns (eligibility window), settlements, notifications, audit |
| orders.sub_order.cancelled_by_admin | ✅ | inventory, settlements, notifications, audit |
| orders.sub_order.rejected_needs_discount_recalc | ✅ | discounts, notifications, audit |
| orders.sub_order.reassigned | ✅ | shipping, notifications, audit |
| orders.sub_order.returned_by_seller | ✅ | returns, settlements, notifications, audit |
| orders.sub_order.accepted | ✅ | notifications, audit — published from `sellerAcceptOrder` (Phase 2 / H6) |

## Payments Events
| Event | Emitted | Consumers |
|-------|---------|-----------|
| payments.payment.captured | ✅ | orders, settlements, notifications, audit |
| payments.payment.failed | ✅ | orders, notifications, audit |
| payments.payment.expired | ✅ | orders, notifications, audit |
| payments.orphan_recovered | ✅ | admin-control-tower, audit |
| payments.saga.stuck_auto_escalated | ✅ | admin-control-tower, audit |
| payments.intent.created | ⏳ planned | audit |
| payments.refund.requested | ⏳ planned | audit (today, refund-flow events live under `returns.refund.*`) |
| payments.webhook.received | ⏳ planned | audit |
| payments.mismatch.detected | ⏳ planned | admin-control-tower, audit |

Refund-flow events emitted today actually live under the `returns.refund.*` namespace — see Returns Events below. The split exists because every refund today is initiated from a return; if a non-return-bound refund channel lands later, the `payments.refund.*` names will be reserved for it.

## COD Events
| Event | Consumers |
|-------|-----------|
| cod.decision.logged | audit, admin-control-tower |
| cod.rule.updated | audit |

## Shipping Events
| Event | Emitted | Consumers |
|-------|---------|-----------|
| shipping.shipment.created | ✅ | orders, notifications, audit |
| shipping.awb.assigned | ✅ | orders, notifications, audit |
| shipping.label.generated | ✅ | audit |
| shipping.tracking.updated | ✅ | orders, notifications, audit — published per snapshot from `IngestTrackingUpdateUseCase` (Phase 3 / C5) |
| shipping.ndr.raised | ✅ | orders, notifications, audit, admin-control-tower — published when carrier reports UNDELIVERED (Phase 3 / C5) |
| shipping.ndr.resolved | ⏳ planned | orders, notifications, audit |
| shipping.rto.initiated | ⏳ planned | orders, returns, settlements, notifications, audit |
| shipping.rto.delivered | ✅ | orders, returns, settlements, notifications, audit — published when courier reports RTO_DELIVERED; returns + payments must wire refund flow (Phase 3 / C5) |

## Returns Events
Phase 0 (Gap audit 2026-05-19) — names re-aligned with `eventBus.publish` calls in `apps/api/src/modules/returns`. Return-lifecycle events sit under `returns.return.*`; refund-lifecycle events under `returns.refund.*`; dispute events have their own top-level `disputes.*` namespace (see Disputes Events below).

| Event | Emitted | Consumers |
|-------|---------|-----------|
| returns.return.requested | ✅ | notifications, audit |
| returns.return.approved | ✅ | notifications, audit |
| returns.return.rejected | ✅ | notifications, audit |
| returns.return.cancelled | ✅ | notifications, audit |
| returns.return.pickup_scheduled | ✅ | shipping, notifications, audit |
| returns.return.in_transit | ✅ | notifications, audit |
| returns.return.received | ✅ | audit |
| returns.return.qc_completed | ✅ | audit, settlements *(downstream of QC decision)* |
| returns.return.closed | ✅ | notifications, audit |
| returns.return.stale_escalation | ✅ | admin-control-tower, audit |
| returns.refund.initiated | ✅ | payments, audit |
| returns.refund.completed | ✅ | payments, settlements, notifications, audit |
| returns.refund.failed | ✅ | notifications, audit |
| returns.refund.exhausted_escalation | ✅ | admin-control-tower, audit |
| returns.replacement.created | ✅ | orders, notifications, audit |
| returns.adjustment.requested | ⏳ planned | settlements, audit |

## Disputes Events
| Event | Emitted | Consumers |
|-------|---------|-----------|
| disputes.filed | ✅ | notifications, audit, admin-control-tower |
| disputes.message.added | ✅ | notifications, audit |
| disputes.decided | ✅ | notifications, audit, settlements |
| disputes.closed | ✅ | notifications, audit |
| disputes.refund_failure.queued | ✅ | admin-control-tower, audit |
| disputes.refund_failure.sla_breached | ✅ | admin-control-tower, audit |

## Settlements Events
| Event | Consumers |
|-------|-----------|
| settlements.ledger.entry_recorded | audit |
| settlements.run.previewed | audit |
| settlements.run.approved | notifications, audit, admin-control-tower |
| settlements.statement.generated | notifications, audit |
| settlements.payout.marked_paid | notifications, audit |

## Affiliate Events
| Event | Consumers |
|-------|-----------|
| affiliate.onboarding.approved | notifications, audit |
| affiliate.referral.attributed | settlements, audit |
| affiliate.commission.locked | settlements, notifications, audit |
| affiliate.commission.reversed | settlements, notifications, audit |

## Franchise Events
| Event | Consumers |
|-------|-----------|
| franchise.onboarding.approved | notifications, audit |
| franchise.pincode.mapped | audit |
| franchise.fee.recorded | settlements, audit |
| franchise.earning.locked | settlements, notifications, audit |

## Files Events
| Event | Consumers |
|-------|-----------|
| files.upload.completed | audit |
| files.attachment.linked | audit |
| files.access.requested | audit |

## When to Use Direct Call vs Event
- **Direct call**: Need immediate answer, part of transaction boundary, checkout/order cannot continue without result
- **Event**: Reaction can happen later, multiple consumers, notifications/analytics/audit are secondary effects
