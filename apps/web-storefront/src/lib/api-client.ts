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

export async function apiClient<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const url = `${API_BASE}/api/v1${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  // Add auth token if available
  if (typeof window !== 'undefined') {
    try {
      const token = sessionStorage.getItem('accessToken');
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    } catch {
      // Storage unavailable
    }
  }

  const response = await fetch(url, {
    headers,
    ...options,
  });

  const body: ApiResponse<T> = await response.json();

  if (!response.ok) {
    throw new ApiError(response.status, body);
  }

  return body;
}
