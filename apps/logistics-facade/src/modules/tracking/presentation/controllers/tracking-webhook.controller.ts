import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  NotImplementedException,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

/**
 * Inbound partner tracking webhooks. Deliberately unauthenticated by
 * ApiKey — partners can't supply our internal token. Auth is via
 * HMAC signature verification inside `PartnerWebhookService`
 * (signing secret per partner, recorded in a future PartnerWebhookSecret
 * table). M0 stub returns 501.
 *
 * Path parameter `:partner` lets all partners share one URL prefix
 * so a new partner doesn't need ops-side URL provisioning — just
 * the secret.
 */
@ApiTags('Webhooks')
@Controller({ path: 'webhooks' })
export class TrackingWebhookController {
  @Post(':partner')
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({
    summary: 'Inbound partner webhook (tracking, NDR, COD updates).',
    description:
      'Body shape is partner-specific. Signature is verified against the partner-side secret before any dispatch.',
  })
  @ApiParam({
    name: 'partner',
    description: 'Canonical partner code (uppercase) — must match a registered adapter.',
  })
  @ApiResponse({
    status: 501,
    description: 'Stub — signature verification + dispatch land in M1.',
  })
  receive(
    @Param('partner') _partner: string,
    @Headers('x-webhook-signature') _signature: string,
    @Body() _body: unknown,
  ) {
    throw new NotImplementedException('Stub — implement in M1');
  }
}
