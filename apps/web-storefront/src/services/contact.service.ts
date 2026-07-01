import { apiClient, ApiResponse } from '@/lib/api-client';

export interface ContactPayload {
  firstName: string;
  lastName?: string;
  contactMethod: 'email' | 'phone' | 'sms';
  reason: string;
  email: string;
  phone?: string;
  message: string;
  captchaToken?: string;
}

export const contactService = {
  // POST /api/v1/contact — public endpoint that emails the enquiry to support.
  submit(payload: ContactPayload): Promise<ApiResponse> {
    return apiClient('/contact', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
