import { Module } from '@nestjs/common';
import { AdminAuthGuard } from '../../core/guards';
import { StorefrontMenuService } from './services/menu.service';
import { PublicMenusController } from './presentation/controllers/public-menus.controller';
import { AdminMenusController } from './presentation/controllers/admin-menus.controller';

@Module({
  controllers: [PublicMenusController, AdminMenusController],
  providers: [StorefrontMenuService, AdminAuthGuard],
  exports: [StorefrontMenuService],
})
export class StorefrontMenuModule {}
