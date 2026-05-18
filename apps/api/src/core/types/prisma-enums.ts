/**
 * Phase 12 (2026-05-16) — single canonical re-export of Prisma enums.
 *
 * Pre-Phase-12 the repo carried 22 hand-written `*.enum.ts` files
 * under `src/modules/<x>/domain/enums/` that duplicated the same
 * variants from `prisma/schema/*.prisma`. Every Prisma migration
 * that touched an enum required a parallel TS edit, which silently
 * went stale (the audit found 71 Prisma enums vs 26 TS enums).
 *
 * The 22 TS duplicates were deleted; this file re-exports the
 * Prisma-generated enum types from `@prisma/client` so consumers
 * can keep their existing `import { ProductStatus } from
 * 'src/core/types/prisma-enums'` style without touching every call
 * site.
 *
 * **Add new re-exports here when a module wants the symbol** — but
 * never re-declare an enum body. The Prisma client is the source
 * of truth.
 */

export {
  // Catalog
  ProductStatus,
  ModerationStatus,
  // Inventory
  StockMovementKind,
  // Returns
  ReturnStatus,
  // Sellers / Franchise
  SellerStatus,
  FranchiseStatus,
  // Affiliates
  AffiliateStatus,
  // Notifications
  NotificationChannel,
  NotificationStatus,
  // Settlements
  SellerSettlementStatus,
  SettlementCycleStatus,
} from '@prisma/client';

// Add new re-exports here as modules adopt them. Names that don't
// resolve from @prisma/client either don't exist as Prisma enums
// (e.g. PaymentStatus lives as a per-table column constraint, not
// an enum) or are scoped under a different name — check the
// generated client before adding.
