import { Injectable } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { EnvService } from '../../bootstrap/env/env.service';
import { AppLoggerService } from '../../bootstrap/logging/app-logger.service';

export interface CloudinaryUploadOptions {
  folder: string;
  resourceType?: string;
  transformation?: Record<string, unknown>[];
}

export interface CloudinaryUploadResult {
  secureUrl: string;
  publicId: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
}

@Injectable()
export class CloudinaryAdapter {
  private configured = false;

  constructor(
    private readonly envService: EnvService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('CloudinaryAdapter');
    this.configure();
  }

  private configure() {
    const cloudName = this.envService.getOptional('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.envService.getOptional('CLOUDINARY_API_KEY');
    const apiSecret = this.envService.getOptional('CLOUDINARY_API_SECRET');

    if (cloudName && apiKey && apiSecret) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
      });
      this.configured = true;
      this.logger.log('Cloudinary configured successfully');
    } else {
      this.logger.warn('Cloudinary credentials not configured — media uploads will fail');
    }
  }

  async upload(
    fileBuffer: Buffer,
    options: CloudinaryUploadOptions,
  ): Promise<CloudinaryUploadResult> {
    if (!this.configured) {
      throw new Error('Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.');
    }

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: options.folder,
          resource_type: (options.resourceType as 'image') || 'image',
          allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
          transformation: options.transformation,
        },
        (error, result: UploadApiResponse | undefined) => {
          if (error || !result) {
            this.logger.error(`Cloudinary upload failed: ${error?.message || 'Unknown error'}`);
            reject(new Error('Image upload failed'));
            return;
          }

          resolve({
            secureUrl: result.secure_url,
            publicId: result.public_id,
            format: result.format,
            width: result.width,
            height: result.height,
            bytes: result.bytes,
          });
        },
      );

      uploadStream.end(fileBuffer);
    });
  }

  /**
   * Build the canonical secure delivery URL for an asset already in
   * Cloudinary. Used when we hold a publicId (in `storageKey` /
   * `providerFileId`) but didn't store the URL upfront — i.e. for
   * PRIVATE-classified files where we want the URL only handed out
   * via an authenticated server endpoint.
   *
   * Note: our uploads are `type: 'upload'` (default), so the URL is
   * publicly resolvable once known. Privacy here is "we don't surface
   * the URL unless you authenticate against our API," not Cloudinary
   * authenticated/private delivery.
   */
  urlFor(
    publicId: string,
    opts?: { resourceType?: 'image' | 'video' | 'raw' },
  ): string {
    if (!this.configured) return '';
    return cloudinary.url(publicId, {
      secure: true,
      resource_type: opts?.resourceType ?? 'image',
    });
  }

  async delete(publicId: string): Promise<void> {
    if (!this.configured) {
      this.logger.warn('Cloudinary not configured — skipping delete');
      return;
    }

    try {
      await cloudinary.uploader.destroy(publicId);
      this.logger.log(`Cloudinary asset deleted: ${publicId}`);
    } catch (error: any) {
      this.logger.warn(`Failed to delete Cloudinary asset ${publicId}: ${error?.message}`);
    }
  }
}
