import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { NotFoundAppException } from '../../../../core/exceptions';
import { AppException } from '../../../../core/exceptions/app.exception';
import {
  sanitizeRichText,
  isRichTextEmpty,
  getPlainTextLength,
} from '../../../../core/utils/rich-text-sanitizer';
import { computeProfileCompletion } from '../../../seller/application/helpers/profile-completion.helper';
import { AdminAuditService } from '../services/admin-audit.service';

interface AdminEditSellerInput {
  adminId: string;
  sellerId: string;
  payload: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AdminEditSellerUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AdminAuditService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AdminEditSellerUseCase');
  }

  async execute(input: AdminEditSellerInput) {
    const { adminId, sellerId, payload, ipAddress, userAgent } = input;

    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
    });

    if (!seller || seller.isDeleted) {
      throw new NotFoundAppException('Seller not found');
    }

    const updateData: Record<string, unknown> = {};
    const oldValues: Record<string, unknown> = {};

    // Simple fields (same validation as seller self-edit)
    const simpleFields = [
      'sellerName', 'sellerShopName',
      'sellerContactCountryCode', 'sellerContactNumber',
      'storeAddress', 'city', 'state', 'country', 'sellerZipCode',
    ];

    for (const field of simpleFields) {
      if (payload[field] !== undefined) {
        oldValues[field] = (seller as Record<string, unknown>)[field];
        updateData[field] = payload[field];
      }
    }

    // Rich text fields
    const richTextFields: Array<{ key: string; maxLength: number; label: string }> = [
      { key: 'shortStoreDescription', maxLength: 500, label: 'Short description' },
      { key: 'detailedStoreDescription', maxLength: 10000, label: 'Detailed description' },
      { key: 'sellerPolicy', maxLength: 10000, label: 'Policy content' },
    ];

    for (const { key, maxLength, label } of richTextFields) {
      const raw = payload[key];
      if (raw === undefined) continue;
      if (typeof raw !== 'string') {
        throw new AppException(`${label} must be a string`, 'BAD_REQUEST');
      }

      const sanitized = sanitizeRichText(raw);
      if (isRichTextEmpty(sanitized)) {
        throw new AppException(`${label} must not be empty`, 'BAD_REQUEST');
      }
      if (getPlainTextLength(sanitized) > maxLength) {
        throw new AppException(`${label} must not exceed ${maxLength} characters`, 'BAD_REQUEST');
      }

      oldValues[key] = (seller as Record<string, unknown>)[key];
      updateData[key] = sanitized;
    }

    if (Object.keys(updateData).length === 0) {
      throw new AppException('No valid fields provided for update', 'BAD_REQUEST');
    }

    // Recompute profile completion
    const merged = { ...seller, ...updateData };
    const { profileCompletionPercentage, isProfileCompleted } =
      computeProfileCompletion(merged as any);

    updateData.profileCompletionPercentage = profileCompletionPercentage;
    updateData.isProfileCompleted = isProfileCompleted;
    updateData.lastProfileUpdatedAt = new Date();

    const updated = await this.prisma.seller.update({
      where: { id: sellerId },
      data: updateData,
      select: {
        id: true, sellerName: true, sellerShopName: true, email: true,
        phoneNumber: true, sellerContactCountryCode: true, sellerContactNumber: true,
        storeAddress: true, city: true, state: true, country: true, sellerZipCode: true,
        shortStoreDescription: true, detailedStoreDescription: true, sellerPolicy: true,
        sellerProfileImageUrl: true, sellerShopLogoUrl: true,
        status: true, verificationStatus: true, isEmailVerified: true,
        profileCompletionPercentage: true, isProfileCompleted: true,
        lastProfileUpdatedAt: true, createdAt: true, updatedAt: true,
      },
    });

    // Audit log
    await this.auditService.log({
      adminId,
      sellerId,
      actionType: 'SELLER_EDITED',
      oldValue: oldValues,
      newValue: updateData,
      ipAddress,
      userAgent,
    });

    this.logger.log(`Admin ${adminId} edited seller ${sellerId}`);
    return updated;
  }
}
