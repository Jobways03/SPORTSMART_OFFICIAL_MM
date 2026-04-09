import {
  Controller,
  Get,
  Post,
  Body,
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
}
