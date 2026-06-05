import {apiClient, ApiResponse} from '../lib/api-client';

// Sporting events surfaced on HomeScreen "Events near you" rail.
// Date arrives as ISO; the UI formats day/month locally so timezone
// behaviour stays consistent with the user's device clock.
export interface SportEvent {
  id: string;
  title: string;
  category: string;
  /** ISO date — UI extracts DD + MMM for the calendar tile. */
  startsAt: string;
  city?: string;
  description?: string;
  url?: string;
  isMemberFree?: boolean;
}

export const eventsService = {
  list(): Promise<ApiResponse<{events: SportEvent[]}>> {
    return apiClient<{events: SportEvent[]}>('/storefront/events');
  },
};
