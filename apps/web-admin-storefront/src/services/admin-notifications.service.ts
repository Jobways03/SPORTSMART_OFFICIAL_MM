import { apiClient, ApiResponse } from '@/lib/api-client';

export type NotificationChannel = 'EMAIL' | 'SMS' | 'WHATSAPP';
// Phase 185 (#5) — lifecycle states extended: PENDING (pre-queue),
// DELIVERED (carrier receipt), RETRYING, CANCELLED (admin pre-send cancel).
export type NotificationStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'SENT'
  | 'DELIVERED'
  | 'FAILED'
  | 'RETRY'
  | 'RETRYING'
  | 'CANCELLED';

// Phase 187 (#4) — the only legitimate reasons a raw dispatch may bypass
// opt-out. Marketing is deliberately absent.
export type AdminDispatchAlertType =
  | 'ACCOUNT_SECURITY'
  | 'FRAUD_ALERT'
  | 'COMPLIANCE_NOTICE'
  | 'CRITICAL_SERVICE';

// Phase 187 — template path respects opt-out; eventClass is now required and
// must be a registered class.
export interface TemplateDispatchPayload {
  templateKey: string;
  recipientId: string;
  vars?: Record<string, unknown>;
  eventClass: string;
  idempotencyKey?: string;
}

// Phase 187 — raw path bypasses opt-out → alertType + bypassReason +
// confirmation are mandatory.
export interface RawDispatchPayload {
  channel: NotificationChannel;
  recipientId?: string;
  to?: string;
  subject?: string;
  body: string;
  alertType: AdminDispatchAlertType;
  bypassReason: string;
  confirmed: boolean;
  idempotencyKey?: string;
}

export interface DispatchResult {
  jobId: string | null;
  eventId: string;
  status: 'ENQUEUED' | 'SUPPRESSED' | 'FAILED';
  deduped: boolean;
}

// Phase 188 — preview now returns render metadata (#14/#15/#16).
export interface PreviewResult {
  channel: NotificationChannel;
  subject: string | null;
  body: string;
  missingVars: string[];
  missingRequiredVars: string[];
  warnings: string[];
  containsRawHtml: boolean;
  channelHints: Record<string, unknown>;
}

// Phase 188 (#4) — a single version snapshot.
export interface TemplateHistoryEntry {
  id: string;
  version: number;
  channel: NotificationChannel;
  subject: string | null;
  body: string;
  active: boolean;
  changeType: string;
  changedByAdminId: string | null;
  changedAt: string;
}

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
  // Phase 190 — lifecycle + provider + masking.
  deliveredAt?: string | null;
  failedAt?: string | null;
  failureCode?: string | null;
  provider?: string | null;
  parentLogId?: string | null;
  masked?: boolean;
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
  // Phase 185 — DLT (#4), declared vars (#6), internal-strip flag (#14).
  dltTemplateId?: string | null;
  dltHeaderId?: string | null;
  variablesSchema?: Record<string, unknown> | null;
  customerVisibleOnly?: boolean;
}

// Phase 185 (#12) — a dead-lettered notification job.
export interface DeadLetterEntry {
  job: {
    id: string;
    channel: NotificationChannel;
    recipientId?: string;
    destination?: string;
    templateKey?: string;
    subject?: string;
    body: string;
    eventType?: string;
    eventId?: string;
    triggerSource?: string;
    attemptNumber: number;
  };
  reason: string;
  deadLetteredAt: number;
}

export interface QueueStats {
  ready: number;
  delayed: number;
  deadLetter: number;
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

  // Phase 190 — retry now accepts options: bypassReason (override opt-out,
  // audited), forceTemplateReRender (+ vars) to re-render from the current
  // template instead of re-sending the frozen body.
  retry(
    id: string,
    opts?: { bypassReason?: string; forceTemplateReRender?: boolean; vars?: Record<string, unknown> },
  ): Promise<ApiResponse<{ jobId: string; mode: 'FROZEN' | 'RE_RENDERED' }>> {
    return apiClient(`/admin/notifications/logs/${id}/retry`, {
      method: 'POST',
      body: JSON.stringify(opts ?? {}),
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
  ): Promise<ApiResponse<PreviewResult>> {
    return apiClient(`/admin/notifications/templates/${encodeURIComponent(key)}/preview`, {
      method: 'POST',
      body: JSON.stringify({ vars }),
    });
  },

  // Phase 188 (#4) — version history.
  history(key: string): Promise<ApiResponse<{ items: TemplateHistoryEntry[] }>> {
    return apiClient(`/admin/notifications/templates/${encodeURIComponent(key)}/history`);
  },

  // Phase 185 (#16) — send a real test notification of this template.
  testSend(
    key: string,
    to: string,
    vars: Record<string, unknown> = {},
  ): Promise<ApiResponse<{ jobId: string; channel: NotificationChannel }>> {
    return apiClient(`/admin/notifications/templates/${encodeURIComponent(key)}/test-send`, {
      method: 'POST',
      body: JSON.stringify({ to, vars }),
    });
  },

  // ── Phase 185 (#12) — DLQ + queue observability ────────────────
  queueStats(): Promise<ApiResponse<QueueStats>> {
    return apiClient(`/admin/notifications/queue/stats`);
  },

  listDeadLetters(
    offset = 0,
    limit = 50,
  ): Promise<ApiResponse<{ items: DeadLetterEntry[]; total: number }>> {
    return apiClient(`/admin/notifications/dlq?offset=${offset}&limit=${limit}`);
  },

  replayDeadLetter(index: number): Promise<ApiResponse<{ jobId: string }>> {
    return apiClient(`/admin/notifications/dlq/${index}/replay`, { method: 'POST' });
  },

  discardDeadLetter(index: number, reason?: string): Promise<ApiResponse<unknown>> {
    const qs = reason ? `?reason=${encodeURIComponent(reason)}` : '';
    return apiClient(`/admin/notifications/dlq/${index}${qs}`, { method: 'DELETE' });
  },

  // ── Manual dispatch (admin escape hatch) ──────────────────────
  // Phase 187 — split into two permission-tiered endpoints.
  /**
   * POST /admin/notifications/dispatch/template — respects opt-out.
   * Requires `notifications.dispatch.template` (MEDIUM) + a registered
   * eventClass. Send a per-request `idempotencyKey` (and the
   * `X-Idempotency-Key` header) so a double-click can't double-send.
   */
  dispatchTemplate(payload: TemplateDispatchPayload): Promise<ApiResponse<DispatchResult>> {
    return apiClient(`/admin/notifications/dispatch/template`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: payload.idempotencyKey
        ? { 'X-Idempotency-Key': payload.idempotencyKey }
        : undefined,
    });
  },

  /**
   * POST /admin/notifications/dispatch/raw — BYPASSES opt-out. Requires
   * `notifications.dispatch.raw` (CRITICAL), an alertType, a bypassReason
   * and explicit `confirmed: true`. For account-security / fraud /
   * compliance / critical-service messages only — never marketing.
   */
  dispatchRaw(payload: RawDispatchPayload): Promise<ApiResponse<DispatchResult>> {
    return apiClient(`/admin/notifications/dispatch/raw`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: payload.idempotencyKey
        ? { 'X-Idempotency-Key': payload.idempotencyKey }
        : undefined,
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
  PENDING: '#64748b',
  QUEUED: '#0ea5e9',
  SENT: '#16a34a',
  DELIVERED: '#15803d',
  FAILED: '#dc2626',
  RETRY: '#f59e0b',
  RETRYING: '#f59e0b',
  CANCELLED: '#94a3b8',
};

export const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  EMAIL: 'Email',
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
};
