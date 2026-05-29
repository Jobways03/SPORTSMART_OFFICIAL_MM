import { apiClient, ApiResponse } from '@/lib/api-client';

// Mirrors apps/api/src/modules/marketing/marketing.service.ts SportEventDto.
export interface SportEvent {
  id: string;
  title: string;
  category: string;
  startsAt: string;
  endsAt: string | null;
  city: string | null;
  description: string | null;
  url: string | null;
  isMemberFree: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSportEventInput {
  title: string;
  category: string;
  startsAt: string;
  endsAt?: string;
  city?: string;
  description?: string;
  url?: string;
  isMemberFree?: boolean;
  isActive?: boolean;
}

export type UpdateSportEventInput = Partial<CreateSportEventInput>;

export interface SportEventListResponse {
  items: SportEvent[];
  total: number;
  page: number;
  limit: number;
}

export const adminEventsService = {
  list(params: { page?: number; limit?: number } = {}): Promise<
    ApiResponse<SportEventListResponse>
  > {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    const s = qs.toString();
    return apiClient<SportEventListResponse>(
      `/admin/events${s ? `?${s}` : ''}`,
    );
  },

  get(id: string): Promise<ApiResponse<SportEvent>> {
    return apiClient<SportEvent>(`/admin/events/${id}`);
  },

  create(input: CreateSportEventInput): Promise<ApiResponse<SportEvent>> {
    return apiClient<SportEvent>('/admin/events', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  update(
    id: string,
    input: UpdateSportEventInput,
  ): Promise<ApiResponse<SportEvent>> {
    return apiClient<SportEvent>(`/admin/events/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  remove(id: string): Promise<ApiResponse<unknown>> {
    return apiClient(`/admin/events/${id}`, { method: 'DELETE' });
  },
};
