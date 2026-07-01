export {
  createApiClient,
  ApiError,
  registerStepUpHandler,
} from './api-client';

// Cross-app storefront URL resolver — portals link to the storefront's legal
// pages (Terms/Privacy live only there). See storefront-url.ts.
export { resolveStorefrontUrl, STOREFRONT_LEGAL_PATHS } from './storefront-url';
export type {
  ApiResponse,
  ApiClientConfig,
  ApiClient,
  TokenStorage,
  StepUpHandler,
} from './api-client';

// Money formatting — BigInt-safe paise↔rupee conversions used by every
// frontend table that displays an amount and by the backend HTML
// invoice template. Centralised here so we never coerce
// `Number(BigInt(...))` on values that exceed Number.MAX_SAFE_INTEGER.
export {
  paiseToRupees,
  paiseToRupeesString,
  rupeesToPaise,
  toPaiseBigInt,
} from './money';
export type { PaiseValue } from './money';
