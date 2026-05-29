// Phase 22 GST — Stub e-invoice provider.
//
// Produces deterministic IRN fixtures from the request payload so the
// full IRP lifecycle (generate → cancel → re-attempt after failure) is
// exercisable without NIC credentials. The IRN itself is a 64-char hex
// SHA-256 of `(supplierGstin || documentNumber || documentDate)` —
// matches the NIC contract that an IRN is deterministic on those three.
//
// The "signed document" is a minimal JSON envelope with a synthetic
// signature field so PDF-template + storage layers don't break when
// they expect a non-null JSON column.

import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import type {
  EInvoiceProvider,
  IrnCancelInput,
  IrnCancelResult,
  IrnGenerateInput,
  IrnGenerateResult,
} from './einvoice-provider';

@Injectable()
export class StubEInvoiceProvider implements EInvoiceProvider {
  private readonly logger = new Logger(StubEInvoiceProvider.name);
  readonly name = 'stub';

  async generate(input: IrnGenerateInput): Promise<IrnGenerateResult> {
    const irn = createHash('sha256')
      .update(
        `${input.supplierGstin}|${input.documentNumber}|${input.documentDate.toISOString()}`,
      )
      .digest('hex');
    const ackNo = `STUB-${Date.now()}-${randomBytes(3).toString('hex')}`;
    const ackDate = new Date();
    // Phase 90 (2026-05-23) — Gap #13 stub QR clarity. Pre-Phase-90
    // the SVG looked like a real QR (just IRN text inside <svg>) and
    // could mislead operators reviewing PDFs. The new SVG is
    // explicitly labelled "STUB - NOT A REAL QR" with a watermark
    // pattern so screenshots are recognisable as test data.
    const stubQrSvg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140" viewBox="0 0 140 140">` +
      `<rect width="140" height="140" fill="#f3f4f6" stroke="#ef4444" stroke-width="2" stroke-dasharray="6,4"/>` +
      `<text x="70" y="32" text-anchor="middle" font-family="monospace" font-size="11" fill="#991b1b" font-weight="bold">STUB</text>` +
      `<text x="70" y="52" text-anchor="middle" font-family="monospace" font-size="9" fill="#991b1b">NOT A REAL QR</text>` +
      `<text x="70" y="84" text-anchor="middle" font-family="monospace" font-size="8" fill="#374151">IRN (first 16):</text>` +
      `<text x="70" y="100" text-anchor="middle" font-family="monospace" font-size="9" fill="#1f2937">${irn.slice(0, 16)}</text>` +
      `<text x="70" y="124" text-anchor="middle" font-family="monospace" font-size="7" fill="#6b7280">${input.documentNumber}</text>` +
      `</svg>`;
    const qrCodeUrl = `data:image/svg+xml;base64,${Buffer.from(stubQrSvg).toString('base64')}`;
    this.logger.log(
      `[stub] IRN minted: ${irn.slice(0, 12)}... for ${input.documentNumber}`,
    );
    return {
      irn,
      ackNo,
      ackDate,
      signedDocumentJson: serialise({
        provider: 'stub',
        irn,
        ackNo,
        ackDate: ackDate.toISOString(),
        // Synthetic JWS signature placeholder — NIC returns a real
        // JWS; the stub records a constant so the field is non-null.
        // Phase 90 — Gap #14. No fake signature field; consumers
        // checking `signedDocumentJson.signature` know real signatures
        // are absent on stub responses.
        signatureProvider: 'STUB_NONE',
        payload: input,
      }),
      qrCodeUrl,
    };
  }

  async cancel(input: IrnCancelInput): Promise<IrnCancelResult> {
    const cancelledAt = new Date();
    this.logger.log(
      `[stub] IRN ${input.irn.slice(0, 12)}... cancelled (code=${input.cancellationCode}, reason=${input.cancellationReason})`,
    );
    return {
      cancelledAt,
      signedDocumentJson: serialise({
        provider: 'stub',
        irn: input.irn,
        cancelledAt: cancelledAt.toISOString(),
        cancellationCode: input.cancellationCode,
        cancellationReason: input.cancellationReason,
        // Phase 90 — Gap #14. No fake signature field; consumers
        // checking `signedDocumentJson.signature` know real signatures
        // are absent on stub responses.
        signatureProvider: 'STUB_NONE',
      }),
    };
  }
}

/** JSON.stringify chokes on BigInt; convert to decimal string. */
function serialise<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    ),
  );
}
