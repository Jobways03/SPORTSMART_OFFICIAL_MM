// PUBLIC (no-auth) shipping-label route. Every frontend opens the label with a
// raw window.open / <a href> which carries no Bearer token, so this route is
// unguarded — the SIGNED, EXPIRING token in the path both authorizes the view
// and scopes it to one sub-order (it can't be forged or used to enumerate other
// sub-orders). Same security model as a cloud presigned URL. Rate-limited by
// the global ThrottlerGuard.
//
// Serves OUR custom 4x6 PDF; if our generation fails, it REDIRECTS to
// Delhivery's own label so a label is always available (the fallback).

import { Public } from '@core/decorators';
import { Controller, Get, Logger, Param, Res } from '@nestjs/common';
import type { Response } from 'express';

import { verifyLabelToken } from '../../application/label-token.util';
import { ShippingLabelPdfService } from '../../application/services/shipping-label-pdf.service';
import { ShippingPublicFacade } from '../../application/facades/shipping-public.facade';

@Public()
@Controller('public/shipping/labels')
export class PublicShippingLabelController {
  private readonly logger = new Logger(PublicShippingLabelController.name);

  constructor(
    private readonly labelPdf: ShippingLabelPdfService,
    private readonly facade: ShippingPublicFacade,
  ) {}

  @Get(':token')
  async serve(
    @Param('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    const subOrderId = verifyLabelToken(token);
    if (!subOrderId) {
      res
        .status(404)
        .type('text/plain')
        .send('This label link is invalid or has expired. Re-open it from the order.');
      return;
    }

    // 0. Refuse cancelled shipments. A cancelled sub-order's AWB has been
    // cancelled at Delhivery, so its barcode would be rejected on scan — we
    // must not hand out a label for it (neither ours nor the carrier fallback).
    // 410 Gone: the label existed but is no longer valid.
    const blockReason = await this.facade.getLabelBlockReason(subOrderId);
    if (blockReason) {
      res.status(410).type('text/plain').send(blockReason);
      return;
    }

    // 1. Our own 4x6 PDF.
    let pdf: Buffer | null = null;
    try {
      pdf = await this.labelPdf.generateForSubOrder(subOrderId);
    } catch (e) {
      this.logger.error(
        `Custom label generation errored for ${subOrderId}: ${(e as Error).message}`,
      );
    }
    if (pdf) {
      res.status(200);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="label-${subOrderId.slice(0, 8)}.pdf"`,
      );
      res.setHeader('Cache-Control', 'no-store');
      res.send(pdf);
      return;
    }

    // 2. Fallback — Delhivery's own label.
    try {
      const carrierUrl = await this.facade.getCarrierLabelUrl(subOrderId);
      if (carrierUrl) {
        res.redirect(302, carrierUrl);
        return;
      }
    } catch (e) {
      this.logger.error(
        `Carrier-label fallback failed for ${subOrderId}: ${(e as Error).message}`,
      );
    }

    res
      .status(404)
      .type('text/plain')
      .send('Label not generated yet — available once the shipment is booked.');
  }
}
