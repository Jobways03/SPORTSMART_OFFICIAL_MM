import { Injectable } from '@nestjs/common';

@Injectable()
export class WhatsAppAdapter {
  // Anti-corruption layer: notifications module sends normalized messages
  // This adapter handles provider-specific formatting
}
