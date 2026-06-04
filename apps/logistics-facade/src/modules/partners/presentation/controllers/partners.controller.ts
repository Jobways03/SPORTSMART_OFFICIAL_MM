import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UsePipes,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RequireApiKey } from '../../../../core/api-keys/require-api-key.decorator';
import { ZodValidationPipe } from '../../../../core/pipes/zod-validation.pipe';
import { PartnersService } from '../../application/services/partners.service';
import {
  PartnerInfo,
  type PartnerListResponse,
} from '../../application/dto/partner-info.dto';
import {
  RegisterWarehouseRequest,
  UpdateWarehouseRequest,
  type RegisterWarehouseResponse,
} from '../../application/dto/register-warehouse.dto';

/**
 * Partner discovery + warehouse registration. The admin UI (via
 * apps/api) calls these endpoints so a new courier showing up in the
 * facade's partner catalogue automatically becomes visible on every
 * seller detail page without a frontend change.
 *
 * Served at `/api/v1/partners` — the `/api` prefix and the `/v1` both
 * come from the app-wide config (setGlobalPrefix + URI versioning with
 * defaultVersion '1' in main.ts), exactly like every other controller.
 * Do NOT put `v1/` in the path here, or the version doubles to
 * `/api/v1/v1/partners`; a future breaking change uses `@Version('2')`.
 *
 * Auth: ApiKey (only peer services — apps/api — hit this; the admin
 * dashboard never talks to the facade directly).
 */
@ApiTags('Partners')
@RequireApiKey()
@Controller({ path: 'partners' })
export class PartnersController {
  constructor(private readonly partnersService: PartnersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List every partner the facade can talk to + capability matrix.',
    description:
      'Static catalogue. Capability discovery is hardcoded today; future iterations may derive it from the partner-side health-check.',
  })
  @ApiResponse({
    status: 200,
    description: 'JSON array of PartnerInfo (code, displayName, capabilities).',
  })
  list(): PartnerListResponse {
    return this.partnersService.listPartners();
  }

  @Post(':code/warehouses')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a pickup location ("warehouse") with the named partner.',
    description:
      'Delhivery: creates a Client Warehouse — name becomes the immutable pickup-location id. Shadowfax: 400, registration is not required.',
  })
  @ApiParam({
    name: 'code',
    description: 'Partner code (e.g. DELHIVERY). Uppercase, snake-safe.',
  })
  @ApiResponse({ status: 201, description: 'Warehouse registered.' })
  @ApiResponse({
    status: 400,
    description:
      'Unknown partner code, partner does not require warehouse registration, or partner rejected the payload.',
  })
  @UsePipes()
  registerWarehouse(
    @Param('code') code: string,
    @Body(new ZodValidationPipe(RegisterWarehouseRequest))
    body: RegisterWarehouseRequest,
  ): Promise<RegisterWarehouseResponse> {
    return this.partnersService.registerWarehouse(code, body);
  }

  @Post(':code/warehouses/:name/edit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update an existing pickup location ("warehouse") with the partner.',
    description:
      'Delhivery: edits phone / address / pin / registered_name on the named warehouse. The warehouse name itself is immutable.',
  })
  @ApiParam({ name: 'code', description: 'Partner code (e.g. DELHIVERY).' })
  @ApiParam({ name: 'name', description: 'Existing warehouse (pickup-location) name.' })
  @ApiResponse({ status: 200, description: 'Warehouse updated.' })
  @UsePipes()
  updateWarehouse(
    @Param('code') code: string,
    @Param('name') name: string,
    @Body(new ZodValidationPipe(UpdateWarehouseRequest))
    body: UpdateWarehouseRequest,
  ): Promise<RegisterWarehouseResponse> {
    return this.partnersService.updateWarehouse(code, name, body);
  }
}

// Re-export for Nest type-resolution + ensure tree-shaking keeps PartnerInfo alive.
export type { PartnerInfo };
