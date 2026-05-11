/**
 * Check Pincode — POST /api_v3/pincode/check.json
 *
 * Returns per-carrier capability for a pincode. The cart/checkout
 * uses the union of capabilities to gate COD-availability before
 * the customer commits payment. Response should be cached (24h TTL
 * is fine — pincode capabilities change rarely).
 */

export interface IThinkCheckPincodeRequest {
  pincode: string;
}

/**
 * Capabilities per carrier. 'Y' / 'N' as strings (not booleans —
 * iThink returns the literal character).
 */
export interface IThinkPincodeCarrierCapability {
  prepaid: 'Y' | 'N' | string;
  cod: 'Y' | 'N' | string;
  pickup: 'Y' | 'N' | string;
  district: string;
  state_code: string;
  sort_code: string;
}

/**
 * Response keyed by pincode (string) then by carrier name (string).
 *   data['400067']['delhivery'].cod === 'Y'
 */
export interface IThinkCheckPincodeResponseData {
  [pincode: string]: {
    [carrier: string]: IThinkPincodeCarrierCapability;
  };
}
