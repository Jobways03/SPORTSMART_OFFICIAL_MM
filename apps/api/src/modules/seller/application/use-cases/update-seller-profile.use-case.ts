import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  NotFoundAppException,
  ForbiddenAppException,
} from '../../../../core/exceptions';
import { AppException } from '../../../../core/exceptions/app.exception';
import {
  sanitizeRichText,
  isRichTextEmpty,
  getPlainTextLength,
} from '../../../../core/utils/rich-text-sanitizer';
import { computeProfileCompletion } from '../helpers/profile-completion.helper';
import { UpdateSellerProfileDto } from '../../presentation/dtos/update-seller-profile.dto';

@Injectable()
export class UpdateSellerProfileUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('UpdateSellerProfileUseCase');
  }

  async execute(sellerId: string, dto: UpdateSellerProfileDto) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
    });

    if (!seller) {
      throw new NotFoundAppException('Seller profile not found');
    }

    // Status-based access control
    if (seller.status === 'DEACTIVATED') {
      throw new ForbiddenAppException('Account has been deactivated');
    }
    if (seller.status === 'SUSPENDED') {
      throw new ForbiddenAppException('Account is suspended. Profile editing is not allowed.');
    }

    // INACTIVE sellers can only update contact and address fields
    const contentFields = ['shortStoreDescription', 'detailedStoreDescription', 'sellerPolicy'];
    if (seller.status === 'INACTIVE') {
      for (const field of contentFields) {
        if ((dto as Record<string, unknown>)[field] !== undefined) {
          throw new ForbiddenAppException(
            'Content updates are not available while account is inactive',
          );
        }
      }
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    const dtoEntries = Object.entries(dto).filter(
      ([, value]) => value !== undefined,
    );

    if (dtoEntries.length === 0) {
      throw new AppException('No valid fields provided for update', 'BAD_REQUEST');
    }

    // Cross-field validation: contact country code and number must come together
    const hasCountryCode = dto.sellerContactCountryCode !== undefined;
    const hasContactNumber = dto.sellerContactNumber !== undefined;
    if (hasCountryCode && !hasContactNumber && !seller.sellerContactNumber) {
      throw new AppException(
        'Contact number is required with country code',
        'BAD_REQUEST',
      );
    }
    if (hasContactNumber && !hasCountryCode && !seller.sellerContactCountryCode) {
      throw new AppException(
        'Country code is required with phone number',
        'BAD_REQUEST',
      );
    }

    // Process each field
    const simpleFields = [
      'sellerName',
      'sellerShopName',
      'sellerContactCountryCode',
      'sellerContactNumber',
      'storeAddress',
      'city',
      'state',
      'country',
      'sellerZipCode',
    ];

    for (const field of simpleFields) {
      const value = (dto as Record<string, unknown>)[field];
      if (value !== undefined) {
        updateData[field] = value;
      }
    }

    // Process rich text fields
    const richTextFields: Array<{ key: string; maxLength: number; label: string }> = [
      { key: 'shortStoreDescription', maxLength: 500, label: 'Short description' },
      { key: 'detailedStoreDescription', maxLength: 10000, label: 'Detailed description' },
      { key: 'sellerPolicy', maxLength: 10000, label: 'Policy content' },
    ];

    for (const { key, maxLength, label } of richTextFields) {
      const raw = (dto as Record<string, unknown>)[key];
      if (raw === undefined) continue;

      if (typeof raw !== 'string') {
        throw new AppException(`${label} must be a string`, 'BAD_REQUEST');
      }

      const sanitized = sanitizeRichText(raw);

      if (isRichTextEmpty(sanitized)) {
        throw new AppException(`${label} must not be empty`, 'BAD_REQUEST');
      }

      if (getPlainTextLength(sanitized) > maxLength) {
        throw new AppException(
          `${label} must not exceed ${maxLength} characters`,
          'BAD_REQUEST',
        );
      }

      updateData[key] = sanitized;
    }

    // Compute profile completion with merged data
    const merged = { ...seller, ...updateData };
    const { profileCompletionPercentage, isProfileCompleted } =
      computeProfileCompletion(merged as any);

    updateData.profileCompletionPercentage = profileCompletionPercentage;
    updateData.isProfileCompleted = isProfileCompleted;
    updateData.lastProfileUpdatedAt = new Date();

    // Persist
    const updated = await this.prisma.seller.update({
      where: { id: sellerId },
      data: updateData,
      select: {
        id: true,
        sellerName: true,
        sellerShopName: true,
        email: true,
        sellerContactCountryCode: true,
        sellerContactNumber: true,
        storeAddress: true,
        city: true,
        state: true,
        country: true,
        sellerZipCode: true,
        shortStoreDescription: true,
        detailedStoreDescription: true,
        sellerPolicy: true,
        sellerProfileImageUrl: true,
        sellerShopLogoUrl: true,
        status: true,
        profileCompletionPercentage: true,
        isProfileCompleted: true,
        lastProfileUpdatedAt: true,
        createdAt: true,
      },
    });

    // Publish event
    this.eventBus
      .publish({
        eventName: 'seller.profile_updated',
        aggregate: 'seller',
        aggregateId: sellerId,
        occurredAt: new Date(),
        payload: {
          sellerId,
          updatedFields: Object.keys(updateData).filter(
            (k) =>
              !['profileCompletionPercentage', 'isProfileCompleted', 'lastProfileUpdatedAt'].includes(k),
          ),
        },
      })
      .catch(() => {});

    this.logger.log(`Seller profile updated: ${sellerId}`);

    return {
      sellerId: updated.id,
      email: updated.email,
      sellerName: updated.sellerName,
      sellerShopName: updated.sellerShopName,
      sellerContactCountryCode: updated.sellerContactCountryCode,
      sellerContactNumber: updated.sellerContactNumber,
      storeAddress: updated.storeAddress,
      city: updated.city,
      state: updated.state,
      country: updated.country,
      sellerZipCode: updated.sellerZipCode,
      shortStoreDescription: updated.shortStoreDescription,
      detailedStoreDescription: updated.detailedStoreDescription,
      sellerPolicy: updated.sellerPolicy,
      sellerProfileImageUrl: updated.sellerProfileImageUrl,
      sellerShopLogoUrl: updated.sellerShopLogoUrl,
      status: updated.status,
      profileCompletionPercentage: updated.profileCompletionPercentage,
      isProfileCompleted: updated.isProfileCompleted,
      lastProfileUpdatedAt: updated.lastProfileUpdatedAt,
      createdAt: updated.createdAt,
    };
  }
}
