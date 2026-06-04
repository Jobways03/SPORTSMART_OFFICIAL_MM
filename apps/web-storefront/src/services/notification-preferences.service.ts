import { apiClient, ApiResponse } from '@/lib/api-client';

export type NotificationChannel = 'EMAIL' | 'SMS' | 'WHATSAPP';

export interface PreferenceEntry {
  eventClass: string;
  channel: NotificationChannel;
  enabled: boolean;
  // Phase 189 — grid metadata.
  locked?: boolean;
  group?: 'TRANSACTIONAL' | 'PROMOTIONAL' | 'CRITICAL';
  label?: string;
}

export interface PreferencesResponse {
  preferences: PreferenceEntry[];
  eventClasses: string[];
  channels: NotificationChannel[];
  meta?: Record<string, { label: string; group: string; locked: boolean }>;
}

export const notificationPreferencesService = {
  list(): Promise<ApiResponse<PreferencesResponse>> {
    return apiClient<PreferencesResponse>('/customer/notifications/preferences');
  },
  update(entries: PreferenceEntry[]): Promise<ApiResponse<unknown>> {
    return apiClient('/customer/notifications/preferences', {
      method: 'PATCH',
      body: JSON.stringify({
        // Only send what the API expects (strip grid metadata + locked rows).
        entries: entries
          .filter((e) => !e.locked)
          .map((e) => ({ eventClass: e.eventClass, channel: e.channel, enabled: e.enabled })),
      }),
    });
  },
  // Phase 189 (#16) — one-click mute-everything-I-can.
  optOutAll(): Promise<ApiResponse<{ mutedClasses: string[] }>> {
    return apiClient('/customer/notifications/preferences/opt-out-all', { method: 'POST' });
  },
  // Phase 190 (#15) — the customer's own notification history (metadata only).
  messages(page = 1, limit = 20): Promise<ApiResponse<{ items: NotificationMessage[]; total: number }>> {
    return apiClient(`/customer/notifications/messages?page=${page}&limit=${limit}`);
  },
};

export interface NotificationMessage {
  id: string;
  channel: NotificationChannel;
  status: string;
  subject: string | null;
  eventType: string | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
}

export const EVENT_CLASS_LABEL: Record<string, { title: string; desc: string }> = {
  order: { title: 'Orders', desc: 'Confirmation, dispatch, and delivery updates.' },
  payment: { title: 'Payments', desc: 'Payment confirmations and receipts.' },
  refund: { title: 'Returns & refunds', desc: 'When a refund is processed back to you.' },
  ticket: { title: 'Support tickets', desc: 'Replies from the Sportsmart team on your tickets.' },
  wallet: { title: 'Wallet', desc: 'Top-ups, refund credits, admin adjustments.' },
  loyalty: { title: 'Loyalty & rewards', desc: 'Points, tiers and reward updates.' },
  marketing: { title: 'Marketing & offers', desc: 'New drops, sales, and seasonal promos.' },
  security: { title: 'Security alerts', desc: 'Sign-in alerts and password changes. Always on.' },
  account: { title: 'Account & legal notices', desc: 'Required account and legal messages. Always on.' },
};

export const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  EMAIL: 'Email',
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
};
