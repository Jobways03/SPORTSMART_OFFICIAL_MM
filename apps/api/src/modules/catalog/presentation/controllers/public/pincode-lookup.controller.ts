import { Controller, Get, HttpCode, HttpStatus, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Inject } from '@nestjs/common';
import { STOREFRONT_REPOSITORY, IStorefrontRepository } from '../../../domain/repositories/storefront.repository.interface';

@ApiTags('Pincode')
@Controller('pincodes')
export class PincodeLookupController {
  constructor(
    @Inject(STOREFRONT_REPOSITORY) private readonly storefrontRepo: IStorefrontRepository,
  ) {}

  @Get(':pincode')
  @HttpCode(HttpStatus.OK)
  async lookupPincode(@Param('pincode') pincode: string) {
    const entries = await this.storefrontRepo.findPostOfficeByPincode(pincode);

    if (entries.length === 0) {
      return {
        success: false,
        message: 'Pincode not found',
        data: null,
      };
    }

    const first = entries[0];

    return {
      success: true,
      message: 'Pincode found',
      data: {
        pincode,
        district: first.district,
        state: first.state,
        places: entries.map(e => ({
          name: e.officeName,
          type: e.officeType,
          delivery: e.delivery,
          latitude: e.latitude ? Number(e.latitude) : null,
          longitude: e.longitude ? Number(e.longitude) : null,
        })),
      },
    };
  }
}
