import { Injectable } from '@nestjs/common';

@Injectable()
export class OpenSearchAdapter {
  // Anti-corruption layer: hides OpenSearch query DSL
  // Search module uses internal search request/response contracts
}
