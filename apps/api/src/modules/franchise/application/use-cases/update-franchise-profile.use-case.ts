import { Injectable, Inject } from '@nestjs/common';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  NotFoundAppException,
  ForbiddenAppException,
} from '../../../../core/exceptions';
import { AppException } from '../../../../core/exceptions/app.exception';
import { computeFranchiseProfileCompletion } from '../../../../core/utils';
import { FranchiseUpdateProfileDto } from '../../presentation/dtos/franchise-update-profile.dto';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

@Injectable()
export class UpdateFranchiseProfileUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('UpdateFranchiseProfileUseCase');
  }

  async execute(franchiseId: string, dto: FranchiseUpdateProfileDto) {
    const franchise = await this.franchiseRepo.findById(franchiseId);

    if (!franchise) {
      throw new NotFoundAppException('Franchise profile not found');
    }

    // Status-based access control
    if (franchise.status === 'DEACTIVATED') {
      throw new ForbiddenAppException('Account has been deactivated');
    }
    if (franchise.status === 'SUSPENDED') {
      throw new ForbiddenAppException('Account is suspended. Profile editing is not allowed.');
    }

    // Logistics lock — once the franchise is registered with a logistics
    // partner, the fields that make up the courier pickup warehouse
    // (business name, owner/contact, address, city, state, pincode,
    // warehouse address/pincode) are frozen. The franchise can't change
    // them directly; they contact the franchise admin, who edits + re-syncs
    // via "Update address to Delhivery". Tax fields stay editable.
    const LOGISTICS_LOCKED_FIELDS = [
      'ownerName',
      'businessName',
      'state',
      'city',
      'address',
      'pincode',
      'locality',
      'country',
      'warehouseAddress',
      'warehousePincode',
    ];
    const touchesLockedField = LOGISTICS_LOCKED_FIELDS.some(
      (f) => (dto as Record<string, unknown>)[f] !== undefined,
    );
    if (touchesLockedField) {
      const reg = await this.prisma.franchisePartnerRegistration.findFirst({
        where: { franchiseId, status: 'REGISTERED' },
        select: { partner: true },
      });
      if (reg) {
        throw new ForbiddenAppException(
          `Your pickup details are locked because they're registered with ` +
            `${reg.partner}. Contact your franchise admin to update your address.`,
          'LOGISTICS_ADDRESS_LOCKED',
        );
      }
    }

    // Build update data
    // SECURITY: Only whitelisted fields are processed. This prevents commission
    // rate, status, verification, or any other sensitive field from being updated
    // through the profile endpoint even if a caller injects extra fields into the
    // request body.
    const ALLOWED_PROFILE_FIELDS = [
      'ownerName',
      'businessName',
      'state',
      'city',
      'address',
      'pincode',
      'locality',
      'country',
      'gstNumber',
      'panNumber',
      'warehouseAddress',
      'warehousePincode',
    ] as const;

    const updateData: Record<string, unknown> = {};
    for (const field of ALLOWED_PROFILE_FIELDS) {
      const value = (dto as Record<string, unknown>)[field];
      if (value !== undefined) {
        updateData[field] = value;
      }
    }

    if (Object.keys(updateData).length === 0) {
      throw new AppException('No valid fields provided for update', 'BAD_REQUEST');
    }

    // Compute profile completion with merged data
    const merged = { ...franchise, ...updateData };
    const { profileCompletionPercentage, isProfileCompleted } =
      computeFranchiseProfileCompletion(merged as any);

    updateData.profileCompletionPercentage = profileCompletionPercentage;
    updateData.isProfileCompleted = isProfileCompleted;

    // Persist
    const updated = await this.franchiseRepo.updateFranchiseSelect(
      franchiseId,
      updateData,
      {
        id: true,
        franchiseCode: true,
        ownerName: true,
        businessName: true,
        email: true,
        phoneNumber: true,
        state: true,
        city: true,
        address: true,
        pincode: true,
        locality: true,
        country: true,
        gstNumber: true,
        panNumber: true,
        warehouseAddress: true,
        warehousePincode: true,
        profileImageUrl: true,
        logoUrl: true,
        status: true,
        profileCompletionPercentage: true,
        isProfileCompleted: true,
        createdAt: true,
      },
    );

    // Publish event
    this.eventBus
      .publish({
        eventName: 'franchise.profile_updated',
        aggregate: 'franchise',
        aggregateId: franchiseId,
        occurredAt: new Date(),
        payload: {
          franchiseId,
          updatedFields: Object.keys(updateData).filter(
            (k) =>
              !['profileCompletionPercentage', 'isProfileCompleted'].includes(k),
          ),
        },
      })
      .catch(() => {});

    this.logger.log(`Franchise profile updated: ${franchiseId}`);

    return {
      franchiseId: updated.id,
      franchiseCode: updated.franchiseCode,
      ownerName: updated.ownerName,
      businessName: updated.businessName,
      email: updated.email,
      phoneNumber: updated.phoneNumber,
      state: updated.state,
      city: updated.city,
      address: updated.address,
      pincode: updated.pincode,
      locality: updated.locality,
      country: updated.country,
      gstNumber: updated.gstNumber,
      panNumber: updated.panNumber,
      warehouseAddress: updated.warehouseAddress,
      warehousePincode: updated.warehousePincode,
      profileImageUrl: updated.profileImageUrl,
      logoUrl: updated.logoUrl,
      status: updated.status,
      profileCompletionPercentage: updated.profileCompletionPercentage,
      isProfileCompleted: updated.isProfileCompleted,
      createdAt: updated.createdAt,
    };
  }
}
