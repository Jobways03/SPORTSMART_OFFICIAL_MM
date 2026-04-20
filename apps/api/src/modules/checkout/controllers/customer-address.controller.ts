import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserAuthGuard } from '../../../core/guards';
import { CustomerAddressService } from '../application/services/customer-address.service';

@ApiTags('Customer Addresses')
@Controller('customer/addresses')
@UseGuards(UserAuthGuard)
export class CustomerAddressController {
  constructor(private readonly addressService: CustomerAddressService) {}

  @Get()
  async listAddresses(@Req() req: any) {
    const addresses = await this.addressService.listAddresses(req.userId);
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
      locality?: string;
      city: string;
      state: string;
      postalCode: string;
      isDefault?: boolean;
    },
  ) {
    const address = await this.addressService.createAddress(req.userId, body);
    return {
      success: true,
      message: 'Address created',
      data: address,
    };
  }

  @Patch(':addressId')
  async updateAddress(
    @Req() req: any,
    @Param('addressId') addressId: string,
    @Body()
    body: {
      fullName?: string;
      phone?: string;
      addressLine1?: string;
      addressLine2?: string | null;
      locality?: string | null;
      city?: string;
      state?: string;
      postalCode?: string;
      isDefault?: boolean;
    },
  ) {
    const address = await this.addressService.updateAddress(
      req.userId,
      addressId,
      body,
    );
    return {
      success: true,
      message: 'Address updated',
      data: address,
    };
  }

  @Delete(':addressId')
  async deleteAddress(
    @Req() req: any,
    @Param('addressId') addressId: string,
  ) {
    await this.addressService.deleteAddress(req.userId, addressId);
    return {
      success: true,
      message: 'Address deleted',
      data: null,
    };
  }

  @Patch(':addressId/set-default')
  async setDefaultAddress(
    @Req() req: any,
    @Param('addressId') addressId: string,
  ) {
    const address = await this.addressService.setDefaultAddress(
      req.userId,
      addressId,
    );
    return {
      success: true,
      message: 'Default address updated',
      data: address,
    };
  }
}
