import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../bootstrap/database/prisma.service';
import { UserAuthGuard } from '../../../core/guards';
import { BadRequestAppException } from '../../../core/exceptions';

@ApiTags('Customer Addresses')
@Controller('customer/addresses')
@UseGuards(UserAuthGuard)
export class CustomerAddressController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listAddresses(@Req() req: any) {
    const addresses = await this.prisma.customerAddress.findMany({
      where: { customerId: req.userId },
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      message: 'Addresses retrieved',
      data: addresses,
    };
  }

  @Post()
  async createAddress(
    @Req() req: any,
    @Body()
    body: {
      fullName: string;
      phone: string;
      addressLine1: string;
      addressLine2?: string;
      city: string;
      state: string;
      postalCode: string;
      isDefault?: boolean;
    },
  ) {
    const { fullName, phone, addressLine1, city, state, postalCode } = body;

    if (!fullName || !phone || !addressLine1 || !city || !state || !postalCode) {
      throw new BadRequestAppException(
        'fullName, phone, addressLine1, city, state, and postalCode are required',
      );
    }

    // If setting as default, unset other defaults
    if (body.isDefault) {
      await this.prisma.customerAddress.updateMany({
        where: { customerId: req.userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const address = await this.prisma.customerAddress.create({
      data: {
        customerId: req.userId,
        fullName,
        phone,
        addressLine1,
        addressLine2: body.addressLine2 || null,
        city,
        state,
        postalCode,
        isDefault: body.isDefault || false,
      },
    });

    return {
      success: true,
      message: 'Address created',
      data: address,
    };
  }
}
