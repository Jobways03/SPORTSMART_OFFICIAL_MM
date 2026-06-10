import { Injectable, Logger } from '@nestjs/common';
import { DelhiveryClient } from '../clients/delhivery.client';
import { DELHIVERY_PATHS } from '../delhivery.constants';
import type {
  DelhiveryWarehouseCreateRequest,
  DelhiveryWarehouseResponse,
  DelhiveryWarehouseUpdateRequest,
} from '../dtos/delhivery-warehouse.dto';
import { CarrierError } from './delhivery-order.service';
import { mapDelhiveryError } from '../mappers/delhivery-error.mapper';

export interface WarehouseCreateInput {
  name: string;
  registeredName?: string;
  contactPerson?: string;
  phone: string;
  email?: string;
  address?: string;
  city?: string;
  pin: string;
  country?: string;
  returnAddress: string;
  returnPin?: string;
  returnCity?: string;
  returnState?: string;
  returnCountry?: string;
}

export interface WarehouseUpdateInput {
  name: string;
  phone?: string;
  address?: string;
  pin?: string;
  registeredName?: string;
}

/**
 * Delhivery Client Warehouse register + edit.
 *
 *   • Create:  POST /api/backend/clientwarehouse/create/
 *   • Update:  POST /api/backend/clientwarehouse/edit/
 *
 * `name` is the canonical identifier and is IMMUTABLE after create —
 * only `phone`, `address`, `pin` can be patched. The update service
 * enforces this at the boundary so callers get a fast fail on a typo.
 */
@Injectable()
export class DelhiveryWarehouseService {
  private readonly logger = new Logger(DelhiveryWarehouseService.name);

  constructor(private readonly client: DelhiveryClient) {}

  async createWarehouse(input: WarehouseCreateInput): Promise<{
    name: string;
    id?: string;
    success: boolean;
    raw: DelhiveryWarehouseResponse;
  }> {
    if (!input.name?.trim() || !input.phone?.trim() || !input.pin?.trim() || !input.returnAddress?.trim()) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail:
          'createWarehouse requires name, phone, pin, and return_address ' +
          '(all required by Delhivery).',
        retryable: false,
      });
    }

    // Dev mock — when no real Delhivery account is configured (the API token is
    // still the `replace-me-` placeholder), simulate a successful registration
    // so the pickup-location flow works end-to-end locally instead of 401-ing
    // against the real staging API. Production always has real creds.
    if (this.client.isMock) {
      this.logger.warn(
        `[dev-mock] Delhivery warehouse "${input.name}" registered without real ` +
          `credentials (DELHIVERY_API_TOKEN is a placeholder).`,
      );
      return {
        name: input.name,
        id: `dev-mock-${input.name}`,
        success: true,
        raw: { name: input.name } as DelhiveryWarehouseResponse,
      };
    }

    const body: DelhiveryWarehouseCreateRequest = {
      name: input.name,
      registered_name: input.registeredName,
      contact_person: input.contactPerson,
      phone: input.phone,
      email: input.email,
      address: input.address,
      city: input.city,
      pin: input.pin,
      country: input.country ?? 'India',
      return_address: input.returnAddress,
      return_pin: input.returnPin,
      return_city: input.returnCity,
      return_state: input.returnState,
      return_country: input.returnCountry ?? 'India',
    };
    const response = await this.client.post<
      DelhiveryWarehouseCreateRequest,
      DelhiveryWarehouseResponse | unknown
    >(DELHIVERY_PATHS.WAREHOUSE_CREATE, body, {
      contentType: 'json',
      idempotencyKey: `warehouse-create-${input.name}`,
    });
    if (response.status < 200 || response.status >= 300) {
      const mapped = mapDelhiveryError(response.status, response.body);
      // A duplicate-name rejection means the warehouse ALREADY EXISTS at
      // Delhivery (the name is the immutable identifier). Re-registering is
      // then idempotently successful — do NOT create a second warehouse or
      // surface a (shipment-flavoured) "already exists" error. Return
      // success keyed by the requested name so the caller marks it
      // REGISTERED rather than FAILED.
      if (mapped.code === 'IDEMPOTENT_REPLAY') {
        return {
          name: input.name,
          id: undefined,
          success: true,
          raw: response.body as DelhiveryWarehouseResponse,
        };
      }
      throw new CarrierError(mapped);
    }
    const envelope = response.body as DelhiveryWarehouseResponse;
    return {
      name: envelope?.name ?? input.name,
      id: envelope?.id !== undefined ? String(envelope.id) : undefined,
      success: true,
      raw: envelope,
    };
  }

  async updateWarehouse(input: WarehouseUpdateInput): Promise<{
    name: string;
    success: boolean;
    raw: DelhiveryWarehouseResponse;
  }> {
    if (!input.name?.trim()) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail: 'updateWarehouse requires name (identifies the warehouse, immutable).',
        retryable: false,
      });
    }

    // Dev mock — see createWarehouse. No real creds → simulate success.
    if (this.client.isMock) {
      this.logger.warn(
        `[dev-mock] Delhivery warehouse "${input.name}" updated without real credentials.`,
      );
      return {
        name: input.name,
        success: true,
        raw: { name: input.name } as DelhiveryWarehouseResponse,
      };
    }

    const body: DelhiveryWarehouseUpdateRequest = {
      name: input.name,
      phone: input.phone,
      address: input.address,
      pin: input.pin,
      registered_name: input.registeredName,
    };
    const response = await this.client.post<
      DelhiveryWarehouseUpdateRequest,
      DelhiveryWarehouseResponse | unknown
    >(DELHIVERY_PATHS.WAREHOUSE_UPDATE, body, {
      contentType: 'json',
      idempotencyKey: `warehouse-edit-${input.name}-${Date.now()}`,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new CarrierError(mapDelhiveryError(response.status, response.body));
    }
    return {
      name: input.name,
      success: true,
      raw: response.body as DelhiveryWarehouseResponse,
    };
  }
}
