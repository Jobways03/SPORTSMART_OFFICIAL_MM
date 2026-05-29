import type { Prisma } from '@prisma/client';

export interface AttachReferralAttributionInput {
  orderId: string;
  affiliateId: string;
  source: 'LINK' | 'COUPON';
  code: string | null;
  customerId?: string | null;
  couponCodeId?: string | null;
}

/**
 * Phase 159c — single source of truth for writing a ReferralAttribution
 * inside an order transaction. Shared by the checkout order tx
 * (prisma-checkout.repository) and the unified-discount redemption hook
 * (AffiliatePublicFacade.attachAttributionToOrder) — these were two
 * duplicated copies, a behaviour-drift risk (audit M2). MUST be called
 * inside a Prisma transaction.
 *
 * For a COUPON-sourced attribution it takes a `SELECT … FOR UPDATE` lock on
 * the coupon row, re-checks maxUses + perUserLimit under the lock, increments
 * usedCount, then writes the attribution row. Cap overshoot throws
 * AFFILIATE_MAX_USES_REACHED / AFFILIATE_PER_USER_LIMIT_REACHED to unwind the
 * order (loud, not silent). The attribution insert swallows P2002 only
 * (idempotent on the unique orderId — safe for retries / duplicate webhooks),
 * which also gives the checkout path the idempotency it previously lacked
 * (audit M3).
 */
export async function attachReferralAttribution(
  tx: Prisma.TransactionClient,
  input: AttachReferralAttributionInput,
): Promise<void> {
  const canonical = input.code ? input.code.trim().toUpperCase() : null;

  if (input.source === 'COUPON' && canonical) {
    const locked = await tx.$queryRaw<
      Array<{
        id: string;
        max_uses: number | null;
        used_count: number;
        per_user_limit: number;
      }>
    >`
      SELECT id, max_uses, used_count, per_user_limit
      FROM affiliate_coupon_codes
      WHERE code = ${canonical}
      FOR UPDATE
    `;
    const lockedRow = locked[0];
    if (lockedRow) {
      // maxUses re-check INSIDE the lock — two concurrent attaches that both
      // passed validate-time now serialise here; the second sees the cap.
      if (lockedRow.max_uses !== null && lockedRow.used_count >= lockedRow.max_uses) {
        throw Object.assign(
          new Error('This affiliate code has reached its usage limit.'),
          { code: 'AFFILIATE_MAX_USES_REACHED' },
        );
      }
      // perUserLimit (0 = unlimited; >0 caps distinct redemptions per customer).
      if (lockedRow.per_user_limit > 0 && input.customerId) {
        const priorUses = await tx.referralAttribution.count({
          where: {
            code: canonical,
            affiliateId: input.affiliateId,
            customerId: input.customerId,
          },
        });
        if (priorUses >= lockedRow.per_user_limit) {
          throw Object.assign(
            new Error('You have already used this affiliate code.'),
            { code: 'AFFILIATE_PER_USER_LIMIT_REACHED' },
          );
        }
      }
      // Increment inside the lock so the next FOR UPDATE sees the new count.
      // NOT catch-swallowed (Phase 67) — a failed increment unwinds the tx.
      await tx.affiliateCouponCode.update({
        where: { id: lockedRow.id },
        data: { usedCount: { increment: 1 } },
      });
    }
  }

  try {
    await tx.referralAttribution.create({
      data: {
        orderId: input.orderId,
        affiliateId: input.affiliateId,
        source: input.source,
        // Persist the canonical (upper-cased) code so the perUserLimit count
        // matches case-insensitively for future attachments.
        code: canonical,
        customerId: input.customerId ?? null,
        couponCodeId: input.couponCodeId ?? null,
      },
    });
  } catch (err: any) {
    if (err?.code !== 'P2002') throw err; // idempotent on the unique orderId
  }
}
