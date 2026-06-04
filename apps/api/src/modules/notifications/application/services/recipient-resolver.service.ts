import { Injectable } from '@nestjs/common';
import type { NotificationChannel } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

export interface ResolvedRecipient {
  /** True when the recipientId matches a known actor row (any table). */
  found: boolean;
  /** The contact for the requested channel, or null (found but no contact). */
  destination: string | null;
}

/**
 * Phase 187 (#7/#10) — resolve a platform recipientId to a channel-specific
 * destination across the five actor tables (User / Seller / Admin /
 * FranchisePartner / Affiliate).
 *
 * Extracted from NotificationWorker.resolveDestination so the admin
 * dispatch path can (a) reject an unknown recipientId with a clear 404
 * instead of silently dropping it at send time, and (b) snapshot the
 * contact at dispatch time for the audit record. The worker now delegates
 * here so there's a single source of truth for the lookup order.
 */
@Injectable()
export class RecipientResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    recipientId: string,
    channel: NotificationChannel,
  ): Promise<ResolvedRecipient> {
    const wantsPhone = channel === 'SMS' || channel === 'WHATSAPP';

    const user = await this.prisma.user.findUnique({
      where: { id: recipientId },
      select: { email: true, phone: true },
    });
    if (user) return { found: true, destination: wantsPhone ? user.phone : user.email };

    const seller = await this.prisma.seller.findUnique({
      where: { id: recipientId },
      select: { email: true, phoneNumber: true },
    });
    if (seller) {
      return { found: true, destination: wantsPhone ? seller.phoneNumber : seller.email };
    }

    const admin = await this.prisma.admin.findUnique({
      where: { id: recipientId },
      select: { email: true },
    });
    if (admin) return { found: true, destination: wantsPhone ? null : admin.email };

    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: recipientId },
      select: { email: true, phoneNumber: true },
    });
    if (franchise) {
      return { found: true, destination: wantsPhone ? franchise.phoneNumber : franchise.email };
    }

    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: recipientId },
      select: { email: true, phone: true },
    });
    if (affiliate) {
      return { found: true, destination: wantsPhone ? affiliate.phone : affiliate.email };
    }

    return { found: false, destination: null };
  }
}
