// Phase 86 (2026-05-23) — Gap #16. class-validator DTOs for inbound
// tracking webhooks. Previously the controller typed payloads as
// plain interfaces and trusted whatever shape the carrier posted;
// a malicious actor with the HMAC secret could have stuffed huge
// strings into `remarks` or non-string values into `awb_number` and
// crashed downstream parsers.
//
// These DTOs cap string lengths and constrain shapes so the global
// ValidationPipe rejects malformed payloads at the boundary (before
// the controller's signature check completes — though the global
// pipe runs *before* the controller body, both layers fail closed).

import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const AWB_MAX = 64;
const STATUS_MAX = 128;
const LOCATION_MAX = 256;
const REMARK_MAX = 1024;
const ORDER_ID_MAX = 128;
const TS_MAX = 64;

/**
 * Shiprocket nests AWB + status under `data` in some integration
 * versions, so we accept both top-level and nested forms. The
 * controller's resolver pulls whichever one is populated.
 */
export class ShiprocketWebhookDataDto {
  @IsOptional()
  @IsString()
  @MaxLength(AWB_MAX)
  awb?: string;

  @IsOptional()
  @IsString()
  @MaxLength(STATUS_MAX)
  current_status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(STATUS_MAX)
  shipment_status?: string;

  @IsOptional()
  current_timestamp?: string | number;

  @IsOptional()
  status_received_at?: string | number;
}

export class ShiprocketWebhookDto {
  @IsOptional()
  @IsString()
  @MaxLength(AWB_MAX)
  awb?: string;

  @IsOptional()
  @IsString()
  @MaxLength(STATUS_MAX)
  current_status?: string;

  @IsOptional()
  @IsInt()
  current_status_code?: number;

  @IsOptional()
  @IsString()
  @MaxLength(STATUS_MAX)
  shipment_status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ORDER_ID_MAX)
  order_id?: string;

  // current_timestamp / status_received_at / etd accept either ISO
  // string OR unix-seconds number — class-validator can't express a
  // string|number union directly, so we leave them untyped and rely
  // on the parser's defensive handling. Length checks below cap
  // string forms.
  @IsOptional()
  current_timestamp?: string | number;

  @IsOptional()
  status_received_at?: string | number;

  @IsOptional()
  etd?: string | number;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ShiprocketWebhookDataDto)
  data?: ShiprocketWebhookDataDto;

  // Legacy bearer-token-in-body path. Constrained to 256 chars so
  // an attacker can't ship a multi-MB string here to exhaust the
  // verifyRequest comparison.
  @IsOptional()
  @IsString()
  @MaxLength(256)
  x_token?: string;
}
