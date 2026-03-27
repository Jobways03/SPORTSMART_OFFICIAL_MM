import { Controller, Get, HttpCode, HttpStatus, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../../../bootstrap/database/prisma.service';

@ApiTags('Pincode')
@Controller('pincodes')
export class PincodeLookupController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':pincode')
  @HttpCode(HttpStatus.OK)
  async lookupPincode(@Param('pincode') pincode: string) {
    const entries = await this.prisma.postOffice.findMany({
      where: { pincode },
      select: {
        officeName: true,
        officeType: true,
        delivery: true,
        district: true,
        state: true,
        latitude: true,
        longitude: true,
      },
      orderBy: [
        { officeType: 'asc' }, // HO first, then SO, then BO
        { officeName: 'asc' },
      ],
    });

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
