import { BadRequestException, Injectable } from '@nestjs/common';

import { IThinkClient } from '../clients/ithink.client';
import {
  ITHINK_BATCH_LIMITS,
  type IThinkLabelPageSize,
} from '../ithink.constants';
import type {
  IThinkPrintLabelRequest,
  IThinkPrintLabelResponse,
} from '../dtos/print-label.dto';
import type {
  IThinkPrintManifestRequest,
  IThinkPrintManifestResponse,
} from '../dtos/print-manifest.dto';
import type {
  IThinkPrintInvoiceRequest,
  IThinkPrintInvoiceResponse,
} from '../dtos/print-invoice.dto';

/**
 * Print-document endpoints. All three (Label, Manifest, Invoice) return
 * a single PDF URL from iThink's CDN; we surface that to the
 * seller/franchise dashboard for download/print.
 *
 * The URL is publicly accessible — anyone with the link can read it.
 * For sensitive accounts we proxy through our own endpoint with
 * auth-gated download instead of hot-linking; for now hot-link.
 */
@Injectable()
export class IThinkShippingDocsService {
  constructor(private readonly client: IThinkClient) {}

  async printLabel(input: {
    awbs: string[];
    pageSize?: IThinkLabelPageSize;
    displayCodPrepaid?: boolean;
    displayShipperMobile?: boolean;
    displayShipperAddress?: boolean;
  }): Promise<IThinkPrintLabelResponse> {
    this.assertBatchSize('Print Label', input.awbs, ITHINK_BATCH_LIMITS.PRINT_LABEL_AWBS);
    const body: IThinkPrintLabelRequest = {
      awb_numbers: input.awbs.join(','),
      page_size: input.pageSize ?? 'A4',
      display_cod_prepaid: toggleFlag(input.displayCodPrepaid),
      display_shipper_mobile: toggleFlag(input.displayShipperMobile),
      display_shipper_address: toggleFlag(input.displayShipperAddress),
    };
    const response = await this.client.post<unknown>(
      'PRINT_LABEL',
      body as unknown as Record<string, unknown>,
    );
    return {
      status: response.status ?? 'success',
      status_code: response.status_code ?? 200,
      file_name: response.file_name ?? '',
    };
  }

  async printManifest(awbs: string[]): Promise<IThinkPrintManifestResponse> {
    this.assertBatchSize('Print Manifest', awbs, ITHINK_BATCH_LIMITS.PRINT_LABEL_AWBS);
    const body: IThinkPrintManifestRequest = { awb_numbers: awbs.join(',') };
    const response = await this.client.post<unknown>(
      'PRINT_MANIFEST',
      body as unknown as Record<string, unknown>,
    );
    return {
      status: response.status ?? 'success',
      status_code: response.status_code ?? 200,
      file_name: response.file_name ?? '',
    };
  }

  async printInvoice(awbs: string[]): Promise<IThinkPrintInvoiceResponse> {
    this.assertBatchSize('Print Invoice', awbs, ITHINK_BATCH_LIMITS.PRINT_INVOICE_AWBS);
    const body: IThinkPrintInvoiceRequest = { awb_numbers: awbs.join(',') };
    const response = await this.client.post<unknown>(
      'PRINT_INVOICE',
      body as unknown as Record<string, unknown>,
    );
    return {
      status: response.status ?? 'success',
      status_code: response.status_code ?? 200,
      file_name: response.file_name ?? '',
    };
  }

  private assertBatchSize(label: string, awbs: string[], cap: number): void {
    if (awbs.length === 0) {
      throw new BadRequestException(`${label} requires at least one AWB`);
    }
    if (awbs.length > cap) {
      throw new BadRequestException(`${label} accepts max ${cap} AWBs per call`);
    }
  }
}

function toggleFlag(value: boolean | undefined): '0' | '1' | '' {
  if (value === undefined) return '';
  return value ? '1' : '0';
}
