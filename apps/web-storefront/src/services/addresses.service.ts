import { apiClient, ApiResponse } from '@/lib/api-client';

export interface CustomerAddress {
  id: string;
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  locality: string | null;
  city: string;
  state: string;
  // Phase 34 — canonical CBIC 2-digit GST state code. Optional in
  // the wire shape because legacy rows may not have been backfilled.
  stateCode?: string | null;
  postalCode: string;
  country: string;
  isDefault: boolean;
  createdAt: string;
}

export interface AddressPayload {
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  locality?: string;
  city: string;
  state: string;
  // Phase 34 — picked from the form dropdown. Backend persists it
  // directly when supplied; otherwise resolves by name.
  stateCode?: string;
  postalCode: string;
  isDefault?: boolean;
}

export type UpdateAddressPayload = Partial<AddressPayload>;

// Phase 34 — india_states master, fetched once and cached by the page.
export interface IndiaStateRef {
  code: string;
  name: string;
  isoCode: string | null;
  isUnionTerritory: boolean;
}

export const taxReferenceService = {
  indiaStates(): Promise<ApiResponse<IndiaStateRef[]>> {
    return apiClient<IndiaStateRef[]>('/tax/india-states');
  },
};

export const addressesService = {
  list(): Promise<ApiResponse<CustomerAddress[]>> {
    return apiClient<CustomerAddress[]>('/customer/addresses');
  },

  // Phase 4 / H46 — caller supplies an idempotency key per submit
  // so a double-click / network-retried POST doesn't create two
  // identical address rows. The page builds the key once when the
  // form opens and reuses it on retry of the same submission.
  create(
    payload: AddressPayload,
    idempotencyKey?: string,
  ): Promise<ApiResponse<CustomerAddress>> {
    return apiClient<CustomerAddress>('/customer/addresses', {
      method: 'POST',
      body: JSON.stringify(payload),
      ...(idempotencyKey
        ? { headers: { 'X-Idempotency-Key': idempotencyKey } }
        : {}),
    });
  },

  update(
    id: string,
    payload: UpdateAddressPayload,
    idempotencyKey?: string,
  ): Promise<ApiResponse<CustomerAddress>> {
    return apiClient<CustomerAddress>(`/customer/addresses/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
      ...(idempotencyKey
        ? { headers: { 'X-Idempotency-Key': idempotencyKey } }
        : {}),
    });
  },

  remove(id: string): Promise<ApiResponse> {
    return apiClient(`/customer/addresses/${id}`, {
      method: 'DELETE',
    });
  },

  setDefault(id: string): Promise<ApiResponse<CustomerAddress>> {
    return apiClient<CustomerAddress>(`/customer/addresses/${id}/set-default`, {
      method: 'PATCH',
    });
  },
};
