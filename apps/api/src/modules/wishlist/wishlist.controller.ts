import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { UserAuthGuard } from '../../core/guards';
import { WishlistService } from './wishlist.service';

interface AddToWishlistDto {
  productId: string;
  variantId?: string;
  note?: string;
}

@ApiTags('Wishlist')
@Controller('customer/wishlist')
@UseGuards(UserAuthGuard)
export class WishlistController {
  constructor(private readonly service: WishlistService) {}

  @Get()
  async list(
    @Req() req: Request & { userId?: string },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.service.list(
      req.userId as string,
      parseInt(page || '1', 10) || 1,
      parseInt(limit || '50', 10) || 50,
    );
    return { success: true, message: 'Wishlist retrieved', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async add(
    @Req() req: Request & { userId?: string },
    @Body() body: AddToWishlistDto,
  ) {
    const data = await this.service.add(req.userId as string, body);
    return { success: true, message: 'Added to wishlist', data };
  }

  @Delete(':itemId')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Req() req: Request & { userId?: string },
    @Param('itemId') itemId: string,
  ) {
    await this.service.remove(req.userId as string, itemId);
    return { success: true, message: 'Removed from wishlist' };
  }
}
