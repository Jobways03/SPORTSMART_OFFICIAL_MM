// Centralised TanStack Query keys. Putting them in one place makes
// invalidation predictable — call queryClient.invalidateQueries({
// queryKey: queryKeys.cart() }) instead of remembering the literal.

import type {ProductsQuery} from '../services/catalog.service';

export const queryKeys = {
  menu: (handle: string) => ['menu', handle] as const,
  products: (query: ProductsQuery) => ['products', query] as const,
  productsInfinite: (query: ProductsQuery) =>
    ['products-infinite', query] as const,
  product: (slug: string) => ['product', slug] as const,
  cart: () => ['cart'] as const,
  wishlist: () => ['wishlist'] as const,
  profile: () => ['profile'] as const,
  addresses: () => ['addresses'] as const,
  orders: () => ['orders'] as const,
  order: (orderNumber: string) => ['order', orderNumber] as const,
  returns: () => ['returns'] as const,
  return: (returnId: string) => ['return', returnId] as const,
  returnEligibility: (masterOrderId: string) =>
    ['return-eligibility', masterOrderId] as const,
  wallet: () => ['wallet'] as const,
  walletTransactions: () => ['wallet-transactions'] as const,
  ticketCategories: () => ['ticket-categories'] as const,
  tickets: () => ['tickets'] as const,
  ticket: (id: string) => ['ticket', id] as const,
  checkout: () => ['checkout'] as const,
  shippingQuote: (netInPaise: number) =>
    ['shipping-quote', netInPaise] as const,
  invoices: (orderId: string) => ['invoices', orderId] as const,
  filters: (key: string) => ['filters', key] as const,
  notificationPreferences: () => ['notification-preferences'] as const,
  storefrontStats: () => ['storefront-stats'] as const,
  storefrontConfig: () => ['storefront-config'] as const,
  categories: () => ['categories'] as const,
  brands: () => ['brands'] as const,
  collections: () => ['collections'] as const,
  testimonials: () => ['testimonials'] as const,
  editorial: () => ['editorial'] as const,
  events: () => ['events'] as const,
  stores: () => ['stores-summary'] as const,
  press: () => ['press'] as const,
  flashSale: () => ['flash-sale'] as const,
  productReviews: (slug: string) => ['product-reviews', slug] as const,
  consent: () => ['consent'] as const,
  accessHistory: () => ['access-history'] as const,
  disputes: () => ['disputes'] as const,
  dispute: (id: string) => ['dispute', id] as const,
  blogPosts: () => ['blog-posts'] as const,
  blogPost: (slug: string) => ['blog-post', slug] as const,
  page: (slug: string) => ['page', slug] as const,
};
