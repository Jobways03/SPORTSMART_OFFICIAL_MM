/**
 * Get State — POST /api_v3/state/get.json
 *
 * Returns the iThink state catalog for a country. Required for warehouse
 * registration (Add Warehouse needs state_id, not state name).
 *
 * Use once at app boot or via an admin "Sync geography" action; state
 * IDs are stable — cache them in Redis or a `ithink_states` table.
 */

export interface IThinkGetStateRequest {
  /** 101 for India. */
  country_id: string;
}

export interface IThinkStateRow {
  id: string;
  state_name: string;
  country_id: string;
  status: string;
  is_deleted: string;
}

export type IThinkGetStateResponseData = IThinkStateRow[];
