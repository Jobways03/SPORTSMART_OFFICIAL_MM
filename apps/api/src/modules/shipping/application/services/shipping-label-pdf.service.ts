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
import { HtmlToPdfService } from '../../../tax/infrastructure/pdf/html-to-pdf.service';
import { SPORTSMART_LOGO_PNG_BASE64 } from './sportsmart-logo.asset';

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
  toBuffer(
    opts: Record<string, unknown>,
    cb: (err: Error | null, png: Buffer) => void,
  ): void;
};

const PAGE_W = 288; // 4 inch @ 72pt
const PAGE_H = 432; // 6 inch @ 72pt
const M = 14; // margin
const CW = PAGE_W - M * 2; // content width

@Injectable()
export class ShippingLabelPdfService {
  private readonly logger = new Logger(ShippingLabelPdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly htmlToPdf: HtmlToPdfService,
  ) {}

  /**
   * The public URL the frontend opens for our label — a no-auth, signed-token
   * route that serves the PDF. Mirrors how Delhivery returns a presigned URL,
   * so no frontend code changes.
   */
  buildLabelUrl(subOrderId: string): string {
    // Public base for the no-auth label route. Prefer an explicit
    // PUBLIC_API_BASE_URL, then fall back to APP_URL (the API's public URL, set
    // per-environment and guarded to https in prod) — NOT localhost, which leaks
    // `http://localhost:<PORT>` into deployed label links (PORT is 4000 in the
    // staging/prod containers, so the link pointed at localhost:4000 and refused
    // to connect). The localhost form is only the last-resort local-dev default.
    const base =
      process.env.PUBLIC_API_BASE_URL ||
      process.env.APP_URL ||
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
      // Primary: HTML → Puppeteer (renders the real PNG logo). Falls back to
      // the pdfkit vector label if Chromium is unavailable; the controller
      // falls back to the carrier's own label if this returns null.
      try {
        return await this.renderHtml({ awb, courier, orderRef, s: req.shipment });
      } catch (htmlErr) {
        this.logger.warn(
          `HTML label render failed for ${subOrderId}; falling back to pdfkit: ${
            (htmlErr as Error).message
          }`,
        );
        return await this.render({ awb, courier, orderRef, s: req.shipment });
      }
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

  /** Code-128 barcode as a PNG data URI for the HTML (Puppeteer) label. */
  private barcodePngDataUri(text: string): Promise<string> {
    return new Promise((resolve, reject) => {
      bwipjs.toBuffer(
        {
          bcid: 'code128',
          text,
          scale: 3,
          height: 12,
          includetext: false,
          paddingwidth: 0,
          paddingheight: 0,
        },
        (err, png) =>
          err
            ? reject(err)
            : resolve(`data:image/png;base64,${png.toString('base64')}`),
      );
    });
  }

  /** Minimal HTML-escape for values interpolated into the label template. */
  private esc(v: unknown): string {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * HTML → Puppeteer label (renders the real PNG logo, which pdfkit's bundled
   * standalone build cannot). 4x6in page; same data as the pdfkit label.
   */
  private async renderHtml(data: {
    awb: string;
    courier: string;
    orderRef: string;
    s: DomainShipment;
  }): Promise<Buffer> {
    const { awb, courier, orderRef, s } = data;
    const [awbPng, refPng] = await Promise.all([
      this.barcodePngDataUri(awb),
      this.barcodePngDataUri(orderRef),
    ]);
    const html = this.buildLabelHtml({ awb, courier, orderRef, s, awbPng, refPng });
    // pageRanges:'1' — a 4x6 label is single-page by definition; this guarantees
    // a long address never produces a near-blank 2nd page.
    return this.htmlToPdf.render(html, { width: '4in', height: '6in', pageRanges: '1' });
  }

  private buildLabelHtml(d: {
    awb: string;
    courier: string;
    orderRef: string;
    s: DomainShipment;
    awbPng: string;
    refPng: string;
  }): string {
    const { awb, courier, orderRef, s, awbPng, refPng } = d;
    const e = (v: unknown) => this.esc(v);
    const courierUp = e((courier || 'Delhivery').toUpperCase());
    // Pricing intentionally omitted per request — show only the payment mode
    // (COD / PREPAID). The destination PIN stays on the right of the band.
    const payLine = s.paymentMode === 'cod' ? 'COD' : 'PREPAID';
    const dropAddr = [s.shipping.line1, s.shipping.line2]
      .filter(Boolean)
      .map(e)
      .join(', ');
    const sellerCol =
      s.sellerName || s.sellerAddress
        ? `<div class="col">
             <span class="k">FROM / SELLER</span>
             ${s.sellerName ? `<div class="nm">${e(s.sellerName)}</div>` : ''}
             ${s.sellerAddress ? `<div class="ad">${e(s.sellerAddress)}</div>` : ''}
             ${s.sellerGstin ? `<div class="ad">GSTIN: ${e(s.sellerGstin)}</div>` : ''}
           </div>`
        : '';
    const returnAddr = e(s.sellerAddress || s.sellerName || 'Pickup warehouse');
    const logo = `data:image/png;base64,${SPORTSMART_LOGO_PNG_BASE64}`;

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      @page { size: 4in 6in; margin: 0; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 4in; height: 6in; font-family: Helvetica, Arial, sans-serif; color: #0f172a; -webkit-print-color-adjust: exact; }
      .pad { width: 4in; height: 6in; padding: 7px; }
      .frame { height: 100%; border: 1px solid #cbd5e1; border-radius: 9px; overflow: hidden; display: flex; flex-direction: column; }
      .k { display: block; font-size: 7.5px; font-weight: 700; letter-spacing: 1px; color: #94a3b8; }
      .head { display: flex; align-items: center; justify-content: space-between; padding: 11px 14px 10px; }
      .head img { height: 60px; width: auto; max-width: 66%; object-fit: contain; }
      .head .courier { font-weight: 800; font-size: 11px; letter-spacing: 1px; color: #0b1f3a; }
      .route { display: flex; align-items: stretch; border-top: 2px solid #0b1f3a; border-bottom: 1px solid #e2e8f0; }
      .route .pay { flex: 0 0 36%; background: #0b1f3a; color: #fff; font-weight: 800; font-size: 16px; letter-spacing: .5px; display: flex; align-items: center; padding: 8px 14px; }
      .route .pin { flex: 1; padding: 6px 14px; display: flex; flex-direction: column; justify-content: center; }
      .route .pin .v { font-size: 20px; font-weight: 800; letter-spacing: 1px; color: #0b1f3a; line-height: 1.05; }
      .awb { text-align: center; padding: 9px 12px 8px; border-bottom: 1px solid #e2e8f0; }
      .awb img { display: block; margin: 4px auto 0; height: 44px; }
      .awb .v { font-weight: 700; font-size: 13px; letter-spacing: 2px; margin-top: 2px; }
      .body { flex: 1; min-height: 0; overflow: hidden; padding: 11px 14px; display: flex; flex-direction: column; justify-content: flex-start; }
      .to .nm { font-weight: 800; font-size: 15px; margin-top: 2px; }
      .to .ad { font-size: 10.5px; color: #1e293b; margin-top: 3px; line-height: 1.45; }
      .meta { display: flex; gap: 16px; margin-top: 14px; padding-top: 10px; border-top: 1px solid #e2e8f0; }
      .meta .col { flex: 1; }
      .meta .nm { font-weight: 700; font-size: 10px; color: #0f172a; margin-top: 2px; }
      .meta .ad { font-size: 8.5px; color: #475569; margin-top: 1px; line-height: 1.35; }
      .ref { text-align: center; padding: 8px 12px 3px; border-top: 1px dashed #cbd5e1; }
      .ref img { display: block; margin: 4px auto 0; height: 30px; }
      .ref .v { font-weight: 700; font-size: 9px; letter-spacing: .5px; margin-top: 1px; }
      .foot { text-align: center; font-size: 7px; color: #94a3b8; padding: 3px 0 7px; }
    </style></head><body>
      <div class="pad"><div class="frame">
        <div class="head">
          <img src="${logo}" alt="SportSmart"/>
          <div class="courier">${courierUp}</div>
        </div>
        <div class="route">
          <div class="pay">${payLine}</div>
          <div class="pin"><span class="k">DESTINATION PIN</span><span class="v">${e(s.shipping.pincode)}</span></div>
        </div>
        <div class="awb">
          <span class="k">AIRWAY BILL NO.</span>
          <img src="${awbPng}" alt="AWB"/>
          <div class="v">${e(awb)}</div>
        </div>
        <div class="body">
          <div class="to">
            <span class="k">DELIVER TO</span>
            <div class="nm">${e(s.shipping.name)}</div>
            <div class="ad">${dropAddr}<br/>${e(s.shipping.city)}, ${e(s.shipping.state)} - ${e(s.shipping.pincode)}<br/>Ph: ${e(s.shipping.phone)}</div>
          </div>
          <div class="meta">
            ${sellerCol}
            <div class="col">
              <span class="k">RETURN TO</span>
              <div class="ad">${returnAddr}</div>
            </div>
          </div>
        </div>
        <div class="ref">
          <span class="k">ORDER REFERENCE</span>
          <img src="${refPng}" alt="Order ref"/>
          <div class="v">${e(orderRef)}</div>
        </div>
        <div class="foot">SportSmart Logistics &nbsp;&middot;&nbsp; ${courierUp} &nbsp;&middot;&nbsp; Handle with care</div>
      </div></div>
    </body></html>`;
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

    // ── Outer frame ─────────────────────────────────────────
    const FX = 6;
    doc
      .roundedRect(FX, FX, PAGE_W - FX * 2, PAGE_H - FX * 2, 7)
      .lineWidth(1.2)
      .strokeColor('#0b1f3a')
      .stroke();

    // ── Header — SportSmart wordmark, drawn as VECTOR to MATCH the real PNG
    // logo used by the HTML/Puppeteer label. The bundled pdfkit.standalone
    // can't embed raster images (its fs is shimmed out, so doc.image() throws —
    // same reason barcodes are drawn as vector bars), so we reproduce the
    // wordmark with text. The actual brand logo is a bold-italic red
    // "SPORTSMART" over a dark "PLAY SMART . STAY FIT" tagline — NO ball mark
    // and NO ".com" (an older fallback drew both, which is why the label looked
    // different on machines without Chromium). Keeping the two render paths
    // visually identical means every device's label stays on-brand. ─
    const RED = '#ED1C24';
    const logoY = y;
    // Wordmark — Helvetica-BoldOblique ≈ the logo's slanted bold sans.
    doc
      .font('Helvetica-BoldOblique')
      .fontSize(19)
      .fillColor(RED)
      .text('SPORTSMART', M, logoY, { lineBreak: false, characterSpacing: -0.2 });
    // Tagline — dark navy, letter-spaced, sits directly under the wordmark.
    doc
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .fillColor('#0b1f3a')
      .text('PLAY SMART . STAY FIT', M + 1, logoY + 21, { characterSpacing: 1.4, lineBreak: false });
    // Courier (right)
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#0b1f3a')
      .text((courier || 'Delhivery').toUpperCase(), M, logoY + 7, { width: CW, align: 'right' });
    y = logoY + 30;
    doc.rect(M, y, CW, 2.2).fill('#0b1f3a');
    y += 10;

    // ── AWB barcode (carrier scan target) ───────────────────
    const bcW = 232;
    const bcH = 44;
    drawBarcode(awbSvg, (PAGE_W - bcW) / 2, y, bcW, bcH);
    y += bcH + 2;
    block(awb, 'Helvetica-Bold', 13, '#000', { align: 'center', gap: 8 });

    // ── Payment + destination PIN band (filled) ─────────────
    // Pricing omitted per request — payment mode only (matches the HTML label).
    const payLine = s.paymentMode === 'cod' ? 'COD' : 'PREPAID';
    const bandH = 24;
    doc.rect(M, y, CW, bandH).fill('#0b1f3a');
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#ffffff').text(payLine, M + 9, y + 7);
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#ffffff')
      .text(`PIN ${s.shipping.pincode}`, M, y + 8, { width: CW - 9, align: 'right' });
    y += bandH + 11;

    // ── Ship to (dominant, boxed) ───────────────────────────
    const dropAddr = [s.shipping.line1, s.shipping.line2]
      .filter(Boolean)
      .join(', ');
    const shipTop = y;
    const PAD = 9;
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#0b1f3a')
      .text('DELIVER TO', M + PAD, y + 7, { characterSpacing: 0.6 });
    y += 21;
    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor('#000')
      .text(s.shipping.name, M + PAD, y, { width: CW - PAD * 2 });
    y += doc.heightOfString(s.shipping.name, { width: CW - PAD * 2 }) + 3;
    const shipBody = `${dropAddr}\n${s.shipping.city}, ${s.shipping.state} - ${s.shipping.pincode}\nPh: ${s.shipping.phone}`;
    doc
      .font('Helvetica')
      .fontSize(9.5)
      .fillColor('#222')
      .text(shipBody, M + PAD, y, { width: CW - PAD * 2, lineGap: 2.5 });
    y += doc.heightOfString(shipBody, { width: CW - PAD * 2, lineGap: 2.5 }) + 9;
    doc.roundedRect(M, shipTop, CW, y - shipTop, 5).lineWidth(1.1).strokeColor('#0b1f3a').stroke();
    y += 13;

    // ── From (seller) ───────────────────────────────────────
    if (s.sellerName || s.sellerAddress) {
      block('FROM (SELLER)', 'Helvetica-Bold', 8, '#94a3b8', { gap: 2 });
      if (s.sellerName) block(s.sellerName, 'Helvetica-Bold', 10, '#000', { gap: 1 });
      if (s.sellerAddress) block(s.sellerAddress, 'Helvetica', 8.5, '#333', { gap: 1 });
      if (s.sellerGstin) block(`GSTIN: ${s.sellerGstin}`, 'Helvetica', 8, '#333', { gap: 6 });
      else y += 4;
      rule();
    }

    // ── Return address ──────────────────────────────────────
    block('RETURN TO', 'Helvetica-Bold', 8, '#94a3b8', { gap: 2 });
    block(
      s.sellerAddress || s.sellerName || 'Pickup warehouse',
      'Helvetica',
      8.5,
      '#333',
      { gap: 4 },
    );

    // ── Order-ref barcode + footer (anchored near the bottom) ─
    const footerY = PAGE_H - 30;
    const refBcW = 210;
    const refBcH = 32;
    const refY = Math.max(y + 6, footerY - refBcH - 16);
    drawBarcode(refSvg, (PAGE_W - refBcW) / 2, refY, refBcW, refBcH);
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#000')
      .text(orderRef, M, refY + refBcH + 1, { width: CW, align: 'center' });
    doc.moveTo(M, footerY).lineTo(PAGE_W - M, footerY).lineWidth(0.6).strokeColor('#cbd5e1').stroke();
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#64748b')
      .text(
        `SportSmart Logistics  ·  ${courier || 'Delhivery'}  ·  Handle with care`,
        M,
        footerY + 5,
        { width: CW, align: 'center' },
      );

    doc.end();
    return done;
  }
}
