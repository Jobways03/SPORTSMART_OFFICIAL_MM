export interface ApiResponseContract<TData = unknown> {
  success: boolean;
  message: string;
  data?: TData;
  meta?: Record<string, unknown>;
}
