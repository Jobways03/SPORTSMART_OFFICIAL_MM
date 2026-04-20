import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

const WRITE_TIMEOUT_MS = 10_000;
const SEARCH_TIMEOUT_MS = 5_000;

/**
 * OpenSearch HTTP client. All call sites add an AbortSignal.timeout so
 * a hung OpenSearch node can't block request-path searches (which serve
 * the storefront — 5s cap) or event-handler index writes (10s cap).
 * Index/delete/bulk failures are logged but not thrown — the caller is
 * either an event handler whose primary DB write already succeeded (so
 * we don't want to crash the business flow for a stale-search blip) or
 * a background indexer whose next tick will retry.
 */
@Injectable()
export class OpenSearchClient implements OnModuleInit {
  private readonly logger = new Logger(OpenSearchClient.name);
  private nodeUrl: string = '';

  onModuleInit() {
    this.nodeUrl = process.env.OPENSEARCH_NODE || '';
    if (!this.nodeUrl) {
      this.logger.warn('OpenSearch node not configured — search will fall back to Prisma');
    }
  }

  get isConfigured(): boolean {
    return !!this.nodeUrl;
  }

  private async request(
    op: string,
    url: string,
    init: Omit<RequestInit, 'signal'>,
    timeoutMs: number,
    /** Suppress logging for these status codes (e.g. 404 on delete, 400 on index-already-exists). */
    ignoreStatuses: number[] = [],
  ): Promise<Response | null> {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok && !ignoreStatuses.includes(res.status)) {
        const body = await res.text();
        this.logger.error(`OpenSearch ${op} failed (${res.status}): ${body}`);
      }
      return res;
    } catch (err) {
      // Timeout / network error — previously we'd have hung indefinitely
      // or bubbled an unhandled promise rejection.
      this.logger.error(
        `OpenSearch ${op} errored: ${(err as Error)?.message ?? 'unknown error'}`,
      );
      return null;
    }
  }

  async indexDocument(index: string, id: string, body: Record<string, unknown>): Promise<void> {
    if (!this.isConfigured) return;
    await this.request(
      'index',
      `${this.nodeUrl}/${index}/_doc/${id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      WRITE_TIMEOUT_MS,
    );
  }

  async deleteDocument(index: string, id: string): Promise<void> {
    if (!this.isConfigured) return;
    await this.request(
      'delete',
      `${this.nodeUrl}/${index}/_doc/${id}`,
      { method: 'DELETE' },
      WRITE_TIMEOUT_MS,
      [404],
    );
  }

  async search(index: string, query: Record<string, unknown>): Promise<{
    hits: {
      total: { value: number };
      hits: Array<{
        _id: string;
        _source: Record<string, unknown>;
        _score: number;
      }>;
    };
  }> {
    const empty = { hits: { total: { value: 0 }, hits: [] } };
    if (!this.isConfigured) return empty;

    const res = await this.request(
      'search',
      `${this.nodeUrl}/${index}/_search`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
      },
      SEARCH_TIMEOUT_MS,
    );

    if (!res || !res.ok) {
      return empty;
    }

    return res.json();
  }

  async createIndex(index: string, mappings: Record<string, unknown>): Promise<void> {
    if (!this.isConfigured) return;
    await this.request(
      'createIndex',
      `${this.nodeUrl}/${index}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mappings }),
      },
      WRITE_TIMEOUT_MS,
      [400], // index already exists
    );
  }

  async bulkIndex(index: string, documents: Array<{ id: string; body: Record<string, unknown> }>): Promise<void> {
    if (!this.isConfigured || documents.length === 0) return;

    const bulkBody = documents
      .flatMap((doc) => [
        JSON.stringify({ index: { _index: index, _id: doc.id } }),
        JSON.stringify(doc.body),
      ])
      .join('\n') + '\n';

    await this.request(
      'bulk',
      `${this.nodeUrl}/_bulk`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-ndjson' },
        body: bulkBody,
      },
      WRITE_TIMEOUT_MS,
    );
  }
}
