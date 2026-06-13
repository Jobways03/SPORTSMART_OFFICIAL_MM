import { apiClient } from '@/lib/api-client';

// Phase 252 — settlement tax config editor (GST / TCS / TDS rate + base).
// Backed by the tax_config store via /admin/tax/config/settlement-charges. The
// statutory engine reads these so a CA / regulatory change (e.g. "TDS on
// commission, not product") is a config edit that flows to BOTH the payout AND
// the GSTR-8 / Form-26Q / GSTR-1 filings.

export type TaxBaseType = 'COMMISSION' | 'PRICE_OF_GOODS_SOLD' | 'GST';

export interface OneTaxConfig {
  rateBps: number;
  baseType: TaxBaseType;
}

export interface SettlementTaxConfig {
  gst: OneTaxConfig;
  tcs: OneTaxConfig;
  tds: OneTaxConfig;
}

export interface SettlementTaxConfigInput {
  gst?: { rateBps?: number; baseType?: TaxBaseType };
  tcs?: { rateBps?: number; baseType?: TaxBaseType };
  tds?: { rateBps?: number; baseType?: TaxBaseType };
}

export const adminSettlementTaxService = {
  get() {
    return apiClient<SettlementTaxConfig>(
      '/admin/tax/config/settlement-charges',
    );
  },
  save(input: SettlementTaxConfigInput) {
    return apiClient<SettlementTaxConfig>(
      '/admin/tax/config/settlement-charges',
      { method: 'PUT', body: JSON.stringify(input) },
    );
  },
};
