/**
 * Get Store — POST /api_v3/store/get.json
 *
 * Lists e-commerce stores (Shopify, Magento, etc.) connected to your
 * iThink account. Only relevant if your iThink account ingests orders
 * from a separate storefront. For the marketplace integration, this
 * endpoint is unused — the SPORTSMART API is the source of truth.
 *
 * Retained as a DTO for completeness; no service method wires it.
 */

export interface IThinkGetStoreRequest {
  /** Omit to list all connected stores. */
  store_id?: string;
}

export interface IThinkStoreRow {
  id: string;
  store_name: string;
  mobile: string;
  store_email: string;
  store_website_name: string;
  store_url: string;
  /** shopify | magento | woocommerce | opencart | prestashop. */
  platform_name: string;
}

export type IThinkGetStoreResponseData = IThinkStoreRow[];
