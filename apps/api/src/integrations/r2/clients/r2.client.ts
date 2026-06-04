import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  S3Client as AwsS3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { EnvService } from '../../../bootstrap/env/env.service';

/**
 * Cloudflare R2 object-storage client. Replaces the former S3 stub.
 *
 * R2 speaks the S3 API, so this is implemented with @aws-sdk/client-s3 +
 * @aws-sdk/s3-request-presigner pointed at the R2 endpoint with
 * `region: 'auto'`. The previous S3Client threw `notImplemented()` on every
 * call; this is a real, working client.
 *
 * Config (all optional in dev): R2_ACCOUNT_ID (→ endpoint
 * https://<account>.r2.cloudflarestorage.com) or R2_ENDPOINT directly,
 * R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and the optional
 * R2_PUBLIC_BASE_URL for public delivery of PUBLIC objects. When any of
 * bucket/creds/endpoint is missing the client reports `isConfigured=false`
 * and callers fall back (mirrors the MediaStorageAdapter pattern).
 */
@Injectable()
export class R2Client implements OnModuleInit {
  private readonly logger = new Logger(R2Client.name);
  private client: AwsS3Client | null = null;
  private bucket = '';
  private publicBaseUrl = '';
  private configured = false;

  constructor(private readonly env: EnvService) {}

  onModuleInit() {
    const accountId = this.env.getOptional('R2_ACCOUNT_ID');
    const endpoint =
      this.env.getOptional('R2_ENDPOINT') ||
      (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
    this.bucket = this.env.getOptional('R2_BUCKET') || '';
    const accessKeyId = this.env.getOptional('R2_ACCESS_KEY_ID') || '';
    const secretAccessKey = this.env.getOptional('R2_SECRET_ACCESS_KEY') || '';
    this.publicBaseUrl = (this.env.getOptional('R2_PUBLIC_BASE_URL') || '').replace(/\/+$/, '');

    if (endpoint && this.bucket && accessKeyId && secretAccessKey) {
      this.client = new AwsS3Client({
        region: 'auto',
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
        // R2 requires path-style addressing.
        forcePathStyle: true,
      });
      this.configured = true;
      this.logger.log(`Cloudflare R2 configured (bucket=${this.bucket})`);
    } else {
      this.logger.warn('Cloudflare R2 not configured — object-storage calls will fall back / throw');
    }
  }

  get isConfigured(): boolean {
    return this.configured;
  }

  /** UUID-scoped key under the folder, preserving the original extension. */
  generateKey(folder: string, originalFilename: string): string {
    const ext = (originalFilename.split('.').pop() || 'bin').replace(/[^A-Za-z0-9]/g, '') || 'bin';
    return `${folder}/${randomUUID()}.${ext}`;
  }

  /** Public delivery URL for a key (only meaningful when R2_PUBLIC_BASE_URL is set). */
  publicUrlFor(key: string): string {
    return this.publicBaseUrl ? `${this.publicBaseUrl}/${key}` : '';
  }

  async generatePresignedUploadUrl(params: {
    key: string;
    contentType: string;
    expiresInSeconds?: number;
  }): Promise<{ uploadUrl: string; publicUrl: string; key: string }> {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: params.key,
      ContentType: params.contentType,
    });
    const uploadUrl = await getSignedUrl(this.client!, cmd, {
      expiresIn: params.expiresInSeconds ?? 600,
    });
    return { uploadUrl, publicUrl: this.publicUrlFor(params.key), key: params.key };
  }

  async generatePresignedAccessUrl(params: {
    key: string;
    expiresInSeconds?: number;
  }): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: params.key });
    return getSignedUrl(this.client!, cmd, { expiresIn: params.expiresInSeconds ?? 300 });
  }

  /** Server-side PUT (e.g. tax-PDF rendering writes bytes directly). */
  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client!.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.client!.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** HEAD — used to verify an uploaded object's size/type at confirm time. */
  async headObject(
    key: string,
  ): Promise<{ contentLength?: number; contentType?: string } | null> {
    try {
      const r = await this.client!.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { contentLength: r.ContentLength, contentType: r.ContentType };
    } catch {
      return null;
    }
  }
}
