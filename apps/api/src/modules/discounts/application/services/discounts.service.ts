import { Inject, Injectable } from '@nestjs/common';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { Prisma } from '@prisma/client';
import {
  DiscountRepository,
  DISCOUNT_REPOSITORY,
} from '../../domain/repositories/discount.repository.interface';

@Injectable()
export class DiscountsService {
  constructor(
    @Inject(DISCOUNT_REPOSITORY)
    private readonly discountRepo: DiscountRepository,
  ) {}

  async list(filters: {
    page: number;
    limit: number;
    status?: string;
    search?: string;
  }) {
    const { page, limit, status, search } = filters;
    const where: Prisma.DiscountWhereInput = {};
    if (status && status !== 'ALL') where.status = status as any;
    if (search) {
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [discounts, total] = await Promise.all([
      this.discountRepo.findMany(
        where,
        { createdAt: 'desc' },
        (page - 1) * limit,
        limit,
      ),
      this.discountRepo.count(where),
    ]);

    return {
      discounts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async get(id: string) {
    const discount = await this.discountRepo.findByIdWithRelations(id);
    if (!discount) throw new NotFoundAppException('Discount not found');
    return discount;
  }

  async create(data: any) {
    const {
      code,
      title,
      type,
      method,
      productIds,
      collectionIds,
      buyProductIds,
      getProductIds,
      startsAt,
      endsAt,
      ...rest
    } = data;

    if (!type) throw new BadRequestAppException('Discount type is required');
    if (method === 'CODE' && !code?.trim())
      throw new BadRequestAppException('Discount code is required');
    if (method === 'AUTOMATIC' && !title?.trim())
      throw new BadRequestAppException('Discount title is required');

    if (code?.trim()) {
      const existing = await this.discountRepo.findByCode(
        code.trim().toUpperCase(),
      );
      if (existing)
        throw new BadRequestAppException('Discount code already exists');
    }

    const now = new Date();
    const start = startsAt ? new Date(startsAt) : now;
    const end = endsAt ? new Date(endsAt) : null;
    let status: 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' = 'ACTIVE';
    if (start > now) status = 'SCHEDULED';
    if (end && end < now) status = 'EXPIRED';

    const discount = await this.discountRepo.create({
      code: code ? code.trim().toUpperCase() : null,
      title: title?.trim() || null,
      type,
      method: method || 'CODE',
      valueType: rest.valueType || 'PERCENTAGE',
      value: rest.value || 0,
      appliesTo: rest.appliesTo || 'ALL_PRODUCTS',
      minRequirement: rest.minRequirement || 'NONE',
      minRequirementValue: rest.minRequirementValue || null,
      maxUses: rest.maxUses || null,
      onePerCustomer: rest.onePerCustomer || false,
      combineProduct: rest.combineProduct || false,
      combineOrder: rest.combineOrder || false,
      combineShipping: rest.combineShipping || false,
      startsAt: start,
      endsAt: end,
      status,
      buyType: rest.buyType || null,
      buyValue: rest.buyValue || null,
      buyItemsFrom: rest.buyItemsFrom || null,
      getQuantity: rest.getQuantity || null,
      getItemsFrom: rest.getItemsFrom || null,
      getDiscountType: rest.getDiscountType || null,
      getDiscountValue: rest.getDiscountValue || null,
      maxUsesPerOrder: rest.maxUsesPerOrder || null,
    });

    if (productIds?.length) {
      await this.discountRepo.createProductLinks(
        discount.id,
        productIds,
        'APPLIES',
      );
    }
    if (collectionIds?.length) {
      await this.discountRepo.createCollectionLinks(
        discount.id,
        collectionIds,
        'APPLIES',
      );
    }
    if (buyProductIds?.length) {
      await this.discountRepo.createProductLinks(
        discount.id,
        buyProductIds,
        'BUY',
      );
    }
    if (getProductIds?.length) {
      await this.discountRepo.createProductLinks(
        discount.id,
        getProductIds,
        'GET',
      );
    }

    return discount;
  }

  async update(id: string, body: any) {
    const discount = await this.discountRepo.findById(id);
    if (!discount) throw new NotFoundAppException('Discount not found');

    const { productIds, collectionIds, startsAt, endsAt, ...fields } = body;
    const data: any = {};

    for (const key of [
      'code',
      'title',
      'valueType',
      'value',
      'appliesTo',
      'minRequirement',
      'minRequirementValue',
      'maxUses',
      'onePerCustomer',
      'combineProduct',
      'combineOrder',
      'combineShipping',
      'status',
      'buyType',
      'buyValue',
      'buyItemsFrom',
      'getQuantity',
      'getItemsFrom',
      'getDiscountType',
      'getDiscountValue',
      'maxUsesPerOrder',
    ]) {
      if (fields[key] !== undefined) {
        data[key] =
          key === 'code' && fields[key]
            ? fields[key].trim().toUpperCase()
            : fields[key];
      }
    }
    if (startsAt !== undefined) data.startsAt = new Date(startsAt);
    if (endsAt !== undefined) data.endsAt = endsAt ? new Date(endsAt) : null;

    const updated = await this.discountRepo.update(id, data);

    if (productIds !== undefined) {
      await this.discountRepo.deleteProductLinks(id, 'APPLIES');
      if (productIds.length) {
        await this.discountRepo.createProductLinks(id, productIds, 'APPLIES');
      }
    }
    if (collectionIds !== undefined) {
      await this.discountRepo.deleteCollectionLinks(id, 'APPLIES');
      if (collectionIds.length) {
        await this.discountRepo.createCollectionLinks(
          id,
          collectionIds,
          'APPLIES',
        );
      }
    }
    return updated;
  }

  async delete(id: string) {
    const discount = await this.discountRepo.findById(id);
    if (!discount) throw new NotFoundAppException('Discount not found');
    await this.discountRepo.delete(id);
  }
}
