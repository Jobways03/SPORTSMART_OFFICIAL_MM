// Customer-side tax-profile API wrapper. Mirrors the backend
// CustomerTaxProfilesController (Phase 25/26 GST). Used by:
//   - /account/tax-profiles — full CRUD UI
//   - /checkout — read-only indicator of the default profile
//
// All responses follow the shared `ApiResponse` envelope; the page
// layer unwraps `.data` and surfaces `.message` on errors.

import { apiClient, ApiResponse } from '@/lib/api-client';

export interface BillingAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  country?: string;
}

export interface CustomerTaxProfile {
  id: string;
  gstin: string;
  legalName: string;
  billingAddress: BillingAddress;
  stateCode: string;
  isDefault: boolean;
  isVerified: boolean;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaxProfilePayload {
  gstin: string;
  legalName: string;
  billingAddress: BillingAddress;
  isDefault?: boolean;
}

export interface UpdateTaxProfilePayload {
  legalName?: string;
  billingAddress?: BillingAddress;
  isDefault?: boolean;
}

class CustomerTaxProfileService {
  list(): Promise<ApiResponse<CustomerTaxProfile[]>> {
    return apiClient<CustomerTaxProfile[]>('/customer/tax-profiles');
  }

  create(
    payload: CreateTaxProfilePayload,
  ): Promise<ApiResponse<CustomerTaxProfile>> {
    return apiClient<CustomerTaxProfile>('/customer/tax-profiles', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  update(
    id: string,
    payload: UpdateTaxProfilePayload,
  ): Promise<ApiResponse<CustomerTaxProfile>> {
    return apiClient<CustomerTaxProfile>(`/customer/tax-profiles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  setDefault(id: string): Promise<ApiResponse<CustomerTaxProfile>> {
    return apiClient<CustomerTaxProfile>(
      `/customer/tax-profiles/${id}/set-default`,
      { method: 'POST' },
    );
  }

  delete(id: string): Promise<ApiResponse<null>> {
    return apiClient<null>(`/customer/tax-profiles/${id}`, {
      method: 'DELETE',
    });
  }
}

export const customerTaxProfileService = new CustomerTaxProfileService();
