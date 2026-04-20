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
  postalCode: string;
  isDefault?: boolean;
}

export type UpdateAddressPayload = Partial<AddressPayload>;

export const addressesService = {
  list(): Promise<ApiResponse<CustomerAddress[]>> {
    return apiClient<CustomerAddress[]>('/customer/addresses');
  },

  create(payload: AddressPayload): Promise<ApiResponse<CustomerAddress>> {
    return apiClient<CustomerAddress>('/customer/addresses', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  update(id: string, payload: UpdateAddressPayload): Promise<ApiResponse<CustomerAddress>> {
    return apiClient<CustomerAddress>(`/customer/addresses/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
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
