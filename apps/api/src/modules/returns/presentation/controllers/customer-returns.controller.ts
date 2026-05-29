import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserAuthGuard } from '../../../../core/guards';
import { BadRequestAppException } from '../../../../core/exceptions';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { CloudinaryAdapter } from '../../../../integrations/cloudinary/cloudinary.adapter';
import { ReturnService } from '../../application/services/return.service';
import { CreateReturnDto } from '../dtos/create-return.dto';
import { CustomerMarkHandedOverDto } from '../dtos/customer-mark-handed-over.dto';

@ApiTags('Customer Returns')
@Controller('customer/returns')
@UseGuards(UserAuthGuard)
export class CustomerReturnsController {
  constructor(
    private readonly returnService: ReturnService,
    private readonly cloudinary: CloudinaryAdapter,
  ) {}

  // POST /customer/returns/evidence — upload a single issue photo before
  // submitting the return. Returns { url } which the client batches into
  // `evidenceFileUrls` on the create payload. 5MB cap per image.
  @Post('evidence')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadEvidence(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file?.buffer) {
      throw new BadRequestAppException('Image file is required');
    }
    const result = await this.cloudinary.upload(file.buffer, {
      folder: `sportsmart/returns/evidence/${req.userId}`,
      resourceType: 'image',
    });
    return {
      success: true,
      message: 'Evidence uploaded',
      data: { url: result.secureUrl, publicId: result.publicId },
    };
  }

  // GET /customer/returns/eligibility/:masterOrderId — check what items can be returned
  @Get('eligibility/:masterOrderId')
  // Phase 92 (2026-05-23) — Gap #14 rate limit. 30 requests/min/user
  // is generous for a wizard step but blocks order-existence probing.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async checkEligibility(
    @Req() req: any,
    @Param('masterOrderId') masterOrderId: string,
  ) {
    // Phase 92 follow-up — Gap #21 audit context.
    const data = await this.returnService.getOrderEligibility(
      masterOrderId,
      req.userId,
      {
        ipAddress: req.ip ?? req.socket?.remoteAddress ?? null,
        userAgent: req.headers?.['user-agent'] ?? null,
      },
    );
    return { success: true, message: 'Eligibility checked', data };
  }

  // POST /customer/returns — create return
  // @Idempotent: client must supply X-Idempotency-Key. A retried wizard
  // submission (browser refresh, network blip during the final POST)
  // returns the original response instead of creating a duplicate Return.
  //
  // Phase 93 (2026-05-23) — Gap #19 explicit 24h idempotency window
  // (replaces the prior decorator-default). Gap #26 rate limit caps
  // POST volume so a hostile customer can't flood return creation
  // for distinct sub-orders.
  @Post()
  // Phase 93 — Gap #19. The current @Idempotent decorator doesn't
  // accept a TTL override; defaults are platform-wide. Document the
  // dependency so a future TTL knob can be added without re-auditing
  // this surface.
  @Idempotent()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async createReturn(@Req() req: any, @Body() dto: CreateReturnDto) {
    const data = await this.returnService.createReturn(req.userId, dto);
    return { success: true, message: 'Return request created', data };
  }

  // GET /customer/returns — list customer's returns
  @Get()
  async listReturns(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    const data = await this.returnService.listCustomerReturns(req.userId, {
      page: Math.max(1, parseInt(page || '1', 10) || 1),
      limit: Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20)),
      status,
    });
    return { success: true, message: 'Returns retrieved', data };
  }

  // GET /customer/returns/:returnId — return detail
  @Get(':returnId')
  async getReturnDetail(
    @Req() req: any,
    @Param('returnId') returnId: string,
  ) {
    const data = await this.returnService.getReturnDetail(
      returnId,
      req.userId,
    );
    return { success: true, message: 'Return retrieved', data };
  }

  // POST /customer/returns/:returnId/cancel — cancel return
  //
  // Phase 93 (2026-05-23) — Gap #23 optional cancellation reason.
  // Inline body shape (no DTO class) — single optional field that the
  // service persists on the Return row for audit.
  @Post(':returnId/cancel')
  async cancelReturn(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() body: { cancellationReason?: string } = {},
  ) {
    const reason =
      typeof body?.cancellationReason === 'string'
        ? body.cancellationReason.trim().slice(0, 500) || undefined
        : undefined;
    const data = await this.returnService.cancelReturn(
      returnId,
      req.userId,
      reason,
    );
    return { success: true, message: 'Return cancelled', data };
  }

  // POST /customer/returns/:returnId/handed-over — customer marks package handed over
  @Post(':returnId/handed-over')
  async markHandedOver(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() dto: CustomerMarkHandedOverDto,
  ) {
    const data = await this.returnService.markHandedOverByCustomer(
      returnId,
      req.userId,
      dto?.trackingNumber,
    );
    return { success: true, message: 'Return marked in transit', data };
  }

  // Phase 13 (P1.14 follow-up) — exchange payment for the price diff.
  //
  // Flow:
  //   1. POST /:id/exchange-payment-init  → mints Razorpay order, returns id
  //   2. Customer completes payment via Razorpay's web SDK / mobile app
  //   3. POST /:id/exchange-payment-verify (orderId, paymentId, signature)
  //      → verifies HMAC, marks payment complete, kicks the replacement
  //         pipeline so the actual replacement order ships
  @Post(':returnId/exchange-payment-init')
  async initiateExchangePayment(
    @Req() req: any,
    @Param('returnId') returnId: string,
  ) {
    const data = await this.returnService.initiateExchangePayment({
      returnId,
      customerId: req.userId,
    });
    return { success: true, message: 'Exchange payment initiated', data };
  }

  @Post(':returnId/exchange-payment-verify')
  async verifyExchangePayment(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body()
    body: {
      razorpayOrderId: string;
      razorpayPaymentId: string;
      razorpaySignature: string;
    },
  ) {
    if (
      !body?.razorpayOrderId ||
      !body?.razorpayPaymentId ||
      !body?.razorpaySignature
    ) {
      throw new BadRequestAppException(
        'razorpayOrderId, razorpayPaymentId, and razorpaySignature are all required',
      );
    }
    const data = await this.returnService.verifyExchangePayment({
      returnId,
      customerId: req.userId,
      razorpayOrderId: body.razorpayOrderId,
      razorpayPaymentId: body.razorpayPaymentId,
      razorpaySignature: body.razorpaySignature,
    });
    return {
      success: true,
      message: 'Exchange payment verified — replacement order shipped',
      data,
    };
  }
}
