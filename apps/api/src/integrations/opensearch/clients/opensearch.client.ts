import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

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

  async indexDocument(index: string, id: string, body: Record<string, unknown>): Promise<void> {
    if (!this.isConfigured) return;

    const res = await fetch(`${this.nodeUrl}/${index}/_doc/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const respBody = await res.text();
      this.logger.error(`OpenSearch index failed (${res.status}): ${respBody}`);
    }
  }

  async deleteDocument(index: string, id: string): Promise<void> {
    if (!this.isConfigured) return;

    const res = await fetch(`${this.nodeUrl}/${index}/_doc/${id}`, {
      method: 'DELETE',
    });

    if (!res.ok && res.status !== 404) {
      const body = await res.text();
      this.logger.error(`OpenSearch delete failed (${res.status}): ${body}`);
    }
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
    if (!this.isConfigured) {
      return { hits: { total: { value: 0 }, hits: [] } };
    }

    const res = await fetch(`${this.nodeUrl}/${index}/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    });

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`OpenSearch search failed (${res.status}): ${body}`);
      return { hits: { total: { value: 0 }, hits: [] } };
    }

    return res.json();
  }

  async createIndex(index: string, mappings: Record<string, unknown>): Promise<void> {
    if (!this.isConfigured) return;

    const res = await fetch(`${this.nodeUrl}/${index}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mappings }),
    });

    if (!res.ok && res.status !== 400) {
      // 400 = index already exists
      const body = await res.text();
      this.logger.error(`OpenSearch createIndex failed (${res.status}): ${body}`);
    }
  }

  async bulkIndex(index: string, documents: Array<{ id: string; body: Record<string, unknown> }>): Promise<void> {
    if (!this.isConfigured || documents.length === 0) return;

    const bulkBody = documents
      .flatMap((doc) => [
        JSON.stringify({ index: { _index: index, _id: doc.id } }),
        JSON.stringify(doc.body),
      ])
      .join('\n') + '\n';

    const res = await fetch(`${this.nodeUrl}/_bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-ndjson' },
      body: bulkBody,
    });

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`OpenSearch bulk index failed (${res.status}): ${body}`);
    }
  }
}
