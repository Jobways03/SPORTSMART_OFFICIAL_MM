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
import { FileInterceptor } from '@nestjs/platform-express';
import { UserAuthGuard } from '../../../../core/guards';
import { BadRequestAppException } from '../../../../core/exceptions';
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
  async checkEligibility(
    @Req() req: any,
    @Param('masterOrderId') masterOrderId: string,
  ) {
    const data = await this.returnService.getOrderEligibility(
      masterOrderId,
      req.userId,
    );
    return { success: true, message: 'Eligibility checked', data };
  }

  // POST /customer/returns — create return
  @Post()
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
  @Post(':returnId/cancel')
  async cancelReturn(@Req() req: any, @Param('returnId') returnId: string) {
    const data = await this.returnService.cancelReturn(returnId, req.userId);
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
}
