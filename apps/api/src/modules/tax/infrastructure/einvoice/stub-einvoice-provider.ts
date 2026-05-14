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
    // QR URL is a fake `data:` URL so callers exercise the rendering
    // path without a real PNG. The NIC adapter returns a CDN URL.
    const qrCodeUrl = `data:image/svg+xml;base64,${Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg"><text>${irn.slice(0, 12)}</text></svg>`,
    ).toString('base64')}`;
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
        signature: 'STUB-NOT-A-REAL-SIGNATURE',
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
        signature: 'STUB-NOT-A-REAL-SIGNATURE',
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
