export {
  createApiClient,
  ApiError,
} from './api-client';
export type {
  ApiResponse,
  ApiClientConfig,
  ApiClient,
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
