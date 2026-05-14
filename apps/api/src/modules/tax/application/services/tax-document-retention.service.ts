// Phase 21 GST — TaxDocumentRetentionService.
//
// Surfaces statutory-retention information for two callers:
//
//   1. ErasureService — needs to know whether a user's tax documents
//      are still under retention so the erasure outcome JSON captures
//      "PII redacted on users row; N tax_documents preserved under
//      statutory hold". This is NOT a blocker — the user's right to
//      erasure is satisfied by users-row redaction; the documents
//      retain their own snapshotted PII as statutory evidence.
//
//   2. Phase 25 admin UI — shows the user's "compliance hold" badge
//      so admins reviewing an erasure don't get confused that the
//      buyer_legal_name on an invoice differs from the redacted
//      users.first_name.
//
// The service does no writes — it reads from `tax_documents` +
// statutory-retention math. Documents that have aged out of retention
// are still eligible for archival; that's a separate ops workflow
// (later phase).

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import {
  computeRetentionExpiry,
  DEFAULT_STATUTORY_RETENTION_YEARS,
  isUnderStatutoryRetention,
} from '../../domain/statutory-retention';

export interface UserRetentionSummary {
  userId: string;
  /** Total tax_documents where this user is the customer (any status). */
  totalDocuments: number;
  /** Subset still under the statutory retention window. */
  documentsUnderRetention: number;
  /** Earliest issuance date across all retained docs (null if none). */
  earliestDocumentDate: Date | null;
  /** Latest retention expiry across all retained docs. After this date,
   *  no statutory hold remains and the user's records can be fully
   *  archived. Null when totalDocuments === 0. */
  latestRetentionExpiry: Date | null;
  /** Years used for the window — captured here so the UI can show
   *  "documents preserved for 8 years per Section 36" without
   *  hard-coding the value. */
  retentionYears: number;
  /** Boolean shortcut for the erasure outcome JSON. */
  hasActiveStatutoryHold: boolean;
}

@Injectable()
export class TaxDocumentRetentionService {
  private readonly logger = new Logger(TaxDocumentRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {}

  /**
   * Reads the env-tunable override (`TAX_DOCUMENT_RETENTION_YEARS`)
   * falling back to the policy default of 8.
   */
  retentionYears(): number {
    return this.env.getNumber(
      'TAX_DOCUMENT_RETENTION_YEARS' as any,
      DEFAULT_STATUTORY_RETENTION_YEARS,
    );
  }

  /**
   * Build the retention summary for one customer. Used by the erasure
   * service + admin compliance UI.
   */
  async getRetentionSummaryForUser(
    userId: string,
    now: Date = new Date(),
  ): Promise<UserRetentionSummary> {
    const retentionYears = this.retentionYears();
    const docs = await this.prisma.taxDocument.findMany({
      where: {
        customerId: userId,
        // Even VOIDED_DRAFT documents stay in the count — the row
        // itself is a statutory record of the issuance attempt.
      },
      select: { generatedAt: true, createdAt: true },
    });

    if (docs.length === 0) {
      return {
        userId,
        totalDocuments: 0,
        documentsUnderRetention: 0,
        earliestDocumentDate: null,
        latestRetentionExpiry: null,
        retentionYears,
        hasActiveStatutoryHold: false,
      };
    }

    let documentsUnderRetention = 0;
    let earliestDocumentDate: Date | null = null;
    let latestRetentionExpiry: Date | null = null;

    for (const d of docs) {
      // Prefer the legally-issued timestamp; fall back to createdAt
      // for never-issued drafts.
      const issuedAt = d.generatedAt ?? d.createdAt;
      if (
        !earliestDocumentDate ||
        issuedAt.getTime() < earliestDocumentDate.getTime()
      ) {
        earliestDocumentDate = issuedAt;
      }
      const expiry = computeRetentionExpiry(issuedAt, retentionYears);
      if (
        !latestRetentionExpiry ||
        expiry.getTime() > latestRetentionExpiry.getTime()
      ) {
        latestRetentionExpiry = expiry;
      }
      if (isUnderStatutoryRetention(issuedAt, now, retentionYears)) {
        documentsUnderRetention++;
      }
    }

    return {
      userId,
      totalDocuments: docs.length,
      documentsUnderRetention,
      earliestDocumentDate,
      latestRetentionExpiry,
      retentionYears,
      hasActiveStatutoryHold: documentsUnderRetention > 0,
    };
  }

  /**
   * Returns true when this specific document is still inside the
   * statutory window. Helper for ops "is this safe to archive?" calls.
   */
  async isDocumentUnderRetention(
    documentId: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    const retentionYears = this.retentionYears();
    const doc = await this.prisma.taxDocument.findUnique({
      where: { id: documentId },
      select: { generatedAt: true, createdAt: true },
    });
    if (!doc) return false;
    const issuedAt = doc.generatedAt ?? doc.createdAt;
    return isUnderStatutoryRetention(issuedAt, now, retentionYears);
  }
}
