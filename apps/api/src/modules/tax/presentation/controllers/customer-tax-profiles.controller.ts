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
  async create(@Req() req: any, @Body() dto: CreateCustomerTaxProfileDto) {
    const created = await this.profiles.create(req.userId, {
      gstin: dto.gstin,
      legalName: dto.legalName,
      billingAddress: dto.billingAddress,
      isDefault: dto.isDefault,
    });
    return {
      success: true,
      message: 'Tax profile created',
      data: serialise(created),
    };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerTaxProfileDto,
  ) {
    const updated = await this.profiles.update(req.userId, id, dto);
    return {
      success: true,
      message: 'Tax profile updated',
      data: serialise(updated),
    };
  }

  @Post(':id/set-default')
  @HttpCode(HttpStatus.OK)
  async setDefault(@Req() req: any, @Param('id') id: string) {
    const updated = await this.profiles.setDefault(req.userId, id);
    return {
      success: true,
      message: 'Default tax profile updated',
      data: serialise(updated),
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async delete(@Req() req: any, @Param('id') id: string) {
    await this.profiles.delete(req.userId, id);
    return {
      success: true,
      message: 'Tax profile deleted',
      data: null,
    };
  }
}

// Strip internal fields (verifiedBy admin id, verificationNotes) from
// the customer-facing response; verification status itself stays.
function serialise(profile: {
  id: string;
  gstin: string;
  legalName: string;
  billingAddressJson: unknown;
  stateCode: string;
  isDefault: boolean;
  isVerified: boolean;
  verifiedAt: Date | null;
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
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}
