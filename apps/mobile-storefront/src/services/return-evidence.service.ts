import {Platform} from 'react-native';
import {apiClient, ApiResponse} from '../lib/api-client';

export interface EvidenceUploadResult {
  url: string;
  publicId: string;
}

// On web the image picker hands us a `blob:`/`data:` URL, and the
// browser's FormData needs a real Blob/File — appending a
// {uri, name, type} object would serialise to "[object Object]" and the
// file never reaches the server ("Image file is required"). On native,
// RN's FormData handles the {uri, name, type} shape directly. DOM
// presence is the reliable anchor (Platform.OS can lag at init).
const IS_WEB =
  typeof window !== 'undefined' &&
  typeof document !== 'undefined' &&
  Platform.OS !== 'ios' &&
  Platform.OS !== 'android';

/**
 * Upload a single image to /customer/returns/evidence. The endpoint
 * accepts multipart/form-data with field `image` and returns the public
 * URL the client should pass to /customer/returns at submit time.
 */
export const returnEvidenceService = {
  async upload(file: {
    uri: string;
    name: string;
    type: string;
  }): Promise<ApiResponse<EvidenceUploadResult>> {
    const form = new FormData();
    if (IS_WEB) {
      // Resolve the blob: URL back to the actual file bytes so the
      // browser sends a real multipart file part.
      const blob = await (await fetch(file.uri)).blob();
      form.append('image', blob, file.name || 'evidence.jpg');
    } else {
      // RN FormData accepts the {uri, name, type} shape; the cast
      // satisfies TS even though the runtime is happy with the object.
      form.append('image', file as unknown as Blob);
    }
    return apiClient<EvidenceUploadResult>('/customer/returns/evidence', {
      method: 'POST',
      body: form,
    });
  },
};
