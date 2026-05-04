import { apiClient, ApiResponse } from '@/lib/api-client';

export type NotificationChannel = 'EMAIL' | 'SMS' | 'WHATSAPP';
export type NotificationStatus = 'QUEUED' | 'SENT' | 'FAILED' | 'RETRY';

export interface NotificationLog {
  id: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  recipientId: string | null;
  destination: string;
  templateKey: string | null;
  subject: string | null;
  body: string;
  eventType: string | null;
  eventId: string | null;
  providerMessageId: string | null;
  failureReason: string | null;
  attemptNumber: number;
  createdAt: string;
  sentAt: string | null;
}

export interface LogListResponse {
  items: NotificationLog[];
  page: number;
  limit: number;
  total: number;
}

export interface NotificationTemplate {
  id?: string;
  key: string;
  channel: NotificationChannel;
  subject?: string | null;
  body: string;
  description?: string | null;
  active?: boolean;
  fromDefault?: boolean;
}

export const adminNotificationsService = {
  // ── Logs ───────────────────────────────────────────────────────
  listLogs(filter: {
    page?: number;
    limit?: number;
    channel?: NotificationChannel | '';
    status?: NotificationStatus | '';
    recipientId?: string;
    eventType?: string;
    search?: string;
    fromDate?: string;
    toDate?: string;
  } = {}): Promise<ApiResponse<LogListResponse>> {
    const qs = new URLSearchParams();
    qs.set('page', String(filter.page ?? 1));
    qs.set('limit', String(filter.limit ?? 50));
    if (filter.channel) qs.set('channel', filter.channel);
    if (filter.status) qs.set('status', filter.status);
    if (filter.recipientId?.trim()) qs.set('recipientId', filter.recipientId.trim());
    if (filter.eventType?.trim()) qs.set('eventType', filter.eventType.trim());
    if (filter.search?.trim()) qs.set('search', filter.search.trim());
    if (filter.fromDate) qs.set('fromDate', filter.fromDate);
    if (filter.toDate) qs.set('toDate', filter.toDate);
    return apiClient<LogListResponse>(
      `/admin/notifications/logs?${qs.toString()}`,
    );
  },

  getLog(id: string): Promise<ApiResponse<NotificationLog>> {
    return apiClient<NotificationLog>(`/admin/notifications/logs/${id}`);
  },

  retry(id: string): Promise<ApiResponse<unknown>> {
    return apiClient(`/admin/notifications/logs/${id}/retry`, {
      method: 'POST',
    });
  },

  // ── Templates ──────────────────────────────────────────────────
  listTemplates(filter: {
    channel?: NotificationChannel | '';
    active?: 'true' | 'false' | '';
    search?: string;
  } = {}): Promise<ApiResponse<{ items: NotificationTemplate[] }>> {
    const qs = new URLSearchParams();
    if (filter.channel) qs.set('channel', filter.channel);
    if (filter.active) qs.set('active', filter.active);
    if (filter.search?.trim()) qs.set('search', filter.search.trim());
    const q = qs.toString();
    return apiClient(`/admin/notifications/templates${q ? '?' + q : ''}`);
  },

  getTemplate(key: string): Promise<ApiResponse<NotificationTemplate>> {
    return apiClient<NotificationTemplate>(
      `/admin/notifications/templates/${encodeURIComponent(key)}`,
    );
  },

  upsertTemplate(
    key: string,
    payload: Omit<NotificationTemplate, 'id' | 'key' | 'fromDefault'>,
  ): Promise<ApiResponse<NotificationTemplate>> {
    return apiClient(`/admin/notifications/templates/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  toggleActive(key: string, active: boolean): Promise<ApiResponse<NotificationTemplate>> {
    return apiClient(`/admin/notifications/templates/${encodeURIComponent(key)}/active`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    });
  },

  preview(
    key: string,
    vars: Record<string, unknown>,
  ): Promise<ApiResponse<{ channel: NotificationChannel; subject: string | null; body: string }>> {
    return apiClient(`/admin/notifications/templates/${encodeURIComponent(key)}/preview`, {
      method: 'POST',
      body: JSON.stringify({ vars }),
    });
  },

  // ── Preferences (read-only) ────────────────────────────────────
  getPreferencesForUser(userId: string): Promise<ApiResponse<{
    preferences: Array<{
      id: string;
      userId: string;
      eventClass: string;
      channel: NotificationChannel;
      enabled: boolean;
    }>;
  }>> {
    return apiClient(`/admin/notifications/preferences/${userId}`);
  },
};

export const STATUS_COLOR: Record<NotificationStatus, string> = {
  QUEUED: '#0ea5e9',
  SENT: '#16a34a',
  FAILED: '#dc2626',
  RETRY: '#f59e0b',
};

export const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  EMAIL: 'Email',
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
};
