import { Injectable } from '@nestjs/common';

@Injectable()
export class EmailAdapter {
  // Anti-corruption layer: notifications module sends normalized messages
  // This adapter handles SMTP/provider-specific formatting
}
