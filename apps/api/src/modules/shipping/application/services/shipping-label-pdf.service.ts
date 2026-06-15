// Our own 4x6 (288x432pt) shipping label, generated server-side with pdfkit +
// bwip-js — a clean, SportSmart-branded alternative to Delhivery's A4 packing
// slip (whose bottom strip cramps the return address over the order-ref
// barcode). The label data is the SAME we send Delhivery at booking, so the
// printed AWB + order-ref barcodes match the carrier record exactly.
//
// Served via the PUBLIC, signed-token route (public-shipping-label.controller)
// because every frontend opens the label with a raw window.open (no Bearer).
// Delhivery's packing slip remains the fallback (see getLabelInfo / the route).

import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { buildCreateShipmentRequest } from '../mappers/sub-order-to-shipment.mapper';
import { buildOrderReference } from '../order-reference.util';
import { signLabelToken } from '../label-token.util';
import type { DomainShipment } from '../ports/outbound/courier-gateway.port';

// pdfkit's STANDALONE build embeds its font metrics (virtual-fs). The default
// build reads .afm files from js/data/ via __dirname, which breaks once webpack
// bundles the API (the bundle's __dirname has no data/ dir) — that silently
// failed our label generation and fell back to Delhivery. The standalone build
// survives bundling. pdfkit has no `exports` map, so this deep path resolves at
// runtime; we borrow the type from the package's normal entry.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit/js/pdfkit.standalone.js') as typeof import('pdfkit');

// bwip-js ships an `exports` map (./node), but the API uses classic
// moduleResolution which ignores it, and deep dist paths are blocked by Node at
// runtime. The bare `require('bwip-js')` resolves to the node build at runtime;
// we cast it to the slice we use. We use toSVG (not toBuffer/PNG) so the
// barcode is drawn as VECTOR bars — pdfkit's doc.image() reads via fs, which is
// shimmed out in the webpack-bundled standalone build (fs.readFileSync is not a
// function); vector drawing avoids fs entirely.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bwipjs = require('bwip-js') as {
  toSVG(opts: Record<string, unknown>): string;
};

const PAGE_W = 288; // 4 inch @ 72pt
const PAGE_H = 432; // 6 inch @ 72pt
const M = 14; // margin
const CW = PAGE_W - M * 2; // content width

@Injectable()
export class ShippingLabelPdfService {
  private readonly logger = new Logger(ShippingLabelPdfService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The public URL the frontend opens for our label — a no-auth, signed-token
   * route that serves the PDF. Mirrors how Delhivery returns a presigned URL,
   * so no frontend code changes.
   */
  buildLabelUrl(subOrderId: string): string {
    const base =
      process.env.PUBLIC_API_BASE_URL ||
      `http://localhost:${process.env.PORT || 8000}`;
    return `${base.replace(/\/+$/, '')}/api/v1/public/shipping/labels/${signLabelToken(
      subOrderId,
    )}`;
  }

  /**
   * Render the 4x6 PDF for a sub-order. Returns null when it can't be built
   * (sub-order missing, no AWB yet, or mapper failure) — the caller then falls
   * back to Delhivery's own label.
   */
  async generateForSubOrder(subOrderId: string): Promise<Buffer | null> {
    const sub = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      include: {
        items: {
          select: {
            productId: true,
            variantId: true,
            productTitle: true,
            sku: true,
            masterSku: true,
            quantity: true,
            unitPrice: true,
          },
        },
        masterOrder: {
          select: {
            orderNumber: true,
            createdAt: true,
            paymentMethod: true,
            // Wallet + sibling subtotals so the printed COD amount nets out the
            // wallet portion (matches the courier booking; no door double-charge).
            walletAmountUsedInPaise: true,
            subOrders: {
              select: { id: true, subTotal: true, acceptStatus: true },
            },
            shippingAddressSnapshot: true,
            customer: { select: { email: true } },
          },
        },
        seller: {
          select: {
            gstin: true,
            isGstVerified: true,
            sellerShopName: true,
            legalBusinessName: true,
            sellerName: true,
            storeAddress: true,
            city: true,
            state: true,
          },
        },
        franchise: {
          select: {
            gstNumber: true,
            verificationStatus: true,
            businessName: true,
            address: true,
            locality: true,
            city: true,
            state: true,
            pincode: true,
          },
        },
      },
    });
    if (!sub || !(sub as any).trackingNumber) return null;

    // Never render a label for a CANCELLED sub-order. Its AWB has been
    // cancelled at Delhivery, so the printed barcode would be rejected on scan
    // ("shipment cancelled") and could force the parcel into RTO. The caller
    // (public label route) then blocks with a clear message instead. The
    // `include` query above already loads these scalar columns.
    if (
      (sub as any).fulfillmentStatus === 'CANCELLED' ||
      (sub as any).acceptStatus === 'CANCELLED'
    ) {
      return null;
    }

    // Same batched catalog-dimension load as the auto-book handler (OrderItem
    // has no relation to Product/Variant), so weight/dims match the booking.
    const dimSelect = {
      id: true,
      weight: true,
      weightUnit: true,
      length: true,
      width: true,
      height: true,
      dimensionUnit: true,
    } as const;
    const items = sub.items as Array<{
      productId?: string | null;
      variantId?: string | null;
    }>;
    const productIds = [
      ...new Set(items.map((i) => i.productId).filter((x): x is string => !!x)),
    ];
    const variantIds = [
      ...new Set(items.map((i) => i.variantId).filter((x): x is string => !!x)),
    ];
    const [products, variants] = await Promise.all([
      productIds.length
        ? this.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: dimSelect,
          })
        : Promise.resolve([] as Array<{ id: string }>),
      variantIds.length
        ? this.prisma.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: dimSelect,
          })
        : Promise.resolve([] as Array<{ id: string }>),
    ]);
    const productMap = new Map(products.map((p) => [p.id, p]));
    const variantMap = new Map(variants.map((v) => [v.id, v]));
    const enrichedSub = {
      ...sub,
      items: items.map((it) => ({
        ...it,
        product: it.productId ? productMap.get(it.productId) ?? null : null,
        variant: it.variantId ? variantMap.get(it.variantId) ?? null : null,
      })),
    };

    let req;
    try {
      req = buildCreateShipmentRequest(enrichedSub as any);
    } catch (e) {
      this.logger.warn(
        `Custom label build failed for ${subOrderId}: ${(e as Error).message}`,
      );
      return null;
    }

    const awb = String((sub as any).trackingNumber);
    const courier = (sub as any).courierName || 'Delhivery';
    const orderRef = buildOrderReference(req.shipment.orderNumber, subOrderId);

    try {
      return await this.render({ awb, courier, orderRef, s: req.shipment });
    } catch (e) {
      this.logger.error(
        `Custom label render failed for ${subOrderId} (AWB ${awb}): ${
          (e as Error).message
        }`,
      );
      return null;
    }
  }

  /** Code-128 barcode as a bwip-js SVG string (vector — drawn, never imaged). */
  private barcodeSvg(text: string): string {
    return bwipjs.toSVG({
      bcid: 'code128',
      text,
      height: 9,
      includetext: false,
      paddingwidth: 0,
      paddingheight: 0,
    });
  }

  private async render(data: {
    awb: string;
    courier: string;
    orderRef: string;
    s: DomainShipment;
  }): Promise<Buffer> {
    const { awb, courier, orderRef, s } = data;
    const awbSvg = this.barcodeSvg(awb);
    const refSvg = this.barcodeSvg(orderRef);

    const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) =>
      doc.on('end', () => resolve(Buffer.concat(chunks))),
    );

    // Draw a bwip-js barcode SVG as filled vector bars scaled into a box (its
    // bars are vertical-line <path>s with a stroke-width = bar width; centered
    // on x). Avoids doc.image()/fs entirely.
    const drawBarcode = (
      svg: string,
      bx: number,
      by: number,
      bw: number,
      bh: number,
    ) => {
      const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
      const vbW = vb && vb[1] ? parseFloat(vb[1]) : 600;
      const sx = bw / vbW;
      doc.save();
      const pathRe = /<path[^>]*stroke-width="([\d.]+)"[^>]*d="([^"]+)"/g;
      let pm: RegExpExecArray | null;
      while ((pm = pathRe.exec(svg)) !== null) {
        const barW = parseFloat(pm[1] ?? '0');
        const d = pm[2] ?? '';
        const barRe = /M([\d.]+)\s/g;
        let bm: RegExpExecArray | null;
        while ((bm = barRe.exec(d)) !== null) {
          const cx = parseFloat(bm[1] ?? '0');
          doc.rect(bx + (cx - barW / 2) * sx, by, Math.max(barW * sx, 0.3), bh);
        }
      }
      doc.fillColor('#000').fill();
      doc.restore();
    };

    let y = M;
    const rule = () => {
      doc.moveTo(M, y).lineTo(PAGE_W - M, y).lineWidth(0.8).strokeColor('#222').stroke();
      y += 6;
    };
    // Draw a text block at the y-cursor and advance y by its rendered height.
    const block = (
      str: string,
      font: string,
      size: number,
      color = '#000',
      opts: { align?: 'left' | 'center' | 'right'; gap?: number } = {},
    ) => {
      const text = (str ?? '').toString();
      doc.font(font).fontSize(size).fillColor(color);
      const h = doc.heightOfString(text, { width: CW, align: opts.align });
      doc.text(text, M, y, { width: CW, align: opts.align });
      y += h + (opts.gap ?? 2);
    };

    // ── Header ──────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#0b1f3a').text('SPORTSMART', M, y);
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#111')
      .text(courier, M, y + 3, { width: CW, align: 'right' });
    y += 22;
    rule();

    // ── AWB barcode ─────────────────────────────────────────
    const bcW = 220;
    const bcH = 40;
    drawBarcode(awbSvg, (PAGE_W - bcW) / 2, y, bcW, bcH);
    y += bcH + 1;
    block(awb, 'Helvetica-Bold', 12, '#000', { align: 'center', gap: 4 });
    rule();

    // ── Payment + destination pin ───────────────────────────
    const payLine =
      s.paymentMode === 'cod'
        ? `COD  Rs.${s.codAmount ?? s.totalAmount}`
        : 'PREPAID';
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000').text(payLine, M, y);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#333')
      .text(`Dest PIN ${s.shipping.pincode}`, M, y + 2, {
        width: CW,
        align: 'right',
      });
    y += 18;
    rule();

    // ── Ship to ─────────────────────────────────────────────
    block('SHIP TO', 'Helvetica-Bold', 8, '#666', { gap: 1 });
    block(s.shipping.name, 'Helvetica-Bold', 11, '#000', { gap: 1 });
    const dropAddr = [s.shipping.line1, s.shipping.line2]
      .filter(Boolean)
      .join(', ');
    block(dropAddr, 'Helvetica', 9, '#000', { gap: 1 });
    block(
      `${s.shipping.city}, ${s.shipping.state} - ${s.shipping.pincode}`,
      'Helvetica',
      9,
      '#000',
      { gap: 1 },
    );
    block(`Ph: ${s.shipping.phone}`, 'Helvetica', 9, '#000', { gap: 4 });
    rule();

    // ── Seller (from) ───────────────────────────────────────
    if (s.sellerName || s.sellerAddress) {
      block('SELLER', 'Helvetica-Bold', 8, '#666', { gap: 1 });
      if (s.sellerName) block(s.sellerName, 'Helvetica-Bold', 10, '#000', { gap: 1 });
      if (s.sellerAddress) block(s.sellerAddress, 'Helvetica', 8, '#333', { gap: 1 });
      if (s.sellerGstin) block(`GSTIN: ${s.sellerGstin}`, 'Helvetica', 8, '#333', { gap: 4 });
      else y += 2;
      rule();
    }

    // ── Return address ──────────────────────────────────────
    block('RETURN TO', 'Helvetica-Bold', 8, '#666', { gap: 1 });
    block(
      s.sellerAddress || s.sellerName || 'Pickup warehouse',
      'Helvetica',
      8,
      '#333',
      { gap: 6 },
    );

    // ── Order-ref barcode (own row, no overlap) ─────────────
    const refBcW = 200;
    const refBcH = 30;
    drawBarcode(refSvg, (PAGE_W - refBcW) / 2, y, refBcW, refBcH);
    y += refBcH + 1;
    block(orderRef, 'Helvetica', 9, '#000', { align: 'center' });

    doc.end();
    return done;
  }
}
