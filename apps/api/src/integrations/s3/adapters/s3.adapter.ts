import { Injectable } from '@nestjs/common';

@Injectable()
export class S3Adapter {
  // Anti-corruption layer: all S3-specific logic stays here
  // Files module owns file abstraction, this only handles storage
}
