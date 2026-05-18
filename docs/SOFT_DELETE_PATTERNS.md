# Soft-delete patterns — reference

**Audience:** anyone adding a new Prisma model or writing a query
that joins / filters against an existing one.

**Last updated:** 2026-05-16 (Phase 12). Owners: platform team.

The codebase has historically used **three** different soft-delete
patterns across modules. That's not aspirational — it reflects
different real requirements (regulatory retention, FK integrity,
state-machine driven lifecycle). The audit's "chaos" framing in
§12.S5 captures the cost: a query that filters by `isDeleted = false`
on one model and forgets `deletedAt IS NULL` on a joined model
silently returns stale rows.

This doc names the three patterns, explains when to use each, and
documents the per-model conventions so a new query author can pick
the right filter without spelunking through every schema file.

---

## The three patterns

### Pattern A — `isDeleted: Boolean` + `deletedAt: DateTime?`

**The default for catalog + identity + seller-side entities.**

Boolean for fast index scans, timestamp for audit / retention math:

```prisma
model Product {
  // ...
  isDeleted   Boolean   @default(false) @map("is_deleted")
  deletedAt   DateTime? @map("deleted_at")
  @@index([isDeleted])
}
```

Use when:
- Records are user-facing and need a fast "is this still alive?"
  check at query time.
- The record is referenced by FKs that should fail-loud if the
  parent is gone (typically combined with `onDelete: Restrict`).

**Query convention:** every read filters `where: { isDeleted: false }`
(or the equivalent column on raw SQL).

**Models on this pattern:**
- `Product`, `ProductVariant` (`catalog.prisma`)
- `Seller` (`seller.prisma`)
- `FranchisePartner` (`franchise.prisma`)
- `User` (`identity.prisma`) — boolean only, no timestamp
- `Affiliate` (`affiliate.prisma`)

### Pattern B — `deletedAt: DateTime?` only

**Append-only event logs and asset registries.**

```prisma
model FileMetadata {
  // ...
  deletedAt DateTime? @map("deleted_at")
  status    FileStatus @default(PENDING)
}
```

Use when:
- The model has its own status enum that already captures the
  "alive vs gone" distinction; the boolean would be redundant.
- Hard-deletion is permitted but rare (e.g. retention sweep) and
  the timestamp is the audit handle.

**Query convention:** filter `where: { deletedAt: null }` for
"active" reads. The status enum carries the operational meaning.

**Models on this pattern:**
- `FileMetadata` (`files.prisma`) — paired with `FileStatus.DELETED`
- `Address` (`identity.prisma`)
- `RoleAssignment` (`authorization.prisma`)

### Pattern C — state-machine status, no soft-delete column

**Order-flow, return-flow, settlement-flow entities.**

```prisma
model MasterOrder {
  // ...
  orderStatus OrderStatus @default(PENDING)
}
```

Use when:
- The lifecycle is governed by a finite-state machine and a
  "deleted" state would be inconsistent with the FSM (e.g.
  `CANCELLED`, `RETURNED`, `EXPIRED` are richer terminal states).
- Records MUST NOT be physically deleted because of retention
  requirements (GST invoices, settlement rows).

**Query convention:** filter by the relevant status enum.
`orderStatus: { in: ['CONFIRMED', 'IN_TRANSIT', 'DELIVERED'] }`
is the canonical "alive" predicate for orders.

**Models on this pattern:**
- `MasterOrder`, `SubOrder`, `OrderItem` (`orders.prisma`)
- `Return` (`returns.prisma`)
- `SellerSettlement`, `SettlementCycle` (`settlements.prisma`)
- `Refund` (`payments.prisma`)
- `Dispute` (`disputes.prisma`)

---

## Choosing a pattern for a new model

```
                    ┌─────────────────────────────┐
                    │ Does the record have a      │
                    │ multi-step lifecycle FSM?   │
                    └──────────────┬──────────────┘
                                   │
                  ┌────────────────┴────────────────┐
                  │                                 │
                 YES                                NO
                  │                                 │
                  ▼                                 ▼
            Pattern C                ┌──────────────────────────┐
            (status only)            │ Is the record on a hot   │
                                     │ read path?               │
                                     └──────────┬───────────────┘
                                                │
                                  ┌─────────────┴─────────────┐
                                  │                           │
                                 YES                          NO
                                  │                           │
                                  ▼                           ▼
                            Pattern A                   Pattern B
                            (boolean + ts)              (timestamp only)
```

## Anti-patterns

* **Don't introduce a fourth pattern.** If your model needs
  something the three above can't express, raise it in a platform
  review; we add to this doc, not in-place.
* **Don't mix patterns within the same join.** A query that joins
  `Product` (Pattern A) with `MasterOrder` (Pattern C) MUST filter
  `Product.isDeleted: false` AND `MasterOrder.orderStatus !=
  'CANCELLED'`. A missing filter on either side leaks ghost rows.
* **Don't hard-delete Pattern A rows in service code.** Set
  `isDeleted: true` + `deletedAt: <now>`. The retention sweeper is
  the only writer that physically removes rows.
* **Don't use Prisma middleware to auto-inject soft-delete filters.**
  We considered it; the trade is that any explicit-include query
  (e.g. admin "show deleted") then has to remember to opt out, and
  the silent filter masks query-time mistakes. Explicit filters in
  every service method are the team standard.
