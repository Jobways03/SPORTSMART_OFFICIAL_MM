import { Injectable, NotImplementedException } from '@nestjs/common';
import { ShadowfaxClient } from '../clients/shadowfax.client';

/**
 * Shadowfax reverse-pickup surface.
 *
 * Reverse pickup is NOT implemented because SportsMart does not use
 * Shadowfax reverse pickup — customer returns are routed through a
 * different fulfilment path. The methods below remain as stubs so
 * the DI wiring stays stable; calling them throws a
 * `NotImplementedException` with a pointer to the partner Apiary doc
 * for whoever turns this on later.
 *
 * Implementation reference (when this changes):
 *   https://sfxreversepickupsellerdelivery.docs.apiary.io/
 */
@Injectable()
export class ShadowfaxPickupService {
  constructor(private readonly client: ShadowfaxClient) {}

  /**
   * Schedule a rider pickup for a customer return.
   *
   * NOT IMPLEMENTED — SportsMart does not use Shadowfax reverse
   * pickup. If this changes, implement against the Shadowfax Reverse
   * Pickup API documented at
   * https://sfxreversepickupsellerdelivery.docs.apiary.io/
   */
  async schedulePickup(_input: {
    address: {
      name: string;
      phone: string;
      line1: string;
      line2?: string;
      city: string;
      state: string;
      pincode: string;
    };
    /** ISO-8601 desired slot start. */
    slotAt: string;
    purpose: 'FORWARD' | 'REVERSE';
    /** Linked order id if this pickup is for an existing order. */
    linkedOrderId?: string;
  }): Promise<{ pickupId: string; riderEtaAt?: string }> {
    void this.client;
    throw new NotImplementedException(
      'SportsMart does not use Shadowfax reverse pickup. To enable, ' +
        'implement against the Shadowfax Reverse Pickup API documented ' +
        'at https://sfxreversepickupsellerdelivery.docs.apiary.io/',
    );
  }

  /**
   * Cancel a scheduled reverse pickup.
   *
   * NOT IMPLEMENTED — see `schedulePickup` for context. Same
   * implementation reference.
   */
  async cancelPickup(_pickupId: string): Promise<{ success: boolean }> {
    throw new NotImplementedException(
      'SportsMart does not use Shadowfax reverse pickup. To enable, ' +
        'implement against the Shadowfax Reverse Pickup API documented ' +
        'at https://sfxreversepickupsellerdelivery.docs.apiary.io/',
    );
  }
}
