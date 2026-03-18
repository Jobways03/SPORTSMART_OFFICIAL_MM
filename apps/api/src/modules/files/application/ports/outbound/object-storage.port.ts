export interface ObjectStoragePort { generateUploadUrl(key: string, contentType: string): Promise<string>; generateSignedUrl(key: string, expiresIn: number): Promise<string>; }
