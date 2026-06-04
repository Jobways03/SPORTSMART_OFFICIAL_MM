import { Injectable } from '@nestjs/common';
import { DelhiveryClient } from '../clients/delhivery.client';
import type { PrintLabelResult } from '../../../modules/shipments/application/ports/outbound/courier-gateway.port';
import {
  DELHIVERY_LABEL_MAX_AWBS,
  DELHIVERY_PATHS,
} from '../delhivery.constants';
import type {
  DelhiveryCanonicalLabelResult,
  DelhiveryLabelJsonResponse,
  DelhiveryLabelPdfResponse,
  DelhiveryLabelPdfSize,
  DelhiveryLabelResponse,
} from '../dtos/delhivery-label.dto';
import { CarrierError } from './delhivery-order.service';
import { mapDelhiveryError } from '../mappers/delhivery-error.mapper';

/**
 * Label / packing-slip surface.
 *
 * GET `/api/p/packing_slip?wbns=<csv>&pdf=true&pdf_size=A4`.
 *   • pdf=true  -> Delhivery hosts a PDF on S3 and returns the link.
 *   • pdf=false -> JSON payload for custom slip rendering.
 *
 * The service exposes both: `generateLabel` is the typed primary
 * surface, `printLabel` is the legacy `CourierGatewayPort` shim.
 */
@Injectable()
export class DelhiveryLabelService {
  constructor(private readonly client: DelhiveryClient) {}

  /**
   * Generate a packing slip for one or more AWBs.
   *
   *   • format='pdf'  -> S3 URL surfaced as fileUrl.
   *   • format='json' -> raw JSON returned for custom rendering.
   *
   * Returns the canonical result shape — callers branch on `format`.
   */
  async generateLabel(
    awbs: string[] | string,
    opts: {
      format?: 'pdf' | 'json';
      pdfSize?: DelhiveryLabelPdfSize;
    } = {},
  ): Promise<DelhiveryCanonicalLabelResult> {
    const list = Array.isArray(awbs) ? awbs : [awbs];
    if (list.length === 0) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail: 'generateLabel requires at least one AWB.',
        retryable: false,
      });
    }
    if (list.length > DELHIVERY_LABEL_MAX_AWBS) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail: `generateLabel caps at ${DELHIVERY_LABEL_MAX_AWBS} AWBs per call.`,
        retryable: false,
      });
    }

    const format = opts.format ?? 'pdf';
    const pdfSize = opts.pdfSize ?? 'A4';

    const response = await this.client.get<DelhiveryLabelResponse>(
      DELHIVERY_PATHS.LABEL,
      {
        wbns: list.join(','),
        pdf: format === 'pdf' ? 'true' : 'false',
        pdf_size: pdfSize,
      },
    );

    if (response.status < 200 || response.status >= 300) {
      throw new CarrierError(mapDelhiveryError(response.status, response.body));
    }

    const body = response.body;
    if (format === 'pdf') {
      const pdf = body as DelhiveryLabelPdfResponse;
      // Delhivery nests the S3 link PER-AWB under packages[].pdf_download_link
      // (verified against staging). A few accounts surface it at the top
      // level, so check both. The inline base64 `pdf_encoding` is ignored —
      // the hosted link is simpler to open + print.
      const fileUrl =
        pdf?.pdf_download_link ??
        pdf?.url ??
        pdf?.packages?.find((p) => p?.pdf_download_link)?.pdf_download_link;
      if (!fileUrl) {
        throw new CarrierError(mapDelhiveryError(response.status, response.body));
      }
      return {
        format: 'pdf',
        awbs: list,
        fileUrl,
      };
    }
    return {
      format: 'json',
      awbs: list,
      rawJson: body as DelhiveryLabelJsonResponse,
    };
  }

  /**
   * Legacy port shim. Returns the PDF URL.
   *
   * Requests the 4R (4x6") thermal-sticker size rather than A4. NOTE (verified
   * 2026-06-04): Delhivery STAGING ignores `pdf_size` on /api/p/packing_slip —
   * it returns the A4 slip regardless (tested A4/4R/4x6/A6, all 595x842pt). We
   * still ask for 4R because production may honour it; if a guaranteed clean
   * layout is needed, generate our own label instead of Delhivery's slip.
   */
  async printLabel(awbs: string[]): Promise<PrintLabelResult> {
    const result = await this.generateLabel(awbs, {
      format: 'pdf',
      pdfSize: '4R',
    });
    if (!result.fileUrl) {
      throw new CarrierError({
        code: 'PARTNER_REJECTED',
        detail: 'Delhivery returned no PDF link for the requested AWBs.',
        retryable: false,
      });
    }
    return { fileUrl: result.fileUrl };
  }
}
