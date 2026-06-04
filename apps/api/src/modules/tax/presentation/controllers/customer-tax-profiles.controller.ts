// Phase 25/26 GST — Customer-facing tax-profile API.
//
// Lets a customer manage their B2B GSTIN(s). The default profile drives
// invoice-type detection at order placement time (B2B vs B2C) — see
// `tax-document.service.ts` line 220-228. Customers without any profile
// always get B2C invoices.

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserAuthGuard } from '../../../../core/guards';
import { CustomerTaxProfileService } from '../../application/services/customer-tax-profile.service';
import { CreateCustomerTaxProfileDto } from '../dtos/create-customer-tax-profile.dto';
import { UpdateCustomerTaxProfileDto } from '../dtos/update-customer-tax-profile.dto';

@ApiTags('Customer / Tax Profiles')
@Controller('customer/tax-profiles')
@UseGuards(UserAuthGuard)
export class CustomerTaxProfilesController {
  constructor(
    private readonly profiles: CustomerTaxProfileService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  // Phase 200 (audit #3) — GET 60/min.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async list(@Req() req: any) {
    const profiles = await this.profiles.list(req.userId);
    return {
      success: true,
      message: 'Tax profiles retrieved',
      data: profiles.map(serialise),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  // Phase 161 (#10) — bound profile-create rate (also backstops the max-5 cap).
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async create(@Req() req: any, @Body() dto: CreateCustomerTaxProfileDto) {
    const created = await this.profiles.create(
      req.userId,
      {
        gstin: dto.gstin,
        legalName: dto.legalName,
        billingAddress: dto.billingAddress,
        isDefault: dto.isDefault,
      },
      { ipAddress: ipOf(req) },
    );
    return {
      success: true,
      message: 'Tax profile created',
      data: serialise(created),
    };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerTaxProfileDto,
  ) {
    const updated = await this.profiles.update(req.userId, id, dto, { ipAddress: ipOf(req) });
    return {
      success: true,
      message: 'Tax profile updated',
      data: serialise(updated),
    };
  }

  @Post(':id/set-default')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async setDefault(@Req() req: any, @Param('id') id: string) {
    const updated = await this.profiles.setDefault(req.userId, id, { ipAddress: ipOf(req) });
    return {
      success: true,
      message: 'Default tax profile updated',
      data: serialise(updated),
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async delete(@Req() req: any, @Param('id') id: string) {
    await this.profiles.delete(req.userId, id, { ipAddress: ipOf(req) });
    return {
      success: true,
      message: 'Tax profile deleted',
      data: null,
    };
  }
}

function ipOf(req: any): string | null {
  return req?.ip ?? req?.headers?.['x-forwarded-for'] ?? null;
}

// Strip internal fields (verifiedBy admin id, verificationNotes,
// gstnRawResponseJson, verificationFailureReason) from the customer-facing
// response; verification status itself stays.
//
// Phase 200 (audit #4/#8) — surface legalNameMismatch + gstnPortalStatus so the
// UI can warn the customer that their saved name differs from the GST portal,
// or that the GSTIN is suspended/cancelled and won't produce a clean B2B
// invoice. These are read-only flags, never accepted as input.
function serialise(profile: {
  id: string;
  gstin: string;
  legalName: string;
  billingAddressJson: unknown;
  stateCode: string;
  isDefault: boolean;
  isVerified: boolean;
  verifiedAt: Date | null;
  legalNameMismatch?: boolean;
  gstnPortalStatus?: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: profile.id,
    gstin: profile.gstin,
    legalName: profile.legalName,
    billingAddress: profile.billingAddressJson,
    stateCode: profile.stateCode,
    isDefault: profile.isDefault,
    isVerified: profile.isVerified,
    verifiedAt: profile.verifiedAt,
    legalNameMismatch: profile.legalNameMismatch ?? false,
    portalStatus: profile.gstnPortalStatus ?? null,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}
