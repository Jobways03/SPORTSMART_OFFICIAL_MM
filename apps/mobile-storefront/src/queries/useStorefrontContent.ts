import {useQuery} from '@tanstack/react-query';
import {
  EditorialStory,
  editorialService,
} from '../services/editorial.service';
import {SportEvent, eventsService} from '../services/events.service';
import {FlashSale, flashSaleService} from '../services/flash-sale.service';
import {PressLogo, pressService} from '../services/press.service';
import {StoreSummary, storesService} from '../services/stores.service';
import {
  Testimonial,
  testimonialsService,
} from '../services/testimonials.service';
import {queryKeys} from './keys';

// All Tier-B "content" endpoints share the same shape: slow-moving
// marketing data with a graceful empty fallback. Consumer screens
// hide their section when the array is empty so a missing backend
// endpoint never breaks the UI.

const CONTENT_STALE_MS = 30 * 60 * 1000;

interface ContentMeta {
  /** Total count from the backend, when available (otherwise infer
   *  from the array length). Surfaced for headlines like
   *  "50,000+ verified reviews". */
  total?: number;
}

export function useTestimonials() {
  return useQuery<{items: Testimonial[]} & ContentMeta>({
    queryKey: queryKeys.testimonials(),
    queryFn: async () => {
      // Service now returns the unwrapped DTO directly — the
      // /storefront/content backend is the new source, and the
      // service shapes its response to match the legacy contract.
      const res = await testimonialsService.list();
      return {items: res.testimonials, total: res.total};
    },
    staleTime: CONTENT_STALE_MS,
    retry: 0,
  });
}

export function useEditorial() {
  return useQuery<EditorialStory[]>({
    queryKey: queryKeys.editorial(),
    queryFn: () => editorialService.list(),
    staleTime: CONTENT_STALE_MS,
    retry: 0,
  });
}

export function useEvents() {
  return useQuery<SportEvent[]>({
    queryKey: queryKeys.events(),
    queryFn: async () => {
      const res = await eventsService.list();
      return res.data?.events ?? [];
    },
    staleTime: CONTENT_STALE_MS,
    retry: 0,
  });
}

export function useStoresSummary() {
  return useQuery<StoreSummary | null>({
    queryKey: queryKeys.stores(),
    queryFn: async () => {
      const res = await storesService.summary();
      return res.data ?? null;
    },
    staleTime: CONTENT_STALE_MS,
    retry: 0,
  });
}

export function usePress() {
  return useQuery<PressLogo[]>({
    queryKey: queryKeys.press(),
    queryFn: async () => {
      const res = await pressService.list();
      return res.press;
    },
    staleTime: CONTENT_STALE_MS,
    retry: 0,
  });
}

// Flash sales are time-sensitive — short staleTime so the countdown
// stays honest. We return only the first active sale because the
// HomeScreen flash strip can only show one at a time.
export function useFlashSale() {
  return useQuery<FlashSale | null>({
    queryKey: queryKeys.flashSale(),
    queryFn: async () => {
      const res = await flashSaleService.active();
      const sales = res.data?.sales ?? [];
      return sales[0] ?? null;
    },
    staleTime: 60 * 1000,
    retry: 0,
  });
}
