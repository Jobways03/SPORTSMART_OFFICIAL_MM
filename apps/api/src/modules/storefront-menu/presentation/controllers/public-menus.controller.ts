import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { StorefrontMenuService } from '../../services/menu.service';

@ApiTags('Storefront — Menus')
@Controller('storefront/menus')
export class PublicMenusController {
  constructor(private readonly service: StorefrontMenuService) {}

  @Get(':handle')
  async getByHandle(@Param('handle') handle: string) {
    return this.service.getMenuByHandle(handle);
  }
}
