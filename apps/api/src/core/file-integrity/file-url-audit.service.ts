import { Injectable, Logger } from '@nestjs/common';
import type { FilePurpose } from '@prisma/client';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { TooManyRequestsAppException } from '../exceptions';

/**
 * Phase 7 (PR 7.3) — Signed URL audit + rate limit.
 *
 * Two responsibilities:
 *   1. Stamp a row in `file_url_audits` for every issuance attempt
 *      (allowed AND denied). Incident response joins this with
 *      `file_attachments` and `disputes` to answer "who pulled this
 *      KYC doc in the last hour?".
 *   2. Cap per-(file, requester) issuances. A single requester pulling
 *      the same KYC doc URL 100 times in 10 minutes is suspicious —
 *      we deny new requests beyond the configured ceiling.
 *
 * Per-purpose TTL caps live here so the file service can ask "what's
 * the right TTL for this purpose?" without each caller hard-coding 300.
 *
 * The rate-limit ceiling is intentionally generous (default 30 per 10
 * minutes per (file, requester)). The point is to catch automated
 * harvesting, not to throttle legitimate UI usage.
 */

const PURPOSE_TTL_CAPS: Record<string, number> = {
  // KYC docs: short TTL — the admin reviews once, no need to be reusable.
  KYC_DOCUMENT: 60,
  BANK_PROOF: 60,
  INVOICE: 120,
  // Evidence is reviewed by ops + sometimes shown to the buyer; 5min
  // is enough for a tab-switch but not for sharing.
  QC_EVIDENCE: 300,
  DISPUTE_EVIDENCE: 300,
  // Customer/seller-facing files (avatars, product images): standard.
  AVATAR: 600,
  PRODUCT_IMAGE: 600,
  PRODUCT_VIDEO: 600,
  BANNER: 600,
  TICKET_ATTACHMENT: 600,
  OTHER: 600,
};

const DEFAULT_TTL = 300;

@Injectable()
export class FileUrlAuditService {
  private readonly logger = new Logger(FileUrlAuditService.name);

  /** Max issuances per (file, requester) within RATE_WINDOW_MS. */
  private static readonly RATE_LIMIT = 30;
  private static readonly RATE_WINDOW_MS = 10 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * What TTL should we ask the storage adapter to mint? Caller passes
   * the purpose and an optional caller-preferred TTL; we floor against
   * the cap so a caller can't bypass tight retention by asking for 24h.
   */
  ttlForPurpose(purpose: FilePurpose, callerHint?: number): number {
    const cap = PURPOSE_TTL_CAPS[purpose] ?? DEFAULT_TTL;
    if (callerHint && callerHint > 0) return Math.min(callerHint, cap);
    return cap;
  }

  /**
   * Record an attempt. Throws TooManyRequestsAppException if the
   * (file, requester) is over the rate limit. The deny is also
   * recorded (denied=true) so the audit trail shows the attempt.
   *
   * Returns the persisted row so the caller can correlate logs.
   */
  async recordAttempt(input: {
    fileId: string;
    requesterId: string;
    requesterType: string;
    requesterRole?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    ttlSeconds: number;
  }): Promise<{ allowed: boolean; rowId: string }> {
    // Rate-limit check.
    const since = new Date(
      Date.now() - FileUrlAuditService.RATE_WINDOW_MS,
    );
    const recent = await this.prisma.fileUrlAudit.count({
      where: {
        fileId: input.fileId,
        requesterId: input.requesterId,
        denied: false,
        createdAt: { gte: since },
      },
    });

    if (recent >= FileUrlAuditService.RATE_LIMIT) {
      const denied = await this.prisma.fileUrlAudit.create({
        data: {
          fileId: input.fileId,
          requesterId: input.requesterId,
          requesterType: input.requesterType,
          requesterRole: input.requesterRole ?? null,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          ttlSeconds: input.ttlSeconds,
          denied: true,
          denyReason: `rate-limit: ${recent} issuances in last ${
            FileUrlAuditService.RATE_WINDOW_MS / 60_000
          }min`,
        },
      });
      throw new TooManyRequestsAppException(
        `Too many secure-URL requests for this file. Try again later.`,
      );
    }

    const row = await this.prisma.fileUrlAudit.create({
      data: {
        fileId: input.fileId,
        requesterId: input.requesterId,
        requesterType: input.requesterType,
        requesterRole: input.requesterRole ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        ttlSeconds: input.ttlSeconds,
        expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
        denied: false,
      },
    });
    return { allowed: true, rowId: row.id };
  }
}
