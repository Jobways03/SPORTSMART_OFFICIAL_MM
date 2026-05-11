import type { IThinkLabelPageSize } from '../ithink.constants';

/**
 * Print Shipment Label — POST /api_v3/shipping/label.json
 *
 * Max 100 AWBs per request. Response is a single PDF URL containing
 * all requested labels. The URL points to iThink's CDN and is
 * publicly accessible; we cache it on Shipment.labelUrl and either
 * proxy or hot-link from the seller dashboard.
 */

export interface IThinkPrintLabelRequest {
  /** Comma-separated AWBs (max 100). */
  awb_numbers: string;
  /** A4 default; A6 thermal-printer-friendly. */
  page_size?: IThinkLabelPageSize;
  /** 1=yes, 0=no, blank=account default. */
  display_cod_prepaid?: '0' | '1' | '';
  /** 1=yes, 0=no, blank=account default. */
  display_shipper_mobile?: '0' | '1' | '';
  /** 1=yes, 0=no, blank=account default. */
  display_shipper_address?: '0' | '1' | '';
}

export interface IThinkPrintLabelResponse {
  status: 'success' | string;
  status_code: number;
  /** Direct PDF URL containing all requested labels. */
  file_name: string;
}
