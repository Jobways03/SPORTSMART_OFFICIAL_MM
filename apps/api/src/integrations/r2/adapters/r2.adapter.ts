import { Injectable, Logger } from '@nestjs/common';
import { R2Client } from '../clients/r2.client';

/**
 * Cloudflare R2 storage adapter (replaces S3Adapter). Same method surface
 * the file service used — createUploadUrl / createAccessUrl / deleteFile —
 * now async (the AWS presigner is async) and backed by a real R2 client.
 */
@Injectable()
export class R2Adapter {
  private readonly logger = new Logger(R2Adapter.name);

  constructor(private readonly client: R2Client) {}

  get isConfigured(): boolean {
    return this.client.isConfigured;
  }

  /** Pre-signed PUT URL the client uploads to directly. */
  async createUploadUrl(params: {
    folder: string;
    filename: string;
    contentType: string;
    expiresInSeconds?: number;
  }): Promise<{ uploadUrl: string; publicUrl: string; key: string }> {
    if (!this.client.isConfigured) {
      throw new Error('R2 is not configured');
    }
    const key = this.client.generateKey(params.folder, params.filename);
    return this.client.generatePresignedUploadUrl({
      key,
      contentType: params.contentType,
      expiresInSeconds: params.expiresInSeconds,
    });
  }

  /** Pre-signed GET URL for reading a private object. */
  async createAccessUrl(params: { key: string; expiresInSeconds?: number }): Promise<string> {
    if (!this.client.isConfigured) {
      throw new Error('R2 is not configured');
    }
    return this.client.generatePresignedAccessUrl(params);
  }

  /** Server-side write (tax PDFs etc.). */
  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    if (!this.client.isConfigured) {
      throw new Error('R2 is not configured');
    }
    await this.client.putObject(key, body, contentType);
  }

  async deleteFile(key: string): Promise<void> {
    if (!this.client.isConfigured) {
      this.logger.warn('R2 not configured — skipping delete');
      return;
    }
    await this.client.deleteObject(key);
    this.logger.log(`Object deleted from R2: ${key}`);
  }

  async headObject(
    key: string,
  ): Promise<{ contentLength?: number; contentType?: string } | null> {
    if (!this.client.isConfigured) return null;
    return this.client.headObject(key);
  }

  generateKey(folder: string, filename: string): string {
    return this.client.generateKey(folder, filename);
  }
}
