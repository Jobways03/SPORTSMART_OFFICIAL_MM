import PostHog from 'posthog-react-native';
import {POSTHOG_API_KEY, POSTHOG_HOST} from '@env';

// PostHog's event-props type is JSON-only (string | number | boolean |
// null | nested). Our call sites pass `Record<string, unknown>` for
// flexibility; this narrows to PostHog's accepted shape via a single
// cast at the boundary so individual track() calls stay clean.
type AnalyticsProps = Record<string, unknown>;

// Singleton — created on first init. When POSTHOG_API_KEY is empty,
// posthog stays null and the helpers below no-op. Lets us scatter
// track() calls throughout the app without worrying about whether
// analytics is configured in the current build.
let posthog: PostHog | null = null;

let initialised = false;

export function initAnalytics(): void {
  if (initialised) return;
  initialised = true;
  if (!POSTHOG_API_KEY) return;
  posthog = new PostHog(POSTHOG_API_KEY, {
    host: POSTHOG_HOST || 'https://us.i.posthog.com',
    // Flush every 20 events or 30s — balance battery vs. data freshness.
    // Background flush still triggers on app backgrounding.
    flushAt: 20,
    flushInterval: 30_000,
  });
}

/**
 * Identify the current user. Call right after successful login so events
 * before this point get back-linked to the user via PostHog's $anon_id
 * → distinct_id alias.
 */
export function identifyUser(userId: string, props?: AnalyticsProps) {
  if (!posthog) return;
  // Cast at the boundary — PostHog wants JsonType-only values; our
  // call sites pass arbitrary record shapes for ergonomics.
  posthog.identify(userId, props as Record<string, string | number | boolean | null>);
}

/** Clear identity on logout — subsequent events go to a fresh anon id. */
export function resetAnalytics() {
  if (!posthog) return;
  posthog.reset();
}

/**
 * Track an event. Event name should be `Object Verb` past-tense for
 * consistency (e.g. `Order Placed`, `Product Viewed`). Props are
 * arbitrary JSON-serializable values; PostHog truncates strings at 100KB.
 */
export function track(event: string, props?: AnalyticsProps) {
  if (!posthog) return;
  posthog.capture(event, props as Record<string, string | number | boolean | null>);
}

/**
 * Track a screen view. Wire via React Navigation's onStateChange so
 * every navigation lands a $screen event without per-screen plumbing.
 */
export function trackScreen(name: string, props?: AnalyticsProps) {
  if (!posthog) return;
  posthog.screen(name, props as Record<string, string | number | boolean | null>);
}

// Canonical event names — using constants keeps spelling consistent
// across the codebase and makes a "rename this event" refactor a single-
// file change. Group prefixes (Auth, Product, Cart, Checkout) make
// PostHog dashboards easier to organise.
export const Events = {
  AuthSignupCompleted: 'Auth Signup Completed',
  AuthLoginCompleted: 'Auth Login Completed',
  AuthLoginFailed: 'Auth Login Failed',
  AuthLogout: 'Auth Logout',

  ProductSearched: 'Product Searched',
  ProductViewed: 'Product Viewed',
  ProductFiltersApplied: 'Product Filters Applied',

  CartItemAdded: 'Cart Item Added',
  WishlistItemAdded: 'Wishlist Item Added',

  CheckoutInitiated: 'Checkout Initiated',
  CheckoutAddressChanged: 'Checkout Address Changed',
  PaymentStarted: 'Payment Started',
  PaymentSucceeded: 'Payment Succeeded',
  PaymentFailed: 'Payment Failed',
  PaymentDismissed: 'Payment Dismissed',

  ReturnStarted: 'Return Started',
  WalletTopupCompleted: 'Wallet Topup Completed',
} as const;
