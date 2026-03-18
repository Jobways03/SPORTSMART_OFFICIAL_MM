const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export class ApiError extends Error {
  constructor(public status: number, public body: any) {
    super(body?.message || 'API Error');
  }
}

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data: T;
}

export async function apiClient<T = any>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
  const token = typeof window !== 'undefined' ? sessionStorage.getItem('adminAccessToken') : null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api/v1${path}`, { ...init, headers });
  const body = await res.json();
  if (!res.ok) throw new ApiError(res.status, body);
  return body;
}
