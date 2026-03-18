import {
  Controller, Get, Post, Put, Delete,
  Param, Query, Body, HttpCode, HttpStatus, UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../bootstrap/database/prisma.service';
import { AdminAuthGuard } from '../../../core/guards';
import { BadRequestAppException, NotFoundAppException } from '../../../core/exceptions';
import { Prisma } from '@prisma/client';

@ApiTags('Admin Discounts')
@Controller('admin/discounts')
@UseGuards(AdminAuthGuard)
export class AdminDiscountsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));

    const where: Prisma.DiscountWhereInput = {};
    if (status && status !== 'ALL') where.status = status as any;
    if (search) {
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [discounts, total] = await Promise.all([
      this.prisma.discount.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      this.prisma.discount.count({ where }),
    ]);

    return {
      success: true, message: 'Discounts retrieved',
      data: {
        discounts,
        pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
      },
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async get(@Param('id') id: string) {
    const discount = await this.prisma.discount.findUnique({
      where: { id },
      include: {
        products: { include: { product: { select: { id: true, title: true, images: { where: { isPrimary: true }, select: { url: true }, take: 1 } } } } },
        collections: { include: { collection: { select: { id: true, name: true } } } },
      },
    });
    if (!discount) throw new NotFoundAppException('Discount not found');
    return { success: true, message: 'Discount retrieved', data: discount };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: any) {
    const {
      code, title, type, method, valueType, value,
      appliesTo, minRequirement, minRequirementValue,
      maxUses, onePerCustomer,
      combineProduct, combineOrder, combineShipping,
      startsAt, endsAt,
      productIds, collectionIds,
      // BXGY fields
      buyType, buyValue, buyItemsFrom, buyProductIds, buyCollectionIds,
      getQuantity, getItemsFrom, getProductIds, getCollectionIds,
      getDiscountType, getDiscountValue, maxUsesPerOrder,
    } = body;

    if (!type) throw new BadRequestAppException('Discount type is required');
    if (method === 'CODE' && !code?.trim()) throw new BadRequestAppException('Discount code is required');
    if (method === 'AUTOMATIC' && !title?.trim()) throw new BadRequestAppException('Discount title is required');

    // Check unique code
    if (code?.trim()) {
      const existing = await this.prisma.discount.findUnique({ where: { code: code.trim().toUpperCase() } });
      if (existing) throw new BadRequestAppException('Discount code already exists');
    }

    const now = new Date();
    const start = startsAt ? new Date(startsAt) : now;
    const end = endsAt ? new Date(endsAt) : null;
    let status: 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' = 'ACTIVE';
    if (start > now) status = 'SCHEDULED';
    if (end && end < now) status = 'EXPIRED';

    const discount = await this.prisma.discount.create({
      data: {
        code: code ? code.trim().toUpperCase() : null,
        title: title?.trim() || null,
        type,
        method: method || 'CODE',
        valueType: valueType || 'PERCENTAGE',
        value: value || 0,
        appliesTo: appliesTo || 'ALL_PRODUCTS',
        minRequirement: minRequirement || 'NONE',
        minRequirementValue: minRequirementValue || null,
        maxUses: maxUses || null,
        onePerCustomer: onePerCustomer || false,
        combineProduct: combineProduct || false,
        combineOrder: combineOrder || false,
        combineShipping: combineShipping || false,
        startsAt: start,
        endsAt: end,
        status,
        // BXGY
        buyType: buyType || null,
        buyValue: buyValue || null,
        buyItemsFrom: buyItemsFrom || null,
        getQuantity: getQuantity || null,
        getItemsFrom: getItemsFrom || null,
        getDiscountType: getDiscountType || null,
        getDiscountValue: getDiscountValue || null,
        maxUsesPerOrder: maxUsesPerOrder || null,
      },
    });

    // Link products
    if (productIds?.length) {
      await this.prisma.discountProduct.createMany({
        data: productIds.map((pid: string) => ({ discountId: discount.id, productId: pid, scope: 'APPLIES' })),
      });
    }
    if (collectionIds?.length) {
      await this.prisma.discountCollection.createMany({
        data: collectionIds.map((cid: string) => ({ discountId: discount.id, collectionId: cid, scope: 'APPLIES' })),
      });
    }
    // BXGY links
    if (buyProductIds?.length) {
      await this.prisma.discountProduct.createMany({
        data: buyProductIds.map((pid: string) => ({ discountId: discount.id, productId: pid, scope: 'BUY' })),
      });
    }
    if (getProductIds?.length) {
      await this.prisma.discountProduct.createMany({
        data: getProductIds.map((pid: string) => ({ discountId: discount.id, productId: pid, scope: 'GET' })),
      });
    }

    return { success: true, message: 'Discount created', data: discount };
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async update(@Param('id') id: string, @Body() body: any) {
    const discount = await this.prisma.discount.findUnique({ where: { id } });
    if (!discount) throw new NotFoundAppException('Discount not found');

    const {
      code, title, valueType, value, appliesTo,
      minRequirement, minRequirementValue,
      maxUses, onePerCustomer,
      combineProduct, combineOrder, combineShipping,
      startsAt, endsAt, status,
      productIds, collectionIds,
      buyType, buyValue, buyItemsFrom,
      getQuantity, getItemsFrom, getDiscountType, getDiscountValue, maxUsesPerOrder,
    } = body;

    const data: any = {};
    if (code !== undefined) data.code = code ? code.trim().toUpperCase() : null;
    if (title !== undefined) data.title = title?.trim() || null;
    if (valueType !== undefined) data.valueType = valueType;
    if (value !== undefined) data.value = value;
    if (appliesTo !== undefined) data.appliesTo = appliesTo;
    if (minRequirement !== undefined) data.minRequirement = minRequirement;
    if (minRequirementValue !== undefined) data.minRequirementValue = minRequirementValue;
    if (maxUses !== undefined) data.maxUses = maxUses;
    if (onePerCustomer !== undefined) data.onePerCustomer = onePerCustomer;
    if (combineProduct !== undefined) data.combineProduct = combineProduct;
    if (combineOrder !== undefined) data.combineOrder = combineOrder;
    if (combineShipping !== undefined) data.combineShipping = combineShipping;
    if (startsAt !== undefined) data.startsAt = new Date(startsAt);
    if (endsAt !== undefined) data.endsAt = endsAt ? new Date(endsAt) : null;
    if (status !== undefined) data.status = status;
    // BXGY
    if (buyType !== undefined) data.buyType = buyType;
    if (buyValue !== undefined) data.buyValue = buyValue;
    if (buyItemsFrom !== undefined) data.buyItemsFrom = buyItemsFrom;
    if (getQuantity !== undefined) data.getQuantity = getQuantity;
    if (getItemsFrom !== undefined) data.getItemsFrom = getItemsFrom;
    if (getDiscountType !== undefined) data.getDiscountType = getDiscountType;
    if (getDiscountValue !== undefined) data.getDiscountValue = getDiscountValue;
    if (maxUsesPerOrder !== undefined) data.maxUsesPerOrder = maxUsesPerOrder;

    const updated = await this.prisma.discount.update({ where: { id }, data });

    // Relink products/collections if provided
    if (productIds !== undefined) {
      await this.prisma.discountProduct.deleteMany({ where: { discountId: id, scope: 'APPLIES' } });
      if (productIds.length) {
        await this.prisma.discountProduct.createMany({
          data: productIds.map((pid: string) => ({ discountId: id, productId: pid, scope: 'APPLIES' })),
        });
      }
    }
    if (collectionIds !== undefined) {
      await this.prisma.discountCollection.deleteMany({ where: { discountId: id, scope: 'APPLIES' } });
      if (collectionIds.length) {
        await this.prisma.discountCollection.createMany({
          data: collectionIds.map((cid: string) => ({ discountId: id, collectionId: cid, scope: 'APPLIES' })),
        });
      }
    }

    return { success: true, message: 'Discount updated', data: updated };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id') id: string) {
    const discount = await this.prisma.discount.findUnique({ where: { id } });
    if (!discount) throw new NotFoundAppException('Discount not found');
    await this.prisma.discount.delete({ where: { id } });
    return { success: true, message: 'Discount deleted' };
  }
}
