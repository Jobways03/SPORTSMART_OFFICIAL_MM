import { Injectable, Logger } from '@nestjs/common';
import { OpenSearchClient } from '../clients/opensearch.client';

const PRODUCTS_INDEX = 'sportsmart_products';

@Injectable()
export class OpenSearchAdapter {
  private readonly logger = new Logger(OpenSearchAdapter.name);

  constructor(private readonly client: OpenSearchClient) {}

  /**
   * Index a product document for search.
   */
  async indexProduct(product: {
    id: string;
    title: string;
    description: string | null;
    slug: string;
    baseSku: string | null;
    basePrice: number;
    salePrice: number | null;
    categoryId: string | null;
    categoryName: string | null;
    brandId: string | null;
    brandName: string | null;
    status: string;
    tags: string[];
    imageUrl: string | null;
  }): Promise<void> {
    if (!this.client.isConfigured) return;

    await this.client.indexDocument(PRODUCTS_INDEX, product.id, {
      title: product.title,
      description: product.description,
      slug: product.slug,
      baseSku: product.baseSku,
      basePrice: product.basePrice,
      salePrice: product.salePrice,
      categoryId: product.categoryId,
      categoryName: product.categoryName,
      brandId: product.brandId,
      brandName: product.brandName,
      status: product.status,
      tags: product.tags,
      imageUrl: product.imageUrl,
    });

    this.logger.log(`Product indexed: ${product.id} (${product.title})`);
  }

  /**
   * Remove a product from the search index.
   */
  async removeProduct(productId: string): Promise<void> {
    if (!this.client.isConfigured) return;
    await this.client.deleteDocument(PRODUCTS_INDEX, productId);
  }

  /**
   * Search products with query and filters.
   */
  async searchProducts(params: {
    query?: string;
    categoryId?: string;
    brandId?: string;
    minPrice?: number;
    maxPrice?: number;
    page?: number;
    limit?: number;
  }): Promise<{
    items: Array<{ id: string; score: number; source: Record<string, unknown> }>;
    total: number;
  }> {
    if (!this.client.isConfigured) {
      return { items: [], total: 0 };
    }

    const must: any[] = [];
    const filter: any[] = [{ term: { status: 'ACTIVE' } }];

    if (params.query) {
      must.push({
        multi_match: {
          query: params.query,
          fields: ['title^3', 'description', 'baseSku', 'tags', 'brandName', 'categoryName'],
          fuzziness: 'AUTO',
        },
      });
    }

    if (params.categoryId) filter.push({ term: { categoryId: params.categoryId } });
    if (params.brandId) filter.push({ term: { brandId: params.brandId } });

    if (params.minPrice || params.maxPrice) {
      const range: any = {};
      if (params.minPrice) range.gte = params.minPrice;
      if (params.maxPrice) range.lte = params.maxPrice;
      filter.push({ range: { basePrice: range } });
    }

    const page = params.page || 1;
    const limit = params.limit || 20;

    const result = await this.client.search(PRODUCTS_INDEX, {
      query: {
        bool: {
          must: must.length > 0 ? must : [{ match_all: {} }],
          filter,
        },
      },
      from: (page - 1) * limit,
      size: limit,
      sort: must.length > 0 ? ['_score', { basePrice: 'asc' }] : [{ basePrice: 'asc' }],
    });

    return {
      items: result.hits.hits.map((hit) => ({
        id: hit._id,
        score: hit._score,
        source: hit._source,
      })),
      total: result.hits.total.value,
    };
  }

  /**
   * Bulk index multiple products.
   */
  async bulkIndexProducts(
    products: Array<{
      id: string;
      title: string;
      description: string | null;
      basePrice: number;
      salePrice: number | null;
      categoryId: string | null;
      categoryName: string | null;
      brandId: string | null;
      brandName: string | null;
      status: string;
      tags: string[];
    }>,
  ): Promise<void> {
    if (!this.client.isConfigured) return;

    await this.client.bulkIndex(
      PRODUCTS_INDEX,
      products.map((p) => ({
        id: p.id,
        body: {
          title: p.title,
          description: p.description,
          basePrice: p.basePrice,
          salePrice: p.salePrice,
          categoryId: p.categoryId,
          categoryName: p.categoryName,
          brandId: p.brandId,
          brandName: p.brandName,
          status: p.status,
          tags: p.tags,
        },
      })),
    );

    this.logger.log(`Bulk indexed ${products.length} products`);
  }

  /**
   * Initialize the products index with proper mappings.
   */
  async initializeIndex(): Promise<void> {
    if (!this.client.isConfigured) return;

    await this.client.createIndex(PRODUCTS_INDEX, {
      properties: {
        title: { type: 'text', analyzer: 'standard' },
        description: { type: 'text' },
        baseSku: { type: 'keyword' },
        basePrice: { type: 'float' },
        salePrice: { type: 'float' },
        categoryId: { type: 'keyword' },
        categoryName: { type: 'text' },
        brandId: { type: 'keyword' },
        brandName: { type: 'text' },
        status: { type: 'keyword' },
        tags: { type: 'keyword' },
        slug: { type: 'keyword' },
        imageUrl: { type: 'keyword', index: false },
      },
    });

    this.logger.log('OpenSearch products index initialized');
  }
}
