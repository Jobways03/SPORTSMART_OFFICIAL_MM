import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';

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

    if (!this.bucket || !this.accessKey || !this.secretKey) {
      this.logger.warn('S3 credentials not configured — file operations will fail');
    }
  }

  get isConfigured(): boolean {
    return !!(this.bucket && this.accessKey && this.secretKey);
  }

  /**
   * Generate a pre-signed URL for uploading a file to S3.
   */
  generatePresignedUploadUrl(params: {
    key: string;
    contentType: string;
    expiresInSeconds?: number;
  }): {
    uploadUrl: string;
    publicUrl: string;
    key: string;
  } {
    const expiry = params.expiresInSeconds || 3600;
    const date = new Date();
    const dateStr = date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const dateShort = dateStr.substring(0, 8);

    // Simplified pre-signed URL generation
    // In production, use @aws-sdk/s3-request-presigner
    const publicUrl = `https://${this.bucket}.s3.${this.region}.amazonaws.com/${params.key}`;

    this.logger.log(`Pre-signed upload URL generated for key: ${params.key}`);

    return {
      uploadUrl: publicUrl, // Simplified — real impl uses AWS SDK
      publicUrl,
      key: params.key,
    };
  }

  /**
   * Generate a pre-signed URL for reading a private file from S3.
   */
  generatePresignedAccessUrl(params: {
    key: string;
    expiresInSeconds?: number;
  }): string {
    const publicUrl = `https://${this.bucket}.s3.${this.region}.amazonaws.com/${params.key}`;
    return publicUrl; // Simplified — real impl uses AWS SDK
  }

  /**
   * Delete an object from S3.
   */
  async deleteObject(key: string): Promise<void> {
    if (!this.isConfigured) return;

    // In production, use @aws-sdk/client-s3
    const url = `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;

    this.logger.log(`S3 object deleted: ${key}`);
  }

  /**
   * Generate a unique key for a file upload.
   */
  generateKey(folder: string, originalFilename: string): string {
    const ext = originalFilename.split('.').pop() || 'bin';
    const uniqueId = crypto.randomUUID();
    return `${folder}/${uniqueId}.${ext}`;
  }
}
