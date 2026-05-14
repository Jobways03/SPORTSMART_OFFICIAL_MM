import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  OwnBrandProcurementStatus,
  OwnBrandStockMovementKind,
} from '@prisma/client';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import {
  CreateProcurementOrderInput,
  CreateWarehouseInput,
  OwnBrandRepository,
  OWN_BRAND_REPOSITORY,
  ProcurementListFilter,
  ReceiveProcurementInput,
  UpdateWarehouseInput,
} from '../../domain/repositories/own-brand.repository.interface';

@Injectable()
export class OwnBrandService {
  private readonly logger = new Logger(OwnBrandService.name);

  constructor(
    @Inject(OWN_BRAND_REPOSITORY) private readonly repo: OwnBrandRepository,
    private readonly eventBus: EventBusService,
  ) {}

  // ── Warehouses ─────────────────────────────────────────────────

  listWarehouses(activeOnly = false) {
    return this.repo.listWarehouses(activeOnly);
  }

  async createWarehouse(input: CreateWarehouseInput) {
    if (!input.code?.trim()) throw new BadRequestAppException('code is required');
    if (!input.name?.trim()) throw new BadRequestAppException('name is required');
    if (!/^\d{6}$/.test(input.pincode)) {
      throw new BadRequestAppException('pincode must be 6 digits');
    }
    return this.repo.createWarehouse({
      code: input.code.trim(),
      name: input.name.trim(),
      pincode: input.pincode,
      addressLine: input.addressLine.trim(),
      city: input.city.trim(),
      state: input.state.trim(),
    });
  }

  async updateWarehouse(id: string, data: UpdateWarehouseInput) {
    const found = await this.repo.findWarehouseById(id);
    if (!found) throw new NotFoundAppException('Warehouse not found');
    return this.repo.updateWarehouse(id, data);
  }

  // ── Products (own-brand discriminator) ─────────────────────────

  listOwnBrandProducts(args: { page?: number; limit?: number; search?: string }) {
    return this.repo.listOwnBrandProducts({
      page: args.page ?? 1,
      limit: args.limit ?? 20,
      search: args.search,
    });
  }

  async convertToOwnBrand(productId: string) {
    const product = await this.repo.findProductById(productId);
    if (!product) throw new NotFoundAppException('Product not found');
    if (product.productSource === 'OWN_BRAND') return product;
    const sku = await this.repo.generateOwnBrandSku();
    return this.repo.setProductSource({
      productId,
      source: 'OWN_BRAND',
      ownBrandSku: sku,
    });
  }

  async unconvertToSeller(productId: string) {
    const product = await this.repo.findProductById(productId);
    if (!product) throw new NotFoundAppException('Product not found');
    if (product.productSource === 'SELLER') return product;
    // Ensure no live stock remains before un-converting — refusing
    // protects audit and prevents orphaned own-brand stock rows.
    const available = await this.repo.getAvailableForProduct(productId);
    if (available > 0) {
      throw new BadRequestAppException(
        `Cannot un-convert: ${available} units still in NOVA stock. ` +
          `Move or write-off first.`,
      );
    }
    return this.repo.setProductSource({
      productId,
      source: 'SELLER',
      ownBrandSku: null,
    });
  }

  // ── Stocks ─────────────────────────────────────────────────────

  listStocks(args: {
    warehouseId?: string;
    productId?: string;
    lowStockOnly?: boolean;
  }) {
    return this.repo.listStocks(args);
  }

  async adjustStock(args: {
    warehouseId: string;
    productId: string;
    variantId?: string | null;
    delta: number;
    reason: string;
    adminId?: string;
  }) {
    if (!Number.isInteger(args.delta) || args.delta === 0) {
      throw new BadRequestAppException('delta must be a non-zero integer');
    }
    if (!args.reason?.trim()) {
      throw new BadRequestAppException('reason is required');
    }
    const wh = await this.repo.findWarehouseById(args.warehouseId);
    if (!wh) throw new NotFoundAppException('Warehouse not found');
    const prod = await this.repo.findProductById(args.productId);
    if (!prod) throw new NotFoundAppException('Product not found');
    if (prod.productSource !== 'OWN_BRAND') {
      throw new BadRequestAppException(
        'Product is not an OWN_BRAND product — convert it first',
      );
    }
    return this.repo.adjustStock({
      warehouseId: args.warehouseId,
      productId: args.productId,
      variantId: args.variantId ?? null,
      delta: args.delta,
      kind: 'ADJUSTMENT',
      reason: args.reason.trim(),
      adminId: args.adminId ?? null,
    });
  }

  listStockMovements(args: {
    warehouseId?: string;
    productId?: string;
    variantId?: string | null;
    kind?: OwnBrandStockMovementKind;
    limit?: number;
  }) {
    return this.repo.listStockMovements(args);
  }

  // Story 3.4 — transfer stock between two Nova warehouses. Validates
  // shape + that both warehouses exist + the product is an OWN_BRAND
  // product before handing off to the repo's atomic transaction. The
  // repo enforces the "available >= quantity" check inside the tx so
  // there's no TOCTOU window where two concurrent transfers could
  // both pass validation and over-draw the source.
  async transferStock(args: {
    fromWarehouseId: string;
    toWarehouseId: string;
    productId: string;
    variantId?: string | null;
    quantity: number;
    reason: string;
    adminId?: string;
  }) {
    if (!Number.isInteger(args.quantity) || args.quantity <= 0) {
      throw new BadRequestAppException('quantity must be a positive integer');
    }
    if (args.fromWarehouseId === args.toWarehouseId) {
      throw new BadRequestAppException(
        'Source and destination warehouses must differ',
      );
    }
    if (!args.reason?.trim()) {
      throw new BadRequestAppException('reason is required');
    }
    const [fromWh, toWh, prod] = await Promise.all([
      this.repo.findWarehouseById(args.fromWarehouseId),
      this.repo.findWarehouseById(args.toWarehouseId),
      this.repo.findProductById(args.productId),
    ]);
    if (!fromWh) throw new NotFoundAppException('Source warehouse not found');
    if (!toWh) throw new NotFoundAppException('Destination warehouse not found');
    if (!prod) throw new NotFoundAppException('Product not found');
    if (prod.productSource !== 'OWN_BRAND') {
      throw new BadRequestAppException(
        'Product is not an OWN_BRAND product — convert it first',
      );
    }
    try {
      return await this.repo.transferStock({
        fromWarehouseId: args.fromWarehouseId,
        toWarehouseId: args.toWarehouseId,
        productId: args.productId,
        variantId: args.variantId ?? null,
        quantity: args.quantity,
        reason: args.reason.trim(),
        adminId: args.adminId ?? null,
      });
    } catch (e: any) {
      // The repo throws `Error('Insufficient stock — …')` and
      // `Error('No stock row …')`. Convert to BadRequest so the
      // operator-facing surface returns 400 with the precise reason
      // rather than 500.
      if (e?.message?.startsWith('Insufficient stock') || e?.message?.startsWith('No stock row')) {
        throw new BadRequestAppException(e.message);
      }
      throw e;
    }
  }

  listReceiptsForPo(poId: string) {
    return this.repo.listReceiptsForPo(poId);
  }

  // ── Procurement ────────────────────────────────────────────────

  listProcurement(filter: ProcurementListFilter) {
    return this.repo.listProcurement(filter);
  }

  async getProcurement(id: string) {
    const po = await this.repo.findProcurementById(id);
    if (!po) throw new NotFoundAppException('Procurement order not found');
    return po;
  }

  async createProcurement(args: {
    warehouseId: string;
    supplierName: string;
    expectedDate?: Date | null;
    supplierReference?: string | null;
    notes?: string | null;
    items: Array<{
      productId: string;
      variantId?: string | null;
      quantityOrdered: number;
      unitCost: number;
    }>;
    createdByAdminId?: string;
  }) {
    if (!args.supplierName?.trim()) {
      throw new BadRequestAppException('supplierName is required');
    }
    if (!args.items?.length) {
      throw new BadRequestAppException('At least one item is required');
    }
    const wh = await this.repo.findWarehouseById(args.warehouseId);
    if (!wh) throw new NotFoundAppException('Warehouse not found');
    if (!wh.isActive) {
      throw new BadRequestAppException(
        'Warehouse is inactive — re-activate it before creating new POs',
      );
    }

    // Snapshot product titles/skus at creation time so the PO record
    // stays stable if the catalog later renames a product.
    const enrichedItems: CreateProcurementOrderInput['items'] = [];
    for (const it of args.items) {
      if (!Number.isInteger(it.quantityOrdered) || it.quantityOrdered <= 0) {
        throw new BadRequestAppException('quantityOrdered must be a positive integer');
      }
      if (!Number.isFinite(it.unitCost) || it.unitCost < 0) {
        throw new BadRequestAppException('unitCost must be non-negative');
      }
      const product = await this.repo.findProductById(it.productId);
      if (!product) {
        throw new BadRequestAppException(`Product ${it.productId} not found`);
      }
      enrichedItems.push({
        productId: it.productId,
        variantId: it.variantId ?? null,
        productTitle: product.title,
        variantTitle: null, // variant-title resolution can come later
        ownBrandSku: product.ownBrandSku,
        quantityOrdered: it.quantityOrdered,
        unitCost: it.unitCost,
      });
    }

    const poNumber = await this.repo.generateNextPoNumber();
    const created = await this.repo.createProcurement({
      poNumber,
      warehouseId: args.warehouseId,
      supplierName: args.supplierName.trim(),
      expectedDate: args.expectedDate ?? null,
      supplierReference: args.supplierReference?.trim() || null,
      notes: args.notes?.trim() || null,
      items: enrichedItems,
      createdByAdminId: args.createdByAdminId ?? null,
    });
    this.logger.log(
      `Procurement ${created.poNumber} created — ${created.items.length} items, ₹${created.totalAmount}`,
    );
    return created;
  }

  async transitionStatus(id: string, target: OwnBrandProcurementStatus) {
    const po = await this.repo.findProcurementById(id);
    if (!po) throw new NotFoundAppException('Procurement order not found');

    const allowed: Record<OwnBrandProcurementStatus, OwnBrandProcurementStatus[]> = {
      DRAFT: ['PLACED', 'CANCELLED'],
      PLACED: ['IN_TRANSIT', 'RECEIVED', 'CANCELLED'],
      IN_TRANSIT: ['RECEIVED', 'CANCELLED'],
      RECEIVED: [],
      CANCELLED: [],
    };
    if (!allowed[po.status].includes(target)) {
      throw new BadRequestAppException(
        `Cannot transition PO from ${po.status} to ${target}`,
      );
    }
    return this.repo.setProcurementStatus({
      id,
      status: target,
      receivedAt: target === 'RECEIVED' ? new Date() : undefined,
    });
  }

  async receiveProcurement(input: ReceiveProcurementInput) {
    if (!input.receipts?.length) {
      throw new BadRequestAppException('At least one item receipt is required');
    }
    const result = await this.repo.applyReceipt(input);

    // Fire-and-forget event so downstream (inventory cache, finance
    // accrual, low-stock recheck) can react without coupling.
    if (result.status === 'RECEIVED') {
      try {
        await this.eventBus.publish({
          eventName: 'nova.po.received',
          aggregate: 'OwnBrandProcurementOrder',
          aggregateId: result.id,
          occurredAt: new Date(),
          payload: {
            poId: result.id,
            poNumber: result.poNumber,
            warehouseId: result.warehouseId,
            totalAmount: Number(result.totalAmount),
            itemCount: result.items.length,
          },
        });
      } catch {
        // events are best-effort
      }
    }

    return result;
  }
}
