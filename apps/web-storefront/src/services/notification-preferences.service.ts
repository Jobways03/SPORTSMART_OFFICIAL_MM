import { apiClient, ApiResponse } from '@/lib/api-client';

export type NotificationChannel = 'EMAIL' | 'SMS' | 'WHATSAPP';

export interface PreferenceEntry {
  eventClass: string;
  channel: NotificationChannel;
  enabled: boolean;
}

export interface PreferencesResponse {
  preferences: PreferenceEntry[];
  eventClasses: string[];
  channels: NotificationChannel[];
}

export const notificationPreferencesService = {
  list(): Promise<ApiResponse<PreferencesResponse>> {
    return apiClient<PreferencesResponse>('/customer/notifications/preferences');
  },
  update(entries: PreferenceEntry[]): Promise<ApiResponse<unknown>> {
    return apiClient('/customer/notifications/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ entries }),
    });
  },
};

export const EVENT_CLASS_LABEL: Record<string, { title: string; desc: string }> = {
  order: { title: 'Orders', desc: 'Confirmation, dispatch, and delivery updates.' },
  refund: { title: 'Refunds', desc: 'When a refund is processed back to you.' },
  ticket: { title: 'Support tickets', desc: 'Replies from the Sportsmart team on your tickets.' },
  wallet: { title: 'Wallet', desc: 'Top-ups, refund credits, admin adjustments.' },
  marketing: { title: 'Marketing & offers', desc: 'New drops, sales, and seasonal promos.' },
};

export const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  EMAIL: 'Email',
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
};
