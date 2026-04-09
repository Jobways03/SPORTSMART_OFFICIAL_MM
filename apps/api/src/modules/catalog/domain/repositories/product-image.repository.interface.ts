export const PRODUCT_IMAGE_REPOSITORY = Symbol('ProductImageRepository');

export interface IProductImageRepository {
  // ── Product images ──
  countByProduct(productId: string): Promise<number>;
  createProductImage(data: any): Promise<any>;
  findProductImage(imageId: string, productId: string): Promise<any | null>;
  deleteProductImage(imageId: string): Promise<void>;
  findFirstByProduct(productId: string): Promise<any | null>;
  setImagePrimary(imageId: string): Promise<void>;
  reorderProductImages(productId: string, imageIds: string[]): Promise<any[]>;

  // ── Variant images ──
  countByVariant(variantId: string): Promise<number>;
  createVariantImage(data: any): Promise<any>;
  findVariantImage(imageId: string, variantId: string): Promise<any | null>;
  deleteVariantImage(imageId: string): Promise<void>;
  deleteVariantImagesByPublicId(variantIds: string[], publicId: string): Promise<void>;
  reorderVariantImages(variantId: string, imageIds: string[]): Promise<void>;

  // ── Color sibling lookup ──
  findColorSiblingVariantIds(productId: string, variantId: string): Promise<string[]>;

  // ── Variant validation ──
  findVariant(variantId: string, productId: string): Promise<any | null>;
}
