// Phase 15 GST — Stub e-way bill provider.
//
// Produces placeholder EWB numbers in `EWB-STUB-{uuid}` shape and
// captures the request payload to `raw_request_json` so engineers can
// see what would have been sent to NIC. Lets us exercise:
//   - ship-block when EWB is REQUIRED-but-not-issued
//   - admin retry UI
//   - cancellation flow (24h window)
//   - expiry sweeper
//
// ... all without NIC credentials.
//
// Replace with `NicEWayBillProvider` (later phase) once Sportsmart has
// NIC API access. The interface contract stays identical.

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { computeValidUntil } from '../../domain/eway-bill-validity';
import type {
  EWayBillCancelInput,
  EWayBillCancelResult,
  EWayBillGenerateInput,
  EWayBillGenerateResult,
  EWayBillProvider,
  EWayBillUpdatePartBInput,
  EWayBillUpdatePartBResult,
} from './eway-bill-provider';

@Injectable()
export class StubEWayBillProvider implements EWayBillProvider {
  private readonly logger = new Logger(StubEWayBillProvider.name);
  readonly name = 'stub';

  async generate(
    input: EWayBillGenerateInput,
  ): Promise<EWayBillGenerateResult> {
    const ewbDate = new Date();
    // No real distance? Default to 50km so the stub yields a 1-day EWB
    // — matches what the integration test fixtures expect.
    const distance = input.distanceKm ?? 50;
    const validUntil = computeValidUntil(ewbDate, distance);
    const ewbNumber = `EWB-STUB-${randomUUID()}`;

    this.logger.log(
      `[stub] EWB ${ewbNumber} issued for ${input.invoiceDocumentNumber ?? '(no invoice)'} ` +
        `— ${input.fromPincode}→${input.toPincode} (${distance}km, valid until ${validUntil.toISOString()})`,
    );

    return {
      ewbNumber,
      ewbDate,
      validUntil,
      // Capture the request shape so an engineer can sanity-check what
      // would have been sent to NIC. We don't serialise BigInt directly
      // — JSON.stringify chokes on it — so convert to a number string.
      rawRequestJson: serialise(input),
      rawResponseJson: {
        provider: 'stub',
        ewbNumber,
        ewbDate: ewbDate.toISOString(),
        validUntil: validUntil.toISOString(),
        distanceKm: distance,
      },
    };
  }

  async cancel(input: EWayBillCancelInput): Promise<EWayBillCancelResult> {
    const cancelledAt = new Date();
    this.logger.log(
      `[stub] EWB ${input.ewbNumber} cancelled (reason: ${input.reason})`,
    );
    return {
      cancelledAt,
      providerCancelReference: `STUB-CXL-${input.ewbNumber}`,
      rawResponseJson: {
        provider: 'stub',
        ewbNumber: input.ewbNumber,
        cancelledAt: cancelledAt.toISOString(),
        reason: input.reason,
        cancelReference: `STUB-CXL-${input.ewbNumber}`,
      },
    };
  }

  // Phase 160 (audit #18) — Part-B update. NIC re-issues validity on a
  // Part-B change; the stub recomputes it from "now" + the (new) distance.
  async updatePartB(
    input: EWayBillUpdatePartBInput,
  ): Promise<EWayBillUpdatePartBResult> {
    const validUntil = computeValidUntil(new Date(), input.distanceKm ?? 50);
    this.logger.log(
      `[stub] EWB ${input.ewbNumber} Part-B updated (vehicle ${input.vehicleNumber ?? '—'}, reason: ${input.reason})`,
    );
    return {
      validUntil,
      rawResponseJson: {
        provider: 'stub',
        ewbNumber: input.ewbNumber,
        vehicleNumber: input.vehicleNumber,
        transportMode: input.transportMode,
        validUntil: validUntil.toISOString(),
        reason: input.reason,
      },
    };
  }
}

/**
 * JSON.stringify chokes on BigInt; convert any BigInt values to a
 * decimal string so the audit-trail JSON column is loadable everywhere.
 */
function serialise<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    ),
  );
}
