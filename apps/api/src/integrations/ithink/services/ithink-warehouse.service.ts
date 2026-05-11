import { Injectable } from '@nestjs/common';

import { IThinkClient } from '../clients/ithink.client';
import type {
  IThinkAddWarehouseRequest,
  IThinkAddWarehouseResponse,
} from '../dtos/add-warehouse.dto';
import type {
  IThinkGetWarehouseRequest,
  IThinkGetWarehouseResponseData,
  IThinkWarehouseRow,
} from '../dtos/get-warehouse.dto';
import type {
  IThinkGetStateRequest,
  IThinkGetStateResponseData,
} from '../dtos/get-state.dto';
import type {
  IThinkGetCityRequest,
  IThinkGetCityResponseData,
} from '../dtos/get-city.dto';

/**
 * Warehouse + geography endpoints. These are called primarily during
 * seller / franchise onboarding when a new pickup address is being
 * registered, and via a daily cron to sync warehouse approval status.
 *
 * iThink approves warehouses asynchronously (up to 24h). The seller /
 * franchise admin panel surfaces the `pending → approved` transition
 * so onboarding teams can see when a new pickup goes live.
 */
@Injectable()
export class IThinkWarehouseService {
  constructor(private readonly client: IThinkClient) {}

  async addWarehouse(input: {
    companyName: string;
    address1: string;
    address2?: string;
    mobile: string;
    pincode: string;
    cityId: string;
    stateId: string;
    countryId?: string;
    gps?: string;
  }): Promise<IThinkAddWarehouseResponse> {
    const body: IThinkAddWarehouseRequest = {
      company_name: input.companyName,
      address1: input.address1,
      address2: input.address2,
      mobile: input.mobile,
      pincode: input.pincode,
      city_id: input.cityId,
      state_id: input.stateId,
      country_id: input.countryId ?? '101',
      gps: input.gps,
    };
    const response = await this.client.post<unknown>(
      'ADD_WAREHOUSE',
      body as unknown as Record<string, unknown>,
    );
    return {
      status: response.status ?? 'success',
      status_code: response.status_code ?? 200,
      html_message: response.html_message ?? '',
      warehouse_id: response.warehouse_id ?? 0,
    };
  }

  async listWarehouses(): Promise<IThinkWarehouseRow[]> {
    const response = await this.client.post<IThinkGetWarehouseResponseData>(
      'GET_WAREHOUSE',
      {},
    );
    return response.data ?? [];
  }

  async getWarehouse(warehouseId: string): Promise<IThinkWarehouseRow | null> {
    const body: IThinkGetWarehouseRequest = { warehouse_id: warehouseId };
    const response = await this.client.post<IThinkGetWarehouseResponseData>(
      'GET_WAREHOUSE',
      body as unknown as Record<string, unknown>,
    );
    return response.data?.[0] ?? null;
  }

  async getStates(countryId = '101'): Promise<IThinkGetStateResponseData> {
    const body: IThinkGetStateRequest = { country_id: countryId };
    const response = await this.client.post<IThinkGetStateResponseData>(
      'GET_STATE',
      body as unknown as Record<string, unknown>,
    );
    return response.data ?? [];
  }

  async getCities(stateId: string): Promise<IThinkGetCityResponseData> {
    const body: IThinkGetCityRequest = { state_id: stateId };
    const response = await this.client.post<IThinkGetCityResponseData>(
      'GET_CITY',
      body as unknown as Record<string, unknown>,
    );
    return response.data ?? [];
  }
}
