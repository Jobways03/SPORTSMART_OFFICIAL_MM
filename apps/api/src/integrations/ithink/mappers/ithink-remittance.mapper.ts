import type { IThinkRemittanceLineRow } from '../dtos/get-remittance-details.dto';
import type { IThinkRemittanceSummaryRow } from '../dtos/get-remittance.dto';

/**
 * Reconciliation-friendly shapes for the daily COD remittance pulls.
 * Amounts are converted to **paise BigInt** here because the rest of
 * the platform's money path (`liability-ledger`, `wallet`, `settlements`)
 * is paise-native. Keeping rupees-as-string in domain code creates
 * float drift the audit (finding C7) already flagged.
 */

export interface RemittanceSummary {
  remittanceId: string;
  remittanceDate: string;
  codGeneratedPaise: bigint;
  billAdjustedPaise: bigint;
  refundAdjustedPaise: bigint;
  transactionChargesPaise: bigint;
  transactionGstChargesPaise: bigint;
  walletAmountPaise: bigint;
  advanceHoldPaise: bigint;
  codRemittedPaise: bigint;
}

export interface RemittanceLine {
  awb: string;
  orderNumber: string;
  pricePaise: bigint;
  deliveredAt?: Date;
}

/**
 * Convert "12.34" rupees → 1234n paise without floating-point drift.
 * Splits on the decimal point and pads/truncates the fractional part
 * to exactly 2 digits, so "12.3" → 1230n, "12" → 1200n, "12.345" → 1234n
 * (truncated, not rounded — courier reports are authoritative as-is).
 */
export function rupeesStringToPaise(rupees: string | number | null | undefined): bigint {
  if (rupees === null || rupees === undefined || rupees === '') return 0n;
  const str = typeof rupees === 'number' ? rupees.toFixed(2) : rupees.toString().trim();
  const negative = str.startsWith('-');
  const cleaned = negative ? str.slice(1) : str;
  const [whole, fracRaw = ''] = cleaned.split('.');
  const frac = (fracRaw + '00').slice(0, 2);
  const onlyDigits = /^\d*$/.test(whole ?? '') && /^\d*$/.test(frac);
  if (!onlyDigits) return 0n;
  const totalPaise = BigInt(whole || '0') * 100n + BigInt(frac);
  return negative ? -totalPaise : totalPaise;
}

export function normaliseRemittanceSummary(
  row: IThinkRemittanceSummaryRow,
): RemittanceSummary {
  return {
    remittanceId: row.remittance_id,
    remittanceDate: row.remittance_date,
    codGeneratedPaise: rupeesStringToPaise(row.cod_generated),
    billAdjustedPaise: rupeesStringToPaise(row.bill_adjusted),
    refundAdjustedPaise: rupeesStringToPaise(row.refund_adjusted),
    transactionChargesPaise: rupeesStringToPaise(row.transaction_charges),
    transactionGstChargesPaise: rupeesStringToPaise(row.transaction_gst_charges),
    walletAmountPaise: rupeesStringToPaise(row.wallet_amount),
    advanceHoldPaise: rupeesStringToPaise(row.advance_hold),
    codRemittedPaise: rupeesStringToPaise(row.cod_remitted),
  };
}

export function normaliseRemittanceLine(row: IThinkRemittanceLineRow): RemittanceLine {
  const deliveredAt = row.delivered_date
    ? new Date(row.delivered_date.replace(' ', 'T'))
    : undefined;
  return {
    awb: row.airway_bill_no,
    orderNumber: row.order_no,
    pricePaise: rupeesStringToPaise(row.price),
    deliveredAt: deliveredAt && !Number.isNaN(deliveredAt.getTime()) ? deliveredAt : undefined,
  };
}
