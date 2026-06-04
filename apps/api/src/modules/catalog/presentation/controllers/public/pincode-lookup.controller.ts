import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { BadRequestAppException } from '../../../../../core/exceptions';
import {
  STOREFRONT_REPOSITORY,
  IStorefrontRepository,
} from '../../../domain/repositories/storefront.repository.interface';

@ApiTags('Pincode')
@Controller('pincodes')
export class PincodeLookupController {
  constructor(
    @Inject(STOREFRONT_REPOSITORY)
    private readonly storefrontRepo: IStorefrontRepository,
  ) {}

  /**
   * Phase 229 (Pincode Lookup audit) — public lookup hardening:
   *  • Input validation: a non-6-digit pincode is rejected with 400 BEFORE it
   *    reaches the DB query — and, critically, before it reaches the India-Post
   *    external-API fallback in the repository, which the unvalidated param
   *    previously fed arbitrary strings into (an SSRF-adjacent abuse lever).
   *  • Dedicated @Throttle so a pincode enumerator can't share/starve the global
   *    300/60s bucket used by login + checkout + search.
   *  • Cache-Control on hits — static reference data, safe to cache for a day at
   *    the CDN/browser layer (the DB is no longer hit on every repeat lookup).
   *  • stateCode surfaced so the address/tax path can resolve place-of-supply.
   *
   * NOTE (surfaced, intentionally NOT changed here): a "not found" still returns
   * HTTP 200 with { success:false, data:null } rather than a 404. The live
   * web-storefront checkout branches on this body shape (success:false → "Invalid
   * pincode", clear city/state); flipping to a 404 status would route that case
   * into the network-error catch instead, a customer-checkout regression. Making
   * it a true 404 is a coordinated FE+BE change.
   */
  @Get(':pincode')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async lookupPincode(
    @Param('pincode') pincode: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!/^[1-9][0-9]{5}$/.test(pincode)) {
      throw new BadRequestAppException(
        'pincode must be a valid 6-digit Indian PIN code',
      );
    }

    const entries = await this.storefrontRepo.findPostOfficeByPincode(pincode);

    if (entries.length === 0) {
      return {
        success: false,
        message: 'Pincode not found',
        data: null,
      };
    }

    // Static reference data — let CDN/browser cache hits for a day.
    res.setHeader(
      'Cache-Control',
      'public, max-age=86400, stale-while-revalidate=3600',
    );

    const first = entries[0];

    return {
      success: true,
      message: 'Pincode found',
      data: {
        pincode,
        district: first.district,
        state: first.state,
        // Phase 229 — 2-digit GST/CBIC state code (populated by the seed).
        stateCode: (first as { stateCode?: string | null }).stateCode ?? null,
        places: entries.map((e) => ({
          name: e.officeName,
          type: e.officeType,
          delivery: e.delivery,
          latitude: e.latitude ? Number(e.latitude) : null,
          longitude: e.longitude ? Number(e.longitude) : null,
        })),
      },
    };
  }
}
