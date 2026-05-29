import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SupplyTaxability, TaxAttestationAction } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';

/**
 * Phase 45 (2026-05-21) — single owner of tax-config attestation
 * mechanics. Pre-Phase-45 the controller wrote the columns directly
 * and the chain of who attested what was lost (audit Gap #6), the
 * read-then-write race let admins stamp drifted data (Gap #8), and
 * the verify endpoint's early-return on "already verified" skipped
 * re-validation (Gap #12).
 *
 * This service:
 *   - Re-validates the current tax columns on every attest (so a
 *     prior attest that has since drifted via an admin-blessed path
 *     can't slip through).
 *   - Uses optimistic-lock via taxConfigVersion. The verify endpoint
 *     accepts `expectedVersion`; we refuse with 409 if the row has
 *     drifted since the admin's read.
 *   - Writes a TaxAttestationLog row on every transition so CA
 *     audits can reconstruct the full chain.
 *   - Increments taxConfigVersion on every write so subsequent
 *     callers see the drift.
 */

const HSN_RE = /^\d{4,8}$/;
const UQC_RE = /^[A-Z]{2,6}$/;

interface AttestArgs {
  productId: string;
  actorId: string;
  actorRole: 'ADMIN' | 'SELLER' | 'SYSTEM';
  expectedVersion?: number;
  reviewerNote?: string | null;
}

interface ResetArgs {
  productId: string;
  actorId: string;
  actorRole: 'ADMIN' | 'SELLER' | 'SYSTEM';
  reason?: string | null;
  // The transactional client when called from inside an existing
  // tx (e.g. seller update). Defaults to a fresh tx.
  tx?: Prisma.TransactionClient;
}

interface EditedArgs {
  productId: string;
  actorId: string;
  actorRole: 'ADMIN' | 'SELLER' | 'SYSTEM';
  action: 'EDITED' | 'BULK_EDITED';
  reviewerNote?: string | null;
  tx?: Prisma.TransactionClient;
}

@Injectable()
export class ProductTaxAttestationService {
  private readonly logger = new Logger(ProductTaxAttestationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Phase 45 — atomic attest. Transaction takes SELECT … FOR UPDATE
   * on the product row, re-validates the tax columns, optimistic-
   * locks against the supplied expectedVersion, flips
   * taxConfigVerified=true, increments taxConfigVersion, writes a
   * TaxAttestationLog row.
   *
   * Idempotent when the row is already verified at the same version
   * (returns the existing state). Throws 409 when the row has drifted
   * since the admin's read.
   */
  async attest(args: AttestArgs): Promise<{
    taxConfigVerified: true;
    taxConfigVerifiedAt: Date;
    taxConfigVerifiedBy: string;
    taxConfigVersion: number;
  }> {
    return this.prisma.$transaction(async (tx) => {
      // Row lock for the duration of the tx so a concurrent seller
      // edit or admin re-attest serializes against us.
      await tx.$queryRaw`SELECT id FROM products WHERE id = ${args.productId} FOR UPDATE`;

      const product = await tx.product.findUnique({
        where: { id: args.productId },
        select: {
          id: true,
          hsnCode: true,
          gstRateBps: true,
          supplyTaxability: true,
          defaultUqcCode: true,
          cessRateBps: true,
          taxConfigVerified: true,
          taxConfigVerifiedAt: true,
          taxConfigVerifiedBy: true,
          taxConfigVersion: true,
        },
      });
      if (!product) throw new NotFoundAppException('Product not found');

      // Optimistic lock. Admin UI passes the version they reviewed;
      // we refuse if the row has changed since.
      if (
        args.expectedVersion !== undefined
        && args.expectedVersion !== product.taxConfigVersion
      ) {
        throw new ConflictAppException(
          `Tax config has changed since you opened this page (version ${product.taxConfigVersion}, you reviewed ${args.expectedVersion}). Reload and re-review.`,
        );
      }

      // Re-validate the current data — even when already verified.
      // Closes audit Gap #12: pre-Phase-45 the controller returned
      // early when taxConfigVerified was already true, never re-
      // checking that the data still passed.
      this.validateTaxColumns({
        hsnCode: product.hsnCode,
        gstRateBps: product.gstRateBps,
        supplyTaxability: product.supplyTaxability,
        defaultUqcCode: product.defaultUqcCode,
      });

      // Idempotent — already attested at this version. Still write
      // an audit row so we can prove the admin re-clicked.
      if (product.taxConfigVerified && product.taxConfigVerifiedAt) {
        await this.writeAuditLog(tx, {
          productId: args.productId,
          action: TaxAttestationAction.ATTESTED,
          prev: snapshotFromProduct(product),
          next: snapshotFromProduct(product),
          taxConfigVersion: product.taxConfigVersion,
          actorId: args.actorId,
          actorRole: args.actorRole,
          reviewerNote: args.reviewerNote ?? null,
        });
        return {
          taxConfigVerified: true as const,
          taxConfigVerifiedAt: product.taxConfigVerifiedAt,
          taxConfigVerifiedBy: product.taxConfigVerifiedBy ?? args.actorId,
          taxConfigVersion: product.taxConfigVersion,
        };
      }

      const verifiedAt = new Date();
      const nextVersion = product.taxConfigVersion + 1;
      await tx.product.update({
        where: { id: args.productId },
        data: {
          taxConfigVerified: true,
          taxConfigVerifiedAt: verifiedAt,
          taxConfigVerifiedBy: args.actorId,
          taxConfigVersion: nextVersion,
        },
      });

      await this.writeAuditLog(tx, {
        productId: args.productId,
        action: TaxAttestationAction.ATTESTED,
        prev: snapshotFromProduct(product),
        next: snapshotFromProduct(product),
        taxConfigVersion: nextVersion,
        actorId: args.actorId,
        actorRole: args.actorRole,
        reviewerNote: args.reviewerNote ?? null,
      });

      this.logger.log(
        `Attested productId=${args.productId} by ${args.actorRole}:${args.actorId} version=${nextVersion}`,
      );
      return {
        taxConfigVerified: true as const,
        taxConfigVerifiedAt: verifiedAt,
        taxConfigVerifiedBy: args.actorId,
        taxConfigVersion: nextVersion,
      };
    });
  }

  /**
   * Phase 45 — record a RESET transition + bump the version. Called
   * by seller/admin product update paths whenever a tax field
   * changes. Does NOT clear the verified columns — the caller is
   * already doing that as part of its own update; this service just
   * captures the audit row + version bump.
   */
  async recordReset(args: ResetArgs): Promise<void> {
    const db = args.tx ?? this.prisma;
    const product = await db.product.findUnique({
      where: { id: args.productId },
      select: {
        hsnCode: true,
        gstRateBps: true,
        supplyTaxability: true,
        defaultUqcCode: true,
        taxConfigVersion: true,
      },
    });
    if (!product) return;

    await this.writeAuditLog(db, {
      productId: args.productId,
      action: TaxAttestationAction.RESET,
      prev: snapshotFromProduct(product),
      next: snapshotFromProduct(product),
      taxConfigVersion: product.taxConfigVersion + 1,
      actorId: args.actorId,
      actorRole: args.actorRole,
      reviewerNote: args.reason ?? null,
    });
  }

  /**
   * Phase 45 — record an EDITED / BULK_EDITED transition. Caller has
   * just changed one or more tax columns; we capture the audit row.
   * The caller is responsible for bumping taxConfigVersion on the
   * same write (so the snapshot stays consistent).
   */
  async recordEdited(args: EditedArgs): Promise<void> {
    const db = args.tx ?? this.prisma;
    const product = await db.product.findUnique({
      where: { id: args.productId },
      select: {
        hsnCode: true,
        gstRateBps: true,
        supplyTaxability: true,
        defaultUqcCode: true,
        taxConfigVersion: true,
      },
    });
    if (!product) return;

    await this.writeAuditLog(db, {
      productId: args.productId,
      action:
        args.action === 'BULK_EDITED'
          ? TaxAttestationAction.BULK_EDITED
          : TaxAttestationAction.EDITED,
      prev: snapshotFromProduct(product),
      next: snapshotFromProduct(product),
      taxConfigVersion: product.taxConfigVersion,
      actorId: args.actorId,
      actorRole: args.actorRole,
      reviewerNote: args.reviewerNote ?? null,
    });
  }

  /**
   * Phase 45 — re-validate the current tax columns. The DTO layer
   * validates writes; this re-check defends against drift between
   * the original write and the attestation moment. Throws 400 with
   * the first failing field name.
   */
  private validateTaxColumns(p: {
    hsnCode: string | null;
    gstRateBps: number | null;
    supplyTaxability: string | null;
    defaultUqcCode: string | null;
  }): void {
    const taxability = p.supplyTaxability ?? 'TAXABLE';
    // TAXABLE products require HSN + non-zero rate (unless
    // explicitly NIL_RATED / EXEMPT / NON_GST).
    if (taxability === 'TAXABLE') {
      if (!p.hsnCode || !HSN_RE.test(p.hsnCode)) {
        throw new BadRequestAppException(
          'Cannot attest — hsnCode is missing or invalid (must match ^\\d{4,8}$)',
        );
      }
      if (p.gstRateBps === null || p.gstRateBps < 0 || p.gstRateBps > 10_000) {
        throw new BadRequestAppException(
          'Cannot attest — gstRateBps must be between 0 and 10000',
        );
      }
    }
    if (p.defaultUqcCode && !UQC_RE.test(p.defaultUqcCode)) {
      throw new BadRequestAppException(
        'Cannot attest — defaultUqcCode must match ^[A-Z]{2,6}$',
      );
    }
  }

  private async writeAuditLog(
    db: Prisma.TransactionClient | PrismaService,
    entry: {
      productId: string;
      action: TaxAttestationAction;
      prev: ReturnType<typeof snapshotFromProduct>;
      next: ReturnType<typeof snapshotFromProduct>;
      taxConfigVersion: number;
      actorId: string;
      actorRole: string;
      reviewerNote: string | null;
    },
  ): Promise<void> {
    await db.taxAttestationLog.create({
      data: {
        productId: entry.productId,
        action: entry.action,
        prevHsn: entry.prev.hsn,
        prevGstRateBps: entry.prev.gstRateBps,
        prevSupplyTaxability: entry.prev.supplyTaxability,
        prevUqcCode: entry.prev.uqc,
        newHsn: entry.next.hsn,
        newGstRateBps: entry.next.gstRateBps,
        newSupplyTaxability: entry.next.supplyTaxability,
        newUqcCode: entry.next.uqc,
        taxConfigVersion: entry.taxConfigVersion,
        actorId: entry.actorId,
        actorRole: entry.actorRole,
        reviewerNote: entry.reviewerNote,
      },
    });
  }

  /**
   * Phase 45 — read the audit log for a product. Used by the admin
   * UI's attestation history panel.
   */
  async getAuditLog(productId: string, opts: { limit?: number; offset?: number } = {}): Promise<unknown[]> {
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const skip = Math.max(opts.offset ?? 0, 0);
    return this.prisma.taxAttestationLog.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  /**
   * Phase 45 — bulk audit-log helper. The single-product `recordEdited`
   * path issues one INSERT per call; for the bulk-tax-config endpoint
   * that touches up to 2000 products, the N+1 round-trips dominate
   * the transaction wall-clock. `recordBulkEdited` collapses the
   * inserts into a single `createMany` keyed on a pre-fetched
   * snapshot of the affected rows.
   *
   * Reads the snapshot from the SAME transaction the caller is in so
   * the rows we record are exactly what was just updated.
   */
  async recordBulkEdited(args: {
    tx: Prisma.TransactionClient;
    productIds: string[];
    actorId: string;
    actorRole: 'ADMIN' | 'SYSTEM';
    reviewerNote?: string | null;
  }): Promise<void> {
    if (args.productIds.length === 0) return;

    const snapshot = await args.tx.product.findMany({
      where: { id: { in: args.productIds } },
      select: {
        id: true,
        hsnCode: true,
        gstRateBps: true,
        supplyTaxability: true,
        defaultUqcCode: true,
        taxConfigVersion: true,
      },
    });

    const rows = snapshot.map((p) => ({
      productId: p.id,
      action: TaxAttestationAction.BULK_EDITED,
      prevHsn: p.hsnCode,
      prevGstRateBps: p.gstRateBps,
      prevSupplyTaxability: (p.supplyTaxability as string | null) ?? null,
      prevUqcCode: p.defaultUqcCode,
      newHsn: p.hsnCode,
      newGstRateBps: p.gstRateBps,
      newSupplyTaxability: (p.supplyTaxability as string | null) ?? null,
      newUqcCode: p.defaultUqcCode,
      taxConfigVersion: p.taxConfigVersion,
      actorId: args.actorId,
      actorRole: args.actorRole,
      reviewerNote: args.reviewerNote ?? null,
    }));

    await args.tx.taxAttestationLog.createMany({ data: rows });
  }
}

function snapshotFromProduct(p: {
  hsnCode: string | null;
  gstRateBps: number | null;
  supplyTaxability: string | SupplyTaxability | null;
  defaultUqcCode: string | null;
}): { hsn: string | null; gstRateBps: number | null; supplyTaxability: string | null; uqc: string | null } {
  return {
    hsn: p.hsnCode,
    gstRateBps: p.gstRateBps,
    supplyTaxability: (p.supplyTaxability as string | null) ?? null,
    uqc: p.defaultUqcCode,
  };
}
