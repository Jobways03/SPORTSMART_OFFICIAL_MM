import { apiClient } from '@/lib/api-client';

export type ChargeRuleBaseType = 'PRICE_OF_GOODS_SOLD' | 'COMMISSION' | 'RULE';

export interface ChargeRule {
  id: string;
  name: string;
  rateBps: number;
  baseType: ChargeRuleBaseType;
  baseRuleId: string | null;
  status: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  priority: number;
  createdAt: string;
}

export interface CreateChargeRuleInput {
  name: string;
  rateBps: number;
  baseType: ChargeRuleBaseType;
  baseRuleId?: string | null;
}

export const adminSettlementChargesService = {
  listRules() {
    return apiClient<ChargeRule[]>('/admin/settlements/charge-rules');
  },
  createRule(input: CreateChargeRuleInput) {
    return apiClient<ChargeRule>('/admin/settlements/charge-rules', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  // Delete a rule. It stops applying to NEW settlement cycles; past settlements
  // keep their frozen charge lines. Blocked if another rule is levied on it.
  deleteRule(id: string) {
    return apiClient<{ id: string }>(`/admin/settlements/charge-rules/${id}`, {
      method: 'DELETE',
    });
  },
};
