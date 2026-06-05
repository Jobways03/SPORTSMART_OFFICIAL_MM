import {apiClient, ApiResponse} from '../lib/api-client';

export interface PincodePlace {
  name: string;
  type?: string;
  delivery?: string;
  lat?: number;
  lon?: number;
}

export interface PincodeLookup {
  pincode: string;
  district: string;
  state: string;
  /** Sub-locality records (post offices / villages) the server returns
   *  alongside the district. AddressForm doesn't use this today but
   *  surfacing it in the type lets a future "Pick locality" UI consume
   *  it without re-discovering the field. */
  places?: PincodePlace[];
}

export const pincodesService = {
  lookup(pincode: string): Promise<ApiResponse<PincodeLookup>> {
    return apiClient<PincodeLookup>(`/pincodes/${encodeURIComponent(pincode)}`);
  },
};
