import { Injectable } from '@nestjs/common';
import { BadRequestAppException } from '../../core/exceptions';
import { parseCsvRecords } from '../../core/utils';

export interface ParsedIngestRow {
  settlementId: string;
  status: 'PAID' | 'FAILED';
  paidAmountInPaise?: bigint;
  utrReference?: string;
  failureReason?: string;
}

export interface ParsedBankResponse {
  rows: ParsedIngestRow[];
  rawRows: Array<Record<string, string>>;
}

// Status tokens banks use, normalised to our two outcomes.
const PAID_TOKENS = new Set(['PAID', 'SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'PROCESSED', 'SETTLED']);
const FAILED_TOKENS = new Set(['FAILED', 'FAILURE', 'REJECTED', 'RETURNED', 'REVERSED', 'BOUNCED', 'CANCELLED']);

const pick = (rec: Record<string, string>, keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = rec[k];
    if (v !== undefined && v.trim() !== '') return v.trim();
  }
  return undefined;
};

/** Rupees decimal string → integer paise (no float drift). */
function rupeesToPaise(s: string): bigint | undefined {
  const t = s.trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return undefined;
  const neg = t.startsWith('-');
  const u = neg ? t.slice(1) : t;
  const [intPart, frac = ''] = u.split('.');
  const paise = BigInt(`${intPart}${(frac + '00').slice(0, 2)}`);
  return neg ? -paise : paise;
}

/**
 * Phase 152 — bank-response CSV parser.
 *
 * The supported format is the round-trip of the file we EXPORT (Phase 151):
 * the bank annotates each row with a `status`, the amount it actually paid,
 * and a UTR. Column names are matched case-insensitively with a small alias
 * set so minor header variation (utr vs utr_reference, paid_amount vs
 * paid_amount_in_paise) parses without a bank-specific adapter. Per-bank
 * native formats plug in as additional strategies behind `parse()`.
 */
@Injectable()
export class BankResponseParserService {
  parse(csvText: string): ParsedBankResponse {
    const records = parseCsvRecords(csvText);
    if (records.length === 0) {
      throw new BadRequestAppException(
        'The uploaded CSV has no data rows (expected a header + at least one row).',
      );
    }

    const rows: ParsedIngestRow[] = [];
    records.forEach((rec, idx) => {
      const settlementId = pick(rec, ['settlement_id', 'settlementid', 'settlement']);
      if (!settlementId) {
        throw new BadRequestAppException(
          `Row ${idx + 2}: missing settlement_id column.`,
        );
      }

      const statusRaw = (pick(rec, ['status', 'payment_status', 'txn_status']) ?? '').toUpperCase();
      let status: 'PAID' | 'FAILED';
      if (PAID_TOKENS.has(statusRaw)) status = 'PAID';
      else if (FAILED_TOKENS.has(statusRaw)) status = 'FAILED';
      else {
        throw new BadRequestAppException(
          `Row ${idx + 2} (settlement ${settlementId.slice(0, 8)}): unrecognised status "${statusRaw}".`,
        );
      }

      // Prefer an explicit paise column; else rupees (paid or the exported
      // expected amount, meaning "bank paid the full amount").
      const paiseRaw = pick(rec, ['paid_amount_in_paise', 'amount_in_paise']);
      const rupeesRaw = pick(rec, ['paid_amount', 'paid_amount_rupees', 'amount']);
      let paidAmountInPaise: bigint | undefined;
      if (paiseRaw && /^-?\d+$/.test(paiseRaw)) {
        paidAmountInPaise = BigInt(paiseRaw);
      } else if (rupeesRaw) {
        paidAmountInPaise = rupeesToPaise(rupeesRaw);
      }
      if (paidAmountInPaise !== undefined && paidAmountInPaise < 0n) {
        throw new BadRequestAppException(
          `Row ${idx + 2} (settlement ${settlementId.slice(0, 8)}): negative paid amount.`,
        );
      }

      rows.push({
        settlementId,
        status,
        paidAmountInPaise,
        utrReference: pick(rec, ['utr', 'utr_reference', 'utr_no', 'reference', 'reference_no']),
        failureReason: pick(rec, ['failure_reason', 'reason', 'remarks', 'remark', 'error']),
      });
    });

    return { rows, rawRows: records };
  }
}
