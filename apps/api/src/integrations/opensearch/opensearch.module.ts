import { Module } from '@nestjs/common';
import { OpenSearchClient } from './clients/opensearch.client';
import { OpenSearchAdapter } from './adapters/opensearch.adapter';

/**
 * Phase 195 (#1) — was an empty `@Module({})`, so OpenSearchAdapter never
 * resolved through DI and SearchPublicFacade.useOpenSearch() was permanently
 * false: the entire OpenSearch path was dead code regardless of the
 * SEARCH_OPENSEARCH_ENABLED flag.
 *
 * Now provides + exports the client and adapter. Importing this module into
 * SearchModule wires the @Optional() adapter, so the operational flag plus a
 * configured OPENSEARCH_NODE genuinely engages OpenSearch — with the facade's
 * isReady gate + try/catch falling back to Prisma when the node is absent or
 * unreachable, so the default (flag off / no node) behaviour is unchanged.
 */
@Module({
  providers: [OpenSearchClient, OpenSearchAdapter],
  exports: [OpenSearchAdapter],
})
export class OpenSearchModule {}
