import {
  BadRequestException,
  Injectable,
  NotImplementedException,
} from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DefaultCourierGatewayResolver } from '../../../shipments/application/factories/courier-gateway.resolver';
import type {
  PartnerOption,
  ServiceabilityResult,
} from '@sportsmart/logistics-contracts';
import {
  DelhiveryWarehouseService,
  type WarehouseCreateInput,
} from '../../../../integrations/delhivery/services/delhivery-warehouse.service';
import {
  DELHIVERY_DISPLAY_NAME,
  DELHIVERY_PARTNER_CODE,
} from '../../../../integrations/delhivery/delhivery.constants';
import {
  SHADOWFAX_DISPLAY_NAME,
  SHADOWFAX_PARTNER_CODE,
} from '../../../../integrations/shadowfax/shadowfax.constants';
import type {
  PartnerInfo,
  WarehouseCapability,
} from '../dto/partner-info.dto';
import type {
  RegisterWarehouseRequest,
  RegisterWarehouseResponse,
  UpdateWarehouseRequest,
} from '../dto/register-warehouse.dto';

/**
 * Hardcoded partner catalogue. When a new courier integration is added,
 * append an entry here AND register its adapter in
 * `DefaultCourierGatewayResolver`. Capability discovery for now is
 * static (deliberately): the wire surface is the same regardless of
 * which partners are wired in, so a new partner appearing in this list
 * automatically becomes visible to the admin UI without any frontend
 * change.
 *
 * `warehouseRegistration`:
 *   • REQUIRED   — partner expects pickup addresses pre-registered as
 *                  named "warehouses" before any shipment can be booked
 *                  (Delhivery's `client_warehouse/create`).
 *   • NOT_NEEDED — partner accepts the pickup address inline per
 *                  shipment (Shadowfax marketplace API).
 *   • OPTIONAL   — partner supports both modes; per-shipment override
 *                  is the default.
 */
const PARTNER_CATALOGUE: ReadonlyArray<PartnerInfo> = [
  {
    code: DELHIVERY_PARTNER_CODE,
    displayName: DELHIVERY_DISPLAY_NAME,
    capabilities: {
      warehouseRegistration: 'REQUIRED' as WarehouseCapability,
    },
  },
  {
    code: SHADOWFAX_PARTNER_CODE,
    displayName: SHADOWFAX_DISPLAY_NAME,
    capabilities: {
      warehouseRegistration: 'NOT_NEEDED' as WarehouseCapability,
    },
  },
];

@Injectable()
export class PartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: DefaultCourierGatewayResolver,
    private readonly delhiveryWarehouseService: DelhiveryWarehouseService,
  ) {}

  /**
   * Static catalogue of every partner the facade knows how to talk to
   * + the per-partner capability matrix the admin UI needs to render
   * the right buttons. This is intentionally a sync method returning
   * an in-memory array — no DB roundtrip, no partner-side fan-out.
   */
  listPartners(): PartnerInfo[] {
    // Defensive copy so consumers can't mutate the module-level array.
    return PARTNER_CATALOGUE.map((p) => ({
      code: p.code,
      displayName: p.displayName,
      capabilities: { ...p.capabilities },
    }));
  }

  /**
   * Register a pickup location ("warehouse") with the named partner.
   *
   * Partner-specific behaviour:
   *   • DELHIVERY → calls `DelhiveryWarehouseService.createWarehouse`.
   *     The `address.name` becomes the canonical pickup-location name
   *     used on every subsequent shipment creation (immutable after
   *     create).
   *   • SHADOWFAX → throws BadRequestException. Shadowfax accepts the
   *     pickup address inline on the create-shipment call; there is no
   *     separate "register" step. The admin UI should never offer this
   *     button for SHADOWFAX because `capabilities.warehouseRegistration
   *     === 'NOT_NEEDED'`; this guard catches the misuse if it does.
   *
   * Unknown partner codes throw BadRequestException (clearer than a
   * NotImplemented — the caller passed a code we don't recognise).
   */
  async registerWarehouse(
    partnerCode: string,
    address: RegisterWarehouseRequest,
  ): Promise<RegisterWarehouseResponse> {
    const normalized = partnerCode.toUpperCase();

    if (normalized === SHADOWFAX_PARTNER_CODE) {
      throw new BadRequestException(
        'Shadowfax does not require warehouse registration; pickup details ' +
          'are passed per shipment.',
      );
    }

    if (normalized === DELHIVERY_PARTNER_CODE) {
      const input: WarehouseCreateInput = {
        name: address.name,
        registeredName: address.registeredName,
        contactPerson: address.contactPerson,
        phone: address.phone,
        email: address.email,
        address: address.address,
        city: address.city,
        pin: address.pin,
        country: address.country ?? 'India',
        returnAddress: address.returnAddress ?? address.address ?? '',
        returnPin: address.returnPin ?? address.pin,
        returnCity: address.returnCity ?? address.city,
        returnState: address.returnState,
        returnCountry: address.returnCountry ?? 'India',
      };
      const result = await this.delhiveryWarehouseService.createWarehouse(input);
      return {
        partner: DELHIVERY_PARTNER_CODE,
        warehouseName: result.name,
        warehouseId: result.id,
        status: result.success ? 'REGISTERED' : 'FAILED',
        registeredAt: new Date().toISOString(),
      };
    }

    throw new BadRequestException(
      `Unknown partner code '${partnerCode}'. Known codes: ${PARTNER_CATALOGUE.map(
        (p) => p.code,
      ).join(', ')}.`,
    );
  }

  /**
   * Update an EXISTING warehouse's editable fields with the partner.
   * Delhivery's "Warehouse Updation" allows phone / address / pin /
   * registered_name; the warehouse name is immutable and identifies the
   * record, so it arrives as a path param rather than in the patch body.
   */
  async updateWarehouse(
    partnerCode: string,
    warehouseName: string,
    patch: UpdateWarehouseRequest,
  ): Promise<RegisterWarehouseResponse> {
    const normalized = partnerCode.toUpperCase();

    if (normalized === SHADOWFAX_PARTNER_CODE) {
      throw new BadRequestException(
        'Shadowfax does not register warehouses; there is nothing to update.',
      );
    }

    if (normalized === DELHIVERY_PARTNER_CODE) {
      const result = await this.delhiveryWarehouseService.updateWarehouse({
        name: warehouseName,
        registeredName: patch.registeredName,
        phone: patch.phone,
        address: patch.address,
        pin: patch.pin,
      });
      return {
        partner: DELHIVERY_PARTNER_CODE,
        warehouseName: result.name,
        status: result.success ? 'REGISTERED' : 'FAILED',
        registeredAt: new Date().toISOString(),
      };
    }

    throw new BadRequestException(
      `Unknown partner code '${partnerCode}'. Known codes: ${PARTNER_CATALOGUE.map(
        (p) => p.code,
      ).join(', ')}.`,
    );
  }

  /* ─── Legacy stubs (M1 / M3) ────────────────────────────────── */

  async serviceability(_pincode: string): Promise<ServiceabilityResult> {
    void this.prisma;
    void this.resolver;
    throw new NotImplementedException('Stub — implement in M1');
  }

  async health(_pincode: string): Promise<PartnerOption[]> {
    void this.prisma;
    throw new NotImplementedException('Stub — implement in M3');
  }
}
