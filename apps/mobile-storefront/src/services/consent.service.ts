import {apiClient, ApiResponse} from '../lib/api-client';

// DPDP consent management. Mirrors the web storefront's /account/privacy page:
//   GET  /customer/consent — current grant state per purpose
//   POST /customer/consent — body { purpose, granted }

export interface ConsentEntry {
  purpose: string;
  granted: boolean;
  timestamp: string | null;
}

export type ConsentSnapshot = Record<string, ConsentEntry>;

export interface ConsentPurpose {
  key: string;
  title: string;
  description: string;
  group: 'marketing' | 'cookies';
}

export const CONSENT_PURPOSES: ConsentPurpose[] = [
  {
    key: 'EMAIL_MARKETING',
    title: 'Email offers',
    description: 'Promotions, drops and product news by email.',
    group: 'marketing',
  },
  {
    key: 'SMS_MARKETING',
    title: 'SMS offers',
    description: 'Deals and order nudges by text message.',
    group: 'marketing',
  },
  {
    key: 'WHATSAPP_MARKETING',
    title: 'WhatsApp offers',
    description: 'Updates and offers on WhatsApp.',
    group: 'marketing',
  },
  {
    key: 'COOKIE_ANALYTICS',
    title: 'Usage analytics',
    description: 'Help us improve the app with anonymous usage data.',
    group: 'cookies',
  },
  {
    key: 'COOKIE_MARKETING',
    title: 'Personalised marketing',
    description: 'Tailored recommendations and ad measurement.',
    group: 'cookies',
  },
];

export const consentService = {
  get(): Promise<ApiResponse<ConsentSnapshot>> {
    return apiClient<ConsentSnapshot>('/customer/consent');
  },

  set(purpose: string, granted: boolean): Promise<ApiResponse> {
    return apiClient('/customer/consent', {
      method: 'POST',
      body: JSON.stringify({purpose, granted}),
    });
  },
};
