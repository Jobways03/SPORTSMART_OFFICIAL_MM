import { Injectable, Logger } from '@nestjs/common';
import { S3Client } from '../clients/s3.client';

@Injectable()
export class S3Adapter {
  private readonly logger = new Logger(S3Adapter.name);

  constructor(private readonly client: S3Client) {}

  /**
   * Generate a pre-signed URL for uploading a file.
   */
  createUploadUrl(params: {
    folder: string;
    filename: string;
    contentType: string;
    expiresInSeconds?: number;
  }): {
    uploadUrl: string;
    publicUrl: string;
    key: string;
  } {
    if (!this.client.isConfigured) {
      throw new Error('S3 is not configured');
    }

    const key = this.client.generateKey(params.folder, params.filename);
    return this.client.generatePresignedUploadUrl({
      key,
      contentType: params.contentType,
      expiresInSeconds: params.expiresInSeconds,
    });
  }

  /**
   * Generate a pre-signed URL for reading a file.
   */
  createAccessUrl(params: {
    key: string;
    expiresInSeconds?: number;
  }): string {
    if (!this.client.isConfigured) {
      throw new Error('S3 is not configured');
    }

    return this.client.generatePresignedAccessUrl(params);
  }

  /**
   * Delete a file from S3.
   */
  async deleteFile(key: string): Promise<void> {
    if (!this.client.isConfigured) {
      this.logger.warn('S3 not configured — skipping delete');
      return;
    }

    await this.client.deleteObject(key);
    this.logger.log(`File deleted from S3: ${key}`);
  }
}
