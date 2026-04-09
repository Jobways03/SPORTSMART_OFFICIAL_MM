import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AdminAuthGuard } from '../../../../core/guards';
import { DataValidationService } from '../../application/services/data-validation.service';

/**
 * Phase 11 / T7: Data Validation Endpoint
 *
 * Provides a comprehensive data integrity report that checks:
 * - Products without productCode
 * - Variants without masterSku
 * - Active products with no seller mappings
 * - Seller mappings referencing deleted products/variants
 * - Orders with invalid product references
 * - Commission records without matching orders
 * - Orphaned stock reservations (expired but not released)
 */
@ApiTags('Admin System')
@Controller('admin/system')
@UseGuards(AdminAuthGuard)
export class DataValidationController {
  constructor(private readonly dataValidationService: DataValidationService) {}

  @Get('data-validation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run data integrity validation across the system' })
  async runDataValidation() {
    return this.dataValidationService.runDataValidation();
  }
}
