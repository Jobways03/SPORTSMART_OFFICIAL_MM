import { Injectable } from '@nestjs/common';

@Injectable()
export class ShiprocketAdapter {
  // Anti-corruption layer: all Shiprocket-specific logic stays here
  // Only normalized shipment events exposed to shipping module
}
