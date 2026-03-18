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
| Event | Consumers |
|-------|-----------|
| orders.master.created | payments, settlements, notifications, audit, affiliate, franchise |
| orders.sub_order.created | shipping, notifications, audit |
| orders.confirmed | notifications, audit, affiliate, franchise |
| orders.failed | notifications, audit |
| orders.cancelled | inventory, settlements, notifications, audit |
| orders.sub_order.accepted | notifications, audit |
| orders.sub_order.packed | notifications, audit |
| orders.sub_order.shipped | notifications, audit |
| orders.sub_order.delivered | returns (eligibility window), settlements, notifications, audit |

## Payments Events
| Event | Consumers |
|-------|-----------|
| payments.intent.created | audit |
| payments.captured | orders, settlements, notifications, audit |
| payments.failed | orders, notifications, audit |
| payments.refund.requested | audit |
| payments.refund.completed | returns, settlements, notifications, audit |
| payments.refund.failed | returns, notifications, audit |
| payments.webhook.received | audit |
| payments.mismatch.detected | admin-control-tower, audit |

## COD Events
| Event | Consumers |
|-------|-----------|
| cod.decision.logged | audit, admin-control-tower |
| cod.rule.updated | audit |

## Shipping Events
| Event | Consumers |
|-------|-----------|
| shipping.shipment.created | orders, notifications, audit |
| shipping.awb.assigned | orders, notifications, audit |
| shipping.label.generated | audit |
| shipping.tracking.updated | orders, notifications, audit |
| shipping.ndr.raised | orders, notifications, audit, admin-control-tower |
| shipping.ndr.resolved | orders, notifications, audit |
| shipping.rto.initiated | orders, returns, settlements, notifications, audit |
| shipping.rto.delivered | orders, returns, settlements, notifications, audit |

## Returns Events
| Event | Consumers |
|-------|-----------|
| returns.requested | notifications, audit |
| returns.approved | notifications, audit |
| returns.rejected | notifications, audit |
| returns.pickup.created | shipping, notifications, audit |
| returns.item.received | audit |
| returns.qc.completed | audit |
| returns.refund.approved | payments, settlements, notifications, audit |
| returns.refund.rejected | notifications, audit |
| returns.adjustment.requested | settlements, audit |
| returns.dispute.opened | notifications, audit, admin-control-tower |
| returns.dispute.closed | notifications, audit |

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
