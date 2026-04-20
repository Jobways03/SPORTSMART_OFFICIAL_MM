import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * STUB — NOT PRODUCTION-READY.
 *
 * Nothing in the codebase imports S3Adapter / S3Client today. Image
 * uploads run through CloudinaryAdapter. This module is a placeholder
 * so S3 can be wired in later, but the "presigned URL" it used to
 * return was just the plain public bucket URL (no signature, no auth)
 * and deleteObject was a no-op log. A future caller wiring this up
 * would silently upload to a world-writable bucket — or get 403s if
 * the bucket is correctly private, with no obvious failure mode.
 *
 * Every method now throws an explicit NOT_IMPLEMENTED error so the
 * trap surfaces immediately at first call, not later in production
 * logs. Replace with @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner
 * before using.
 */
function notImplemented(): never {
  throw new Error(
    'S3Client is a stub — uses @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner to be implemented. Use CloudinaryAdapter for image uploads.',
  );
}

@Injectable()
export class S3Client implements OnModuleInit {
  private readonly logger = new Logger(S3Client.name);
  private bucket: string = '';
  private region: string = '';
  private accessKey: string = '';
  private secretKey: string = '';

  onModuleInit() {
    this.bucket = process.env.S3_BUCKET || '';
    this.region = process.env.S3_REGION || 'ap-south-1';
    this.accessKey = process.env.S3_ACCESS_KEY || '';
    this.secretKey = process.env.S3_SECRET_KEY || '';

    if (this.bucket || this.accessKey || this.secretKey) {
      // If anyone sets the env vars we warn loudly — env-present
      // strongly implies intent to use the client, which doesn't work.
      this.logger.warn(
        'S3 env vars are set but S3Client is an unimplemented stub — calls will throw. See class docstring.',
      );
    }
  }

  get isConfigured(): boolean {
    // Intentionally false so `if (isConfigured) { call() }` guards skip
    // the stub. Any caller that bypasses isConfigured hits the throw.
    return false;
  }

  generatePresignedUploadUrl(_params: {
    key: string;
    contentType: string;
    expiresInSeconds?: number;
  }): never {
    notImplemented();
  }

  generatePresignedAccessUrl(_params: {
    key: string;
    expiresInSeconds?: number;
  }): never {
    notImplemented();
  }

  async deleteObject(_key: string): Promise<never> {
    notImplemented();
  }

  generateKey(folder: string, originalFilename: string): string {
    // Key generation itself is pure and safe to leave working — a
    // future impl wants the same UUID-scoped folder path.
    const ext = originalFilename.split('.').pop() || 'bin';
    const uniqueId = crypto.randomUUID();
    return `${folder}/${uniqueId}.${ext}`;
  }
}
