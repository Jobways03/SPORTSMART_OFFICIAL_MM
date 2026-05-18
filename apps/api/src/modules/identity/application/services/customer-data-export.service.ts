import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { NotFoundAppException } from '../../../../core/exceptions';

/**
 * Customer data export (DPDP §11 — right to data portability).
 *
 * Returns a single JSON document containing every piece of PII we
 * hold about the customer. The customer can then move it to another
 * service or simply hold a copy of what we know.
 *
 * Coverage (read-only — never modifies any row):
 *   - Profile: name, email, phone, addresses
 *   - Orders + sub-orders + line items
 *   - Returns
 *   - Wishlist items
 *   - Wallet (balance + last 200 transactions)
 *   - Tax documents (metadata only — PDFs available via the separate
 *     download endpoint)
 *   - Consent log (every grant / revoke from the audit chain)
 *   - Sessions (active sessions, no tokens)
 *
 * Excluded by policy:
 *   - Password hash (never exported, never logged)
 *   - Other customers' / sellers' data even if mentioned in the
 *     customer's orders (we redact buyer-side PII only)
 *   - Internal admin notes against the customer
 *   - Audit metadata rows that don't belong to this user
 *
 * Volume safeguards:
 *   - Wallet transactions capped at 200 (most recent first); full
 *     history available via dedicated wallet endpoint if needed
 *   - Tax documents listed without line items (lines are large and
 *     duplicate order-item data); PDFs fetched separately
 *   - Returns + orders capped at 500 most-recent (a customer with
 *     more orders than this can re-call the endpoint with a date
 *     filter — out of scope for the MVP)
 *
 * Each export call writes an audit row (`module='dpdp'`,
 * `action='DATA_EXPORTED'`) so we have a record of who exported when.
 */
@Injectable()
export class CustomerDataExportService {
  private readonly logger = new Logger(CustomerDataExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublicFacade,
  ) {}

  async exportFor(userId: string, context: { ipAddress?: string; userAgent?: string }): Promise<CustomerDataExportPayload> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        emailVerified: true,
        phoneVerified: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) throw new NotFoundAppException('User not found');

    // ── Addresses ───────────────────────────────────────────────────
    const addresses = await this.prisma.customerAddress.findMany({
      where: { customerId: userId },
      orderBy: { createdAt: 'desc' },
    });

    // ── Orders + sub-orders + items ────────────────────────────────
    const orders = await this.prisma.masterOrder.findMany({
      where: { customerId: userId },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        subOrders: {
          include: {
            items: true,
          },
        },
      },
    });

    // ── Returns ─────────────────────────────────────────────────────
    const returns = await this.prisma.return.findMany({
      where: { customerId: userId },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { items: true },
    });

    // ── Wishlist ────────────────────────────────────────────────────
    const wishlist = await this.prisma.wishlistItem.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    // ── Wallet + last 200 transactions ─────────────────────────────
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: {
        id: true,
        balanceInPaise: true,
        currency: true,
        isBlocked: true,
        blockedReason: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    let walletTransactions: unknown[] = [];
    if (wallet) {
      walletTransactions = await this.prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          type: true,
          amountInPaise: true,
          balanceAfterInPaise: true,
          description: true,
          referenceType: true,
          referenceId: true,
          createdAt: true,
        },
      });
    }

    // ── Tax documents (metadata only) ──────────────────────────────
    const taxDocuments = await this.prisma.taxDocument.findMany({
      where: { customerId: userId, status: { notIn: ['VOIDED_DRAFT'] } },
      orderBy: { generatedAt: 'desc' },
      select: {
        id: true,
        documentNumber: true,
        documentType: true,
        financialYear: true,
        generatedAt: true,
        status: true,
        einvoiceStatus: true,
        irn: true,
        documentTotalInPaise: true,
      },
    });

    // ── Consent log (audit-derived) ────────────────────────────────
    const consentLog = await this.prisma.auditLog.findMany({
      where: {
        actorId: userId,
        module: 'consent',
        resource: 'CustomerConsent',
      },
      orderBy: { createdAt: 'desc' },
      select: {
        action: true,
        resourceId: true,
        newValue: true,
        createdAt: true,
      },
    });

    // ── Active sessions (no tokens) ────────────────────────────────
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        expiresAt: true,
        createdAt: true,
        // refreshToken intentionally omitted
      },
    });

    // ── Audit (this export itself) ─────────────────────────────────
    try {
      await this.audit.writeAuditLog({
        actorId: userId,
        actorRole: 'CUSTOMER',
        action: 'DATA_EXPORTED',
        module: 'dpdp',
        resource: 'CustomerDataExport',
        resourceId: userId,
        metadata: {
          counts: {
            addresses: addresses.length,
            orders: orders.length,
            returns: returns.length,
            wishlist: wishlist.length,
            walletTransactions: walletTransactions.length,
            taxDocuments: taxDocuments.length,
            consentLogEntries: consentLog.length,
            sessions: sessions.length,
          },
        },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
    } catch (err) {
      // Don't fail the export if the audit write fails; log and
      // proceed (the user already waited; data integrity isn't at
      // risk because the export is read-only).
      this.logger.warn(
        `Failed to write data-export audit row for user ${userId}: ${(err as Error).message}`,
      );
    }

    return {
      generatedAt: new Date().toISOString(),
      exportSchemaVersion: '1.0',
      user,
      addresses,
      orders: serialiseBigInts(orders),
      returns: serialiseBigInts(returns),
      wishlist,
      wallet: wallet ? serialiseBigInts(wallet) : null,
      walletTransactions: serialiseBigInts(walletTransactions),
      taxDocuments: serialiseBigInts(taxDocuments),
      consentLog,
      sessions,
      notes: [
        'This file contains all the personal information SportSmart holds about you.',
        'Money values are in paise (1/100 of an Indian Rupee). Divide by 100 to read in ₹.',
        'Tax invoice PDFs are not embedded — download each from /customer/tax-documents/<id>/download.',
        'Password hash and other accounts\' data are intentionally excluded.',
      ],
    };
  }
}

export interface CustomerDataExportPayload {
  generatedAt: string;
  exportSchemaVersion: string;
  user: unknown;
  addresses: unknown[];
  orders: unknown[];
  returns: unknown[];
  wishlist: unknown[];
  wallet: unknown;
  walletTransactions: unknown[];
  taxDocuments: unknown[];
  consentLog: unknown[];
  sessions: unknown[];
  notes: string[];
}

/**
 * BigInt values can't be JSON-serialised; convert them to numeric
 * strings recursively. The frontend / consumer can re-parse them as
 * BigInt or treat them as strings — both are unambiguous.
 */
function serialiseBigInts<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
  );
}
