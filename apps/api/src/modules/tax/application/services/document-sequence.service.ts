// Phase 8 of the GST/tax/invoice system — DocumentSequenceService.
//
// Atomic monotonic-number generation for tax documents. One logical
// series per (supplierGstin, financialYear, documentType); each call
// to `nextNumber()` advances the series by exactly one and returns
// the freshly-allocated number string.
//
// Concurrency: implemented via Postgres
//   INSERT ... ON CONFLICT (sequence_key) DO UPDATE
//     SET last_number = last_number + 1
//     RETURNING last_number, prefix
// — this is a single atomic statement, race-free without
// SERIALIZABLE isolation. Two concurrent calls always get distinct
// numbers; the loser of the race simply increments after the winner.
//
// Number format: `{prefix}-{zerofill6(lastNumber)}` — e.g.
//   SM-INV-000001 / SM-BOS-000017 / SM-CN-000003.
//
// Series prefixes (default — admin may override the row's `prefix`):
//   TAX_INVOICE                  → SM-INV
//   BILL_OF_SUPPLY               → SM-BOS
//   INVOICE_CUM_BILL_OF_SUPPLY   → SM-IBOS
//   CREDIT_NOTE                  → SM-CN
//   DEBIT_NOTE                   → SM-DN
//   LEGACY_RECEIPT               → SM-LR
//
// Sequence key shape:
//   `{supplierGstin or "PLATFORM"}|{financialYear}|{documentType}`
//
// See:
//   - docs/tax/CA.md §3 row "Document numbering" + §4 row "Invoice
//     number format"
//   - docs/tax/INVOICE_CANCELLATION_POLICY.md (skipped_numbers semantics)

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { Prisma, type DocumentType } from '@prisma/client';

export const DEFAULT_PREFIX_FOR: Record<DocumentType, string> = {
  TAX_INVOICE:                'SM-INV',
  BILL_OF_SUPPLY:             'SM-BOS',
  INVOICE_CUM_BILL_OF_SUPPLY: 'SM-IBOS',
  CREDIT_NOTE:                'SM-CN',
  DEBIT_NOTE:                 'SM-DN',
  LEGACY_RECEIPT:             'SM-LR',
};

export const NUMBER_PAD_WIDTH = 6;

export interface DocumentSequenceResult {
  documentNumber: string;     // formatted, e.g. "SM-INV-000042"
  sequenceKey: string;        // internal scope key
  lastNumber: number;         // raw integer for ledger/skipped tracking
  prefix: string;
  supplierGstin: string | null;
  financialYear: string;
  documentType: DocumentType;
}

@Injectable()
export class DocumentSequenceService {
  private readonly logger = new Logger(DocumentSequenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compute the financial-year string for a given date in IST.
   * FY 2026-27 = 1 Apr 2026 → 31 Mar 2027.
   *
   * Implementation note: Postgres stores UTC; the IST FY boundary
   * (1 Apr 00:00 IST = 31 Mar 18:30 UTC) means we add 5h30m to the
   * UTC instant before bucketing. This avoids March 31 evening orders
   * being filed in the wrong FY.
   */
  static financialYearOf(date: Date = new Date()): string {
    const utcMs = date.getTime();
    const istMs = utcMs + 5.5 * 60 * 60 * 1000;
    const istDate = new Date(istMs);
    // April 1 onwards = the FY starting in that calendar year.
    const m = istDate.getUTCMonth(); // 0 = Jan
    const y = istDate.getUTCFullYear();
    const fyStart = m >= 3 ? y : y - 1;
    const fyEnd = (fyStart + 1) % 100;
    return `${fyStart}-${fyEnd.toString().padStart(2, '0')}`;
  }

  /**
   * Build the sequence key for a (supplier, FY, type) triple.
   * Stable / canonical / matches what's stored in DB.
   */
  static sequenceKeyOf(
    supplierGstin: string | null,
    financialYear: string,
    documentType: DocumentType,
  ): string {
    return `${supplierGstin ?? 'PLATFORM'}|${financialYear}|${documentType}`;
  }

  /**
   * Atomically advance the sequence for (supplierGstin, FY, docType)
   * and return the next document number string.
   *
   * Race-safe: uses INSERT ... ON CONFLICT DO UPDATE to get exactly
   * one increment per call, even under concurrent invocation.
   */
  async nextNumber(input: {
    supplierGstin: string | null;
    financialYear: string;
    documentType: DocumentType;
    /** Optional override of the default prefix for this series. Once
     *  the row exists, the prefix is locked — passing a different
     *  prefix later is ignored by the SQL. */
    prefix?: string;
  }): Promise<DocumentSequenceResult> {
    const { supplierGstin, financialYear, documentType } = input;
    const sequenceKey = DocumentSequenceService.sequenceKeyOf(
      supplierGstin,
      financialYear,
      documentType,
    );
    const initialPrefix = input.prefix ?? DEFAULT_PREFIX_FOR[documentType];

    // Atomic upsert + increment via raw SQL. Returns the newly
    // allocated number + the stored prefix (which may differ from
    // initialPrefix if the row pre-existed with an admin-set prefix).
    const rows = await this.prisma.$queryRaw<
      Array<{ last_number: number; prefix: string }>
    >`
      INSERT INTO "document_sequences"
        ("id", "sequence_key", "supplier_gstin", "financial_year",
         "document_type", "prefix", "last_number", "skipped_numbers",
         "created_at", "updated_at")
      VALUES
        (gen_random_uuid()::text, ${sequenceKey}, ${supplierGstin},
         ${financialYear}, ${documentType}::"DocumentType",
         ${initialPrefix}, 1, '[]'::jsonb, NOW(), NOW())
      ON CONFLICT ("sequence_key") DO UPDATE
        SET "last_number" = "document_sequences"."last_number" + 1,
            "updated_at"  = NOW()
      RETURNING "last_number", "prefix";
    `;

    if (!rows[0]) {
      // Should never happen — RETURNING always returns the row.
      throw new Error(`DocumentSequenceService: no row returned for ${sequenceKey}`);
    }

    const { last_number: lastNumber, prefix } = rows[0];
    const padded = lastNumber.toString().padStart(NUMBER_PAD_WIDTH, '0');
    const documentNumber = `${prefix}-${padded}`;

    return {
      documentNumber,
      sequenceKey,
      lastNumber,
      prefix,
      supplierGstin,
      financialYear,
      documentType,
    };
  }

  /**
   * Read-only preview of the next number — does NOT advance the
   * sequence. Useful for admin UI "next document number will be …"
   * hints. Subject to race if generation happens between preview and
   * actual nextNumber call; UI should re-confirm before commit.
   */
  async previewNext(input: {
    supplierGstin: string | null;
    financialYear: string;
    documentType: DocumentType;
  }): Promise<string> {
    const sequenceKey = DocumentSequenceService.sequenceKeyOf(
      input.supplierGstin,
      input.financialYear,
      input.documentType,
    );
    const row = await this.prisma.documentSequence.findUnique({
      where: { sequenceKey },
      select: { prefix: true, lastNumber: true },
    });
    const prefix = row?.prefix ?? DEFAULT_PREFIX_FOR[input.documentType];
    const lastNumber = row?.lastNumber ?? 0;
    const padded = (lastNumber + 1).toString().padStart(NUMBER_PAD_WIDTH, '0');
    return `${prefix}-${padded}`;
  }

  /**
   * Mark a number as skipped (cancelled / voided draft) in the
   * sequence's audit JSON. The sequence's lastNumber is NOT decremented
   * — once a number is allocated it stays burnt forever, per GST law.
   */
  async markSkipped(
    sequenceKey: string,
    skippedNumber: number,
    reason: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.documentSequence.findUnique({
        where: { sequenceKey },
      });
      if (!row) {
        this.logger.warn(`markSkipped: no sequence row for key=${sequenceKey}`);
        return;
      }
      const existing = Array.isArray(row.skippedNumbers)
        ? (row.skippedNumbers as Array<{ number: number; reason: string; at: string }>)
        : [];
      existing.push({
        number: skippedNumber,
        reason,
        at: new Date().toISOString(),
      });
      await tx.documentSequence.update({
        where: { sequenceKey },
        data: { skippedNumbers: existing as unknown as Prisma.InputJsonValue },
      });
    });
  }
}
