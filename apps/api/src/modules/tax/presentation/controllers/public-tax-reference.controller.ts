// Phase 34+ — Public read-only reference data exposed for storefront
// forms (address state-code dropdown). No auth required: this is the
// CBIC 2-digit state code master, already public information.
//
// Endpoints:
//   GET /api/v1/tax/india-states  → [{ code: "29", name: "Karnataka", ... }]
//
// Powers the storefront's address form which now stores the canonical
// 2-digit GST code at write time (column `customer_addresses.state_code`)
// instead of relying on the runtime name-match fallback.

import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

@ApiTags('Tax / Public Reference')
@Controller('tax')
export class PublicTaxReferenceController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('india-states')
  @HttpCode(HttpStatus.OK)
  async listIndiaStates() {
    const rows = await this.prisma.indiaState.findMany({
      where: { isActive: true },
      orderBy: { stateName: 'asc' },
      select: {
        gstStateCode: true,
        stateName: true,
        isoCode: true,
        isUnionTerritory: true,
      },
    });
    return {
      success: true,
      message: 'India states retrieved',
      data: rows.map((r) => ({
        code: r.gstStateCode,
        name: r.stateName,
        isoCode: r.isoCode,
        isUnionTerritory: r.isUnionTerritory,
      })),
    };
  }
}
