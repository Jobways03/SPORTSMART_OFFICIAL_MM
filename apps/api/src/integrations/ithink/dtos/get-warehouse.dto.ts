import type { IThinkWarehouseStatus } from '../ithink.constants';

/**
 * Get Warehouse — POST /api_v3/warehouse/get.json
 *
 * Lists registered warehouses (or fetches one by id). Use to:
 *   - sync approval status of pending warehouses (daily cron)
 *   - confirm pickup_address_id still exists before Add Order
 */

export interface IThinkGetWarehouseRequest {
  /** Omit to list all warehouses on the account. */
  warehouse_id?: string;
}

export interface IThinkWarehouseRow {
  id: string;
  company_name: string;
  mobile: string;
  address1: string;
  address2: string;
  pincode: string;
  city_name: string;
  state_name: string;
  country_name: string;
  status: IThinkWarehouseStatus | string;
}

export type IThinkGetWarehouseResponseData = IThinkWarehouseRow[];
