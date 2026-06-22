import { apiClient, ApiResponse } from '@/lib/api-client';

// COD rule kinds mirror the backend CodRuleKind enum (prisma/schema/cod-payouts).
export type CodRuleKind =
  | 'PINCODE_ALLOW'
  | 'PINCODE_DENY'
  | 'VALUE_LIMIT'
  | 'SELLER_DENY'
  | 'CUSTOMER_RISK';

export interface CodRule {
  id: string;
  kind: CodRuleKind;
  priority: number;
  conditions: unknown;
  active: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CodDecision {
  id: string;
  customerId: string | null;
  pincode: string | null;
  eligible: boolean;
  reason: string | null;
  decidedBy: string | null;
  createdAt: string;
}

export interface CreateCodRulePayload {
  kind: CodRuleKind;
  priority?: number;
  conditions: unknown;
  active?: boolean;
  description?: string;
}

export const COD_RULE_KINDS: { value: CodRuleKind; label: string; hint: string }[] = [
  { value: 'PINCODE_ALLOW', label: 'Pincode allow', hint: '{"pincodes":["560001","560002"]}' },
  { value: 'PINCODE_DENY', label: 'Pincode deny', hint: '{"pincodes":["110001"]}' },
  { value: 'VALUE_LIMIT', label: 'Value limit', hint: '{"maxValueInr":10000}' },
  { value: 'SELLER_DENY', label: 'Seller deny', hint: '{"sellerIds":["..."]}' },
  { value: 'CUSTOMER_RISK', label: 'Customer risk', hint: '{"minRiskScore":70}' },
];

export const adminCodService = {
  listRules(): Promise<ApiResponse<CodRule[]>> {
    return apiClient<CodRule[]>('/admin/cod/rules');
  },

  listDecisions(limit = 50): Promise<ApiResponse<CodDecision[]>> {
    return apiClient<CodDecision[]>(`/admin/cod/rules/decisions?limit=${limit}`);
  },

  createRule(payload: CreateCodRulePayload): Promise<ApiResponse<CodRule>> {
    return apiClient<CodRule>('/admin/cod/rules', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateRule(id: string, payload: Partial<CreateCodRulePayload>): Promise<ApiResponse<CodRule>> {
    return apiClient<CodRule>(`/admin/cod/rules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  deleteRule(id: string): Promise<ApiResponse<void>> {
    return apiClient<void>(`/admin/cod/rules/${id}`, { method: 'DELETE' });
  },
};
