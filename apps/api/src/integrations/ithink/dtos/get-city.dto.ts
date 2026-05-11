/**
 * Get City — POST /api_v3/city/get.json
 *
 * Returns the iThink city catalog for a state. Required for warehouse
 * registration (Add Warehouse needs city_id). Pair with Get State to
 * build a state→city geo cache once at onboarding time.
 */

export interface IThinkGetCityRequest {
  state_id: string;
}

export interface IThinkCityRow {
  id: string;
  city_name: string;
  state_id: string;
  status: string;
  is_deleted: string;
}

export type IThinkGetCityResponseData = IThinkCityRow[];
