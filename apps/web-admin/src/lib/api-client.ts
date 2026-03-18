const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  errors?: Array<{ field: string; message: string }>;
  code?: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ApiResponse,
  ) {
    super(body.message || 'Request failed');
  }
}

function getAuthHeaders(): Record<string, string> {
  try {
    const token = sessionStorage.getItem('adminAccessToken');
    if (token) return { Authorization: `Bearer ${token}` };
  } catch {
    // SSR or storage unavailable
  }
  return {};
}

export async function apiClient<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const url = `${API_BASE}/api/v1${endpoint}`;

  const { headers: optionHeaders, ...restOptions } = options;

  const response = await fetch(url, {
    ...restOptions,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...(optionHeaders as Record<string, string>),
    },
  });

  const body: ApiResponse<T> = await response.json();

  if (!response.ok) {
    throw new ApiError(response.status, body);
  }

  return body;
}
