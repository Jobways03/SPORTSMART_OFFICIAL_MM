import { Injectable, Logger } from '@nestjs/common';
import { LogisticsFacadeClient } from '../clients/logistics-facade.client';

/* ─── Wire shapes (mirrors apps/logistics-facade DTOs) ───────────── */

export type WarehouseCapability = 'REQUIRED' | 'NOT_NEEDED' | 'OPTIONAL';

export interface PartnerInfo {
  code: string;
  displayName: string;
  capabilities: {
    warehouseRegistration: WarehouseCapability;
  };
}

export interface FacadeWarehouseAddress {
  name: string;
  registeredName?: string;
  /** Contact person name — Delhivery `contact_person` ("Contact Person Name"). */
  contactPerson?: string;
  phone: string;
  email?: string;
  address?: string;
  city?: string;
  pin: string;
  country?: string;
  returnAddress?: string;
  returnPin?: string;
  returnCity?: string;
  returnState?: string;
  returnCountry?: string;
}

/** Editable fields when updating an existing warehouse (Delhivery edit). */
export interface FacadeWarehouseUpdate {
  registeredName?: string;
  phone?: string;
  address?: string;
  pin?: string;
}

export interface FacadeRegisterWarehouseResponse {
  partner: string;
  warehouseName: string;
  warehouseId?: string;
  status: 'REGISTERED' | 'FAILED';
  registeredAt: string;
  error?: string;
}

export interface FacadeCallSuccess<T> {
  ok: true;
  data: T;
}

export interface FacadeCallFailure {
  ok: false;
  status: number;
  message: string;
  raw: unknown;
}

export type FacadeCallResult<T> = FacadeCallSuccess<T> | FacadeCallFailure;

/**
 * Read-side: partner discovery.
 * Write-side: register a seller's pickup address with a partner.
 *
 * Both call the facade's `v1/partners` controller. The methods return
 * a tagged union so the caller can distinguish "facade rejected" from
 * "facade unreachable / threw" and surface the right message to the
 * admin UI without lifting NestExceptions across module boundaries.
 */
@Injectable()
export class LogisticsFacadePartnersService {
  private readonly logger = new Logger(LogisticsFacadePartnersService.name);

  constructor(private readonly client: LogisticsFacadeClient) {}

  async listPartners(): Promise<FacadeCallResult<PartnerInfo[]>> {
    try {
      const res = await this.client.get<PartnerInfo[] | unknown>(
        '/api/v1/partners',
      );
      if (res.status >= 200 && res.status < 300 && Array.isArray(res.body)) {
        return { ok: true, data: res.body as PartnerInfo[] };
      }
      return {
        ok: false,
        status: res.status,
        message: this.extractMessage(res.body) ?? `Facade returned ${res.status}`,
        raw: res.body,
      };
    } catch (err) {
      this.logger.error(
        `listPartners failed: ${(err as Error)?.message ?? 'unknown error'}`,
      );
      return {
        ok: false,
        status: 0,
        message: (err as Error)?.message ?? 'Facade unreachable',
        raw: err,
      };
    }
  }

  async registerWarehouse(
    partner: string,
    address: FacadeWarehouseAddress,
  ): Promise<FacadeCallResult<FacadeRegisterWarehouseResponse>> {
    try {
      const res = await this.client.post<
        FacadeWarehouseAddress,
        FacadeRegisterWarehouseResponse | unknown
      >(`/api/v1/partners/${encodeURIComponent(partner)}/warehouses`, address, {
        // The partner-side dedupe key is the warehouse name; replaying
        // the same name + partner is safe — facade adapters (Delhivery)
        // return the existing row.
        idempotencyKey: `${partner}:${address.name}`,
      });
      if (res.status >= 200 && res.status < 300) {
        const body = res.body as FacadeRegisterWarehouseResponse;
        if (body && typeof body === 'object' && 'warehouseName' in body) {
          return { ok: true, data: body };
        }
      }
      return {
        ok: false,
        status: res.status,
        message: this.extractMessage(res.body) ?? `Facade returned ${res.status}`,
        raw: res.body,
      };
    } catch (err) {
      this.logger.error(
        `registerWarehouse(${partner}, name=${address.name}) failed: ${
          (err as Error)?.message ?? 'unknown error'
        }`,
      );
      return {
        ok: false,
        status: 0,
        message: (err as Error)?.message ?? 'Facade unreachable',
        raw: err,
      };
    }
  }

  /**
   * Update an existing warehouse's editable fields (address, pin, phone,
   * registered name) with the partner. The warehouse `name` is the
   * immutable identifier and arrives as a path param. Powers the
   * seller-admin "Update address to Delhivery" action.
   */
  async updateWarehouse(
    partner: string,
    warehouseName: string,
    patch: FacadeWarehouseUpdate,
  ): Promise<FacadeCallResult<FacadeRegisterWarehouseResponse>> {
    try {
      const res = await this.client.post<
        FacadeWarehouseUpdate,
        FacadeRegisterWarehouseResponse | unknown
      >(
        `/api/v1/partners/${encodeURIComponent(partner)}/warehouses/${encodeURIComponent(
          warehouseName,
        )}/edit`,
        patch,
        { idempotencyKey: `${partner}:${warehouseName}:edit:${patch.pin}:${patch.phone}` },
      );
      if (res.status >= 200 && res.status < 300) {
        const body = res.body as FacadeRegisterWarehouseResponse;
        if (body && typeof body === 'object' && 'warehouseName' in body) {
          return { ok: true, data: body };
        }
      }
      return {
        ok: false,
        status: res.status,
        message: this.extractMessage(res.body) ?? `Facade returned ${res.status}`,
        raw: res.body,
      };
    } catch (err) {
      this.logger.error(
        `updateWarehouse(${partner}, name=${warehouseName}) failed: ${
          (err as Error)?.message ?? 'unknown error'
        }`,
      );
      return {
        ok: false,
        status: 0,
        message: (err as Error)?.message ?? 'Facade unreachable',
        raw: err,
      };
    }
  }

  private extractMessage(body: unknown): string | undefined {
    if (!body || typeof body !== 'object') return undefined;
    const b = body as Record<string, unknown>;
    if (typeof b.message === 'string') return b.message;
    if (typeof b.detail === 'string') return b.detail;
    if (typeof b.title === 'string') return b.title;
    return undefined;
  }
}
