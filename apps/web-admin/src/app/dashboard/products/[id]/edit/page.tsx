'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { adminProductsService, ProductDetail } from '@/services/admin-products.service';
import { ApiError } from '@/lib/api-client';
import RejectModal from '../../components/reject-modal';
import RequestChangesModal from '../../components/request-changes-modal';
import '../../product-form.css';
import { RichTextEditor } from '@sportsmart/ui';

// ----- Types -----

interface CategoryNode {
  id: string;
  name: string;
  children?: CategoryNode[];
}

interface Brand {
  id: string;
  name: string;
}

interface FlatCategory {
  id: string;
  name: string;
  depth: number;
}

interface Toast {
  type: 'success' | 'error';
  message: string;
}

interface OptionEntry {
  name: string;
  values: string[];
  isEditing: boolean;
}

interface PredefinedOption {
  id: string;
  name: string;
  displayName: string;
  type: string;
  values: { id: string; value: string; displayValue: string }[];
}

type ModalType = 'reject' | 'requestChanges' | null;

// ----- Helpers -----

function flattenCategories(nodes: CategoryNode[], depth = 0): FlatCategory[] {
  const result: FlatCategory[] = [];
  for (const node of nodes) {
    result.push({ id: node.id, name: node.name, depth });
    if (node.children && node.children.length > 0) {
      result.push(...flattenCategories(node.children, depth + 1));
    }
  }
  return result;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ----- Component -----

export default function EditProductPage() {
  const router = useRouter();
  const params = useParams();
  const productId = params.id as string;

  // Form state (single object like seller)
  const [form, setForm] = useState({
    title: '',
    categoryId: '',
    categoryName: '',
    brandId: '',
    brandName: '',
    shortDescription: '',
    description: '',
    hasVariants: false,
    basePrice: '',
    platformPrice: '',
    compareAtPrice: '',
    costPrice: '',
    baseSku: '',
    baseStock: '',
    baseBarcode: '',
    weight: '',
    weightUnit: 'kg',
    length: '',
    width: '',
    height: '',
    dimensionUnit: 'cm',
    returnPolicy: '',
    warrantyInfo: '',
    tags: [] as string[],
    seoMetaTitle: '',
    seoMetaDescription: '',
    seoHandle: '',
  });

  const [tagInput, setTagInput] = useState('');
  const [seoHandleEdited, setSeoHandleEdited] = useState(true); // true by default in edit mode

  // Product data
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Reference data
  const [categories, setCategories] = useState<FlatCategory[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);

  // UI state
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Modal
  const [activeModal, setActiveModal] = useState<ModalType>(null);

  // Status change
  const [statusAction, setStatusAction] = useState('');
  const [statusChanging, setStatusChanging] = useState(false);

  // Variant options state
  const [productOptions, setProductOptions] = useState<OptionEntry[]>([]);
  const [predefinedOptions, setPredefinedOptions] = useState<PredefinedOption[]>([]);
  const [generatingVariants, setGeneratingVariants] = useState(false);

  // Image state
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Duplicate detection state
  const [duplicateProduct, setDuplicateProduct] = useState<any>(null);
  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const [merging, setMerging] = useState(false);

  // ----- Toast helper -----

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ type, message });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // ----- Populate form from product -----

  const populateForm = useCallback((p: ProductDetail) => {
    setForm({
      title: p.title || '',
      categoryId: p.categoryId || '',
      categoryName: p.category?.name || '',
      brandId: p.brandId || '',
      brandName: p.brand?.name || '',
      shortDescription: p.shortDescription || '',
      description: p.description || '',
      hasVariants: p.hasVariants,
      basePrice: p.basePrice ?? '',
      platformPrice: (p as any).platformPrice ?? '',
      compareAtPrice: p.compareAtPrice && Number(p.compareAtPrice) > 0 ? p.compareAtPrice : '',
      costPrice: p.costPrice ?? '',
      baseSku: p.baseSku || '',
      baseStock: p.baseStock != null ? String(p.baseStock) : '',
      baseBarcode: p.baseBarcode || '',
      weight: p.weight ?? '',
      weightUnit: p.weightUnit || 'kg',
      length: p.length ?? '',
      width: p.width ?? '',
      height: p.height ?? '',
      dimensionUnit: p.dimensionUnit || 'cm',
      returnPolicy: p.returnPolicy || '',
      warrantyInfo: p.warrantyInfo || '',
      tags: (p.tags || []).map(t => t.tag),
      seoMetaTitle: p.seo?.metaTitle || '',
      seoMetaDescription: p.seo?.metaDescription || '',
      seoHandle: p.seo?.handle || '',
    });
  }, []);

  // ----- Load product and reference data -----

  const loadProduct = useCallback(async () => {
    try {
      const res = await adminProductsService.getProduct(productId);
      if (res.data) {
        setProduct(res.data);
        populateForm(res.data);

        // Reconstruct options from product data
        if ((res.data as any).options && (res.data as any).optionValues) {
          const optEntries: OptionEntry[] = [];
          for (const po of (res.data as any).options) {
            const def = po.optionDefinition;
            if (!def) continue;
            const vals = (res.data as any).optionValues
              .filter((pov: any) => pov.optionValue?.optionDefinitionId === def.id)
              .map((pov: any) => pov.optionValue?.displayValue || pov.optionValue?.value || '');
            optEntries.push({ name: def.displayName || def.name, values: vals, isEditing: false });
          }
          setProductOptions(optEntries);
        }
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          router.replace('/login');
          return;
        }
        setLoadError(err.message || 'Failed to load product.');
      } else {
        setLoadError('Failed to load product.');
      }
    } finally {
      setLoading(false);
    }
  }, [productId, populateForm, router]);

  const loadDuplicateInfo = useCallback(async () => {
    setDuplicateLoading(true);
    try {
      const res = await adminProductsService.getDuplicateInfo(productId);
      if (res.data) {
        setDuplicateProduct(res.data);
      }
    } catch {
      // Non-critical
    } finally {
      setDuplicateLoading(false);
    }
  }, [productId]);

  const handleMerge = async (targetId: string) => {
    if (!confirm('Are you sure you want to merge this product into the existing one? This will archive the current product and create seller mappings on the target product.')) return;
    setMerging(true);
    try {
      await adminProductsService.mergeProduct(productId, targetId);
      showToast('success', 'Product merged successfully. The seller has been mapped to the existing product.');
      await loadProduct();
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to merge products.');
    } finally {
      setMerging(false);
    }
  };

  useEffect(() => {
    if (product && (product as any).potentialDuplicateOf) {
      loadDuplicateInfo();
    }
  }, [product, loadDuplicateInfo]);

  useEffect(() => {
    async function loadData() {
      try {
        const [catRes, brandRes] = await Promise.all([
          adminProductsService.getCategories(),
          adminProductsService.getBrands(),
        ]);
        if (catRes.data) {
          const nodes = Array.isArray(catRes.data) ? catRes.data : (catRes.data as any).categories || [];
          setCategories(flattenCategories(nodes));
        }
        if (brandRes.data) {
          const brandList = Array.isArray(brandRes.data) ? brandRes.data : (brandRes.data as any).brands || [];
          setBrands(brandList);
        }
      } catch {
        // Non-critical
      }

      // Load predefined options
      adminProductsService.getOptions().then(res => {
        if (res.data) {
          const opts = Array.isArray(res.data) ? res.data : [];
          setPredefinedOptions(opts);
        }
      }).catch(() => {});
    }

    loadData();
    loadProduct();
  }, [loadProduct]);

  // Seller mappings state
  interface SellerMapping {
    id: string;
    seller: { id: string; sellerName: string; sellerShopName: string; sellerZipCode?: string } | null;
    variant: { id: string; masterSku: string; title: string; sku?: string } | null;
    stockQty: number;
    reservedQty: number;
    availableQty: number;
    sellerInternalSku: string | null;
    pickupPincode: string | null;
    dispatchSla: number;
    approvalStatus: string;
    isActive: boolean;
    mappingDisplayStatus: string;
    updatedAt: string;
  }
  const [sellerMappings, setSellerMappings] = useState<SellerMapping[]>([]);
  const [sellerMappingsLoading, setSellerMappingsLoading] = useState(false);
  const [mappingActionLoading, setMappingActionLoading] = useState<string | null>(null);

  function formatTimeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function getMappingStatusStyle(status: string) {
    switch (status) {
      case 'ACTIVE': return { background: '#dcfce7', color: '#15803d' };
      case 'INACTIVE': return { background: '#f3f4f6', color: '#6b7280' };
      case 'OUT_OF_STOCK': return { background: '#fee2e2', color: '#dc2626' };
      case 'LOW_STOCK': return { background: '#fef9c3', color: '#a16207' };
      default: return { background: '#f3f4f6', color: '#6b7280' };
    }
  }

  const loadSellerMappings = useCallback(async () => {
    setSellerMappingsLoading(true);
    try {
      const res = await adminProductsService.getSellerMappings(productId);
      if (res.data?.mappings) {
        setSellerMappings(res.data.mappings);
      }
    } catch {
      // Non-critical
    } finally {
      setSellerMappingsLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    if (productId) loadSellerMappings();
  }, [productId, loadSellerMappings]);

  const handleApproveMapping = async (mappingId: string) => {
    setMappingActionLoading(mappingId);
    try {
      await adminProductsService.approveMappings(mappingId);
      setSellerMappings(prev =>
        prev.map(m => m.id === mappingId ? { ...m, approvalStatus: 'APPROVED' } : m)
      );
      showToast('success', 'Mapping approved.');
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'Failed to approve mapping.');
    } finally {
      setMappingActionLoading(null);
    }
  };

  const handleStopMapping = async (mappingId: string) => {
    setMappingActionLoading(mappingId);
    try {
      await adminProductsService.stopMapping(mappingId);
      setSellerMappings(prev =>
        prev.map(m => m.id === mappingId ? { ...m, approvalStatus: 'STOPPED' } : m)
      );
      showToast('success', 'Mapping stopped.');
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'Failed to stop mapping.');
    } finally {
      setMappingActionLoading(null);
    }
  };

  function getApprovalBadgeStyle(status: string): React.CSSProperties {
    switch (status) {
      case 'APPROVED': return { background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' };
      case 'PENDING_APPROVAL': return { background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' };
      case 'STOPPED': return { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' };
      default: return { background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb' };
    }
  }

  function formatApprovalStatus(status: string): string {
    switch (status) {
      case 'APPROVED': return 'APPROVED';
      case 'PENDING_APPROVAL': return 'PENDING';
      case 'STOPPED': return 'STOPPED';
      default: return status.replace(/_/g, ' ');
    }
  }

  // ----- Computed -----

  // Admin-created products (sellerId === null) are read-only for content
  const isAdminCreated = product ? (product as any).sellerId === null : false;
  const isEditable = !!product && !isAdminCreated;

  // ----- Form helpers -----

  const updateField = useCallback(
    (field: string, value: string | boolean) => {
      setForm(prev => {
        const next = { ...prev, [field]: value };
        if (field === 'title' && !seoHandleEdited) {
          next.seoHandle = slugify(value as string);
        }
        return next;
      });
      setErrors(prev => {
        if (prev[field]) {
          const next = { ...prev };
          delete next[field];
          return next;
        }
        return prev;
      });
    },
    [seoHandleEdited],
  );

  const addTag = useCallback(() => {
    const tag = tagInput.trim();
    if (tag && !form.tags.includes(tag)) {
      setForm(prev => ({ ...prev, tags: [...prev.tags, tag] }));
    }
    setTagInput('');
  }, [tagInput, form.tags]);

  const removeTag = useCallback((tag: string) => {
    setForm(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tag) }));
  }, []);

  // ----- Validation -----

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.title.trim()) {
      errs.title = 'Title is required';
    }
    if (!form.hasVariants) {
      if (!form.basePrice || isNaN(Number(form.basePrice)) || Number(form.basePrice) <= 0) {
        errs.basePrice = 'Price is required and must be greater than 0';
      }
      // Stock is managed by sellers, not here
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ----- Build payload -----

  function buildPayload() {
    const payload: any = {
      title: form.title.trim(),
    };

    if (form.categoryId) payload.categoryId = form.categoryId;
    else if (form.categoryName?.trim()) payload.categoryName = form.categoryName.trim();
    if (form.brandId) payload.brandId = form.brandId;
    else if (form.brandName?.trim()) payload.brandName = form.brandName.trim();
    payload.shortDescription = form.shortDescription.trim();
    payload.description = form.description.trim();

    // Platform price applies to both simple and variant products
    if (form.platformPrice) payload.platformPrice = Number(form.platformPrice);
    else payload.platformPrice = null;

    if (!form.hasVariants) {
      if (form.basePrice) payload.basePrice = Number(form.basePrice);
      if (form.compareAtPrice) payload.compareAtPrice = Number(form.compareAtPrice);
      else payload.compareAtPrice = null;
      if (form.costPrice) payload.costPrice = Number(form.costPrice);
      else payload.costPrice = null;
      payload.baseSku = form.baseSku.trim() || null;
      if (form.baseStock !== '') payload.baseStock = Number(form.baseStock);
      payload.baseBarcode = form.baseBarcode.trim() || null;
    }

    if (form.weight) payload.weight = Number(form.weight);
    else payload.weight = null;
    payload.weightUnit = form.weightUnit;
    if (form.length) payload.length = Number(form.length);
    else payload.length = null;
    if (form.width) payload.width = Number(form.width);
    else payload.width = null;
    if (form.height) payload.height = Number(form.height);
    else payload.height = null;
    payload.dimensionUnit = form.dimensionUnit;

    payload.returnPolicy = form.returnPolicy.trim() || null;
    payload.warrantyInfo = form.warrantyInfo.trim() || null;

    payload.tags = form.tags;

    const seo: any = {};
    seo.metaTitle = form.seoMetaTitle.trim() || null;
    seo.metaDescription = form.seoMetaDescription.trim() || null;
    seo.handle = form.seoHandle.trim() || null;
    payload.seo = seo;

    return payload;
  }

  // ----- Save handler -----

  async function handleSave() {
    if (!validate()) {
      showToast('error', 'Please fix the errors before saving.');
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayload();
      await adminProductsService.updateProduct(productId, payload);
      showToast('success', 'Product updated successfully.');

      // Always do a full reload to get complete data including variant images
      await loadProduct();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          router.replace('/login');
          return;
        }
        showToast('error', err.message || 'Failed to update product.');
        if (err.body.errors) {
          const fieldErrors: Record<string, string> = {};
          for (const e of err.body.errors) {
            fieldErrors[e.field] = e.message;
          }
          setErrors(prev => ({ ...prev, ...fieldErrors }));
        }
      } else {
        showToast('error', 'An unexpected error occurred.');
      }
    } finally {
      setSaving(false);
    }
  }

  // ----- Moderation actions -----

  const handleApprove = async () => {
    try {
      await adminProductsService.approveProduct(productId);
      showToast('success', 'Product approved successfully.');
      await loadProduct();
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'Failed to approve product');
    }
  };

  const handleStatusChange = async () => {
    if (!statusAction) return;
    setStatusChanging(true);
    try {
      await adminProductsService.updateStatus(productId, statusAction);
      showToast('success', `Product status updated to ${statusAction}.`);
      setStatusAction('');
      await loadProduct();
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'Failed to update status');
    } finally {
      setStatusChanging(false);
    }
  };

  const onModalSuccess = () => {
    setActiveModal(null);
    showToast('success', 'Action completed successfully.');
    loadProduct();
  };

  // ===== Variant Options Management =====

  function addOption() {
    setProductOptions(prev => [...prev, { name: '', values: [''], isEditing: true }]);
  }

  function removeOption(index: number) {
    setProductOptions(prev => prev.filter((_, i) => i !== index));
  }

  function updateOptionName(index: number, name: string) {
    setProductOptions(prev => prev.map((opt, i) => i === index ? { ...opt, name } : opt));
  }

  function addOptionValue(index: number) {
    setProductOptions(prev => prev.map((opt, i) =>
      i === index ? { ...opt, values: [...opt.values, ''] } : opt
    ));
  }

  function updateOptionValue(optIndex: number, valIndex: number, value: string) {
    setProductOptions(prev => prev.map((opt, i) => {
      if (i !== optIndex) return opt;
      const newValues = [...opt.values];
      if (valIndex >= newValues.length) {
        newValues.push(value);
      } else {
        newValues[valIndex] = value;
      }
      return { ...opt, values: newValues };
    }));
  }

  function removeOptionValue(optIndex: number, valIndex: number) {
    setProductOptions(prev => prev.map((opt, i) =>
      i === optIndex ? { ...opt, values: opt.values.filter((_, j) => j !== valIndex) } : opt
    ));
  }

  function toggleOptionEdit(index: number) {
    setProductOptions(prev => prev.map((opt, i) =>
      i === index ? { ...opt, isEditing: !opt.isEditing } : opt
    ));
  }

  async function handleGenerateVariants() {
    const validOptions = productOptions
      .filter(opt => opt.name.trim() && opt.values.some(v => v.trim()))
      .map(opt => ({
        name: opt.name.trim(),
        values: opt.values.filter(v => v.trim()),
      }));

    if (validOptions.length === 0) {
      showToast('error', 'Add at least one option with values before generating variants.');
      return;
    }

    if (product && product.variants.length > 0) {
      if (!confirm('This will replace all existing variants. Continue?')) return;
    }

    setGeneratingVariants(true);
    try {
      await adminProductsService.generateManualVariants(productId, validOptions);
      showToast('success', 'Variants generated successfully.');
      setProductOptions(prev => prev.map(opt => ({ ...opt, isEditing: false })));
      await loadProduct();
    } catch (err) {
      if (err instanceof ApiError) {
        showToast('error', err.message || 'Failed to generate variants.');
      } else {
        showToast('error', 'Failed to generate variants.');
      }
    } finally {
      setGeneratingVariants(false);
    }
  }

  async function deleteVariant(variantId: string) {
    if (!confirm('Are you sure you want to delete this variant?')) return;

    try {
      await adminProductsService.deleteVariant(productId, variantId);
      showToast('success', 'Variant deleted.');
      await loadProduct();
    } catch (err) {
      if (err instanceof ApiError) {
        showToast('error', err.message || 'Failed to delete variant.');
      } else {
        showToast('error', 'Failed to delete variant.');
      }
    }
  }

  // ===== Image Management =====

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const validFiles: File[] = [];
    for (let i = 0; i < files.length; i++) {
      if (files[i].size > 5 * 1024 * 1024) {
        showToast('error', `"${files[i].name}" exceeds 5MB and was skipped.`);
      } else {
        validFiles.push(files[i]);
      }
    }

    if (validFiles.length === 0) return;

    setUploadingImage(true);
    let uploaded = 0;
    let failed = 0;

    for (const file of validFiles) {
      try {
        await adminProductsService.uploadImage(productId, file);
        uploaded++;
      } catch {
        failed++;
      }
    }

    if (failed > 0) {
      showToast('error', `${uploaded} image(s) uploaded, ${failed} failed.`);
    } else {
      showToast('success', `${uploaded} image(s) uploaded successfully.`);
    }

    await loadProduct();
    setUploadingImage(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleDeleteImage(imageId: string) {
    if (!confirm('Delete this image?')) return;

    try {
      await adminProductsService.deleteImage(productId, imageId);
      showToast('success', 'Image deleted.');
      await loadProduct();
    } catch (err) {
      if (err instanceof ApiError) {
        showToast('error', err.message || 'Failed to delete image.');
      } else {
        showToast('error', 'Failed to delete image.');
      }
    }
  }

  async function handleSetPrimary(imageId: string) {
    if (!product) return;
    const currentImages = [...product.images].sort((a: any, b: any) => a.sortOrder - b.sortOrder);
    const targetImage = currentImages.find((img: any) => img.id === imageId);
    if (!targetImage) return;
    const otherImages = currentImages.filter((img: any) => img.id !== imageId);
    const newOrder = [targetImage, ...otherImages].map((img: any) => img.id);

    try {
      await adminProductsService.reorderImages(productId, newOrder);
      showToast('success', 'Primary image updated.');
      await loadProduct();
    } catch (err) {
      if (err instanceof ApiError) {
        showToast('error', err.message || 'Failed to reorder images.');
      } else {
        showToast('error', 'Failed to reorder images.');
      }
    }
  }

  async function handleMoveImage(imageId: string, direction: 'up' | 'down') {
    if (!product) return;
    const sorted = [...product.images].sort((a: any, b: any) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex((img: any) => img.id === imageId);
    if (idx === -1) return;

    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= sorted.length) return;

    const newArr = [...sorted];
    [newArr[idx], newArr[newIdx]] = [newArr[newIdx], newArr[idx]];
    const newOrder = newArr.map((img: any) => img.id);

    try {
      await adminProductsService.reorderImages(productId, newOrder);
      await loadProduct();
    } catch (err) {
      if (err instanceof ApiError) {
        showToast('error', err.message || 'Failed to reorder images.');
      } else {
        showToast('error', 'Failed to reorder images.');
      }
    }
  }

  // ----- Status banner -----

  function renderStatusBanner() {
    if (!product) return null;
    const productStatus = product.status;
    const moderation = product.moderationStatus;

    // Product status takes priority
    if (productStatus === 'DRAFT') {
      return (
        <div className="status-banner" style={{ background: '#f3f4f6', border: '1px solid #d1d5db', color: '#374151' }}>
          This product is a draft and not visible on the storefront.
        </div>
      );
    }
    if (productStatus === 'ACTIVE') {
      return (
        <div className="status-banner active">
          This product is live on the storefront.
        </div>
      );
    }
    if (productStatus === 'SUSPENDED') {
      return (
        <div className="status-banner" style={{ background: '#fef3c7', border: '1px solid #f59e0b', color: '#92400e' }}>
          This product is suspended.
        </div>
      );
    }

    // Moderation status for seller-submitted products
    if (moderation === 'REJECTED') {
      return (
        <div className="status-banner rejected">
          <strong>Rejected</strong>
          {product.moderationNote && <> &mdash; {product.moderationNote}</>}
        </div>
      );
    }
    if (moderation === 'CHANGES_REQUESTED') {
      return (
        <div className="status-banner changes-requested">
          <strong>Changes Requested</strong>
          {product.moderationNote && <> &mdash; {product.moderationNote}</>}
        </div>
      );
    }
    if (moderation === 'SUBMITTED' || moderation === 'IN_REVIEW' || productStatus === 'SUBMITTED') {
      return (
        <div className="status-banner submitted">
          This product is pending review.
        </div>
      );
    }
    return null;
  }

  // ----- Loading / Error states -----

  if (loading) {
    return <div className="form-loading">Loading product...</div>;
  }

  if (loadError) {
    return (
      <div className="product-form-page">
        <div className="product-form-header">
          <div>
            <Link href="/dashboard/products" className="product-form-back">
              &larr; Back to Products
            </Link>
            <h1>Edit Product</h1>
          </div>
        </div>
        <div className="form-card">
          <p style={{ color: 'var(--color-error)', fontSize: 14 }}>{loadError}</p>
        </div>
      </div>
    );
  }

  if (!product) return null;

  const sortedImages = [...product.images].sort((a: any, b: any) => a.sortOrder - b.sortOrder);
  const sortedVariants = [...product.variants];
  const isSubmitted = product.moderationStatus === 'SUBMITTED' || product.moderationStatus === 'IN_REVIEW';

  // ----- Render -----

  return (
    <div className="product-form-page">
      {/* Toast */}
      {toast && (
        <div className={`toast ${toast.type}`}>{toast.message}</div>
      )}

      {/* Header */}
      <div className="product-form-header">
        <div>
          <Link href="/dashboard/products" className="product-form-back">
            &larr; Back to Products
          </Link>
          <h1>Edit Product (Admin)</h1>
        </div>
      </div>

      {/* Status Banner */}
      {renderStatusBanner()}

      {/* Read-only banner for admin-created products */}
      {isAdminCreated && (
        <div style={{
          padding: '14px 20px',
          background: '#eff6ff',
          border: '1px solid #bfdbfe',
          borderRadius: 10,
          marginBottom: 16,
          fontSize: 14,
          color: '#1e40af',
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>&#128274;</span>
          This product was created by the Storefront Admin. Product content is read-only.
        </div>
      )}

      {/* Seller info (readonly) */}
      {product.seller && (
        <div className="info-box" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <strong>Seller:</strong>
          <span>
            {product.seller.sellerName} ({product.seller.sellerShopName}) &mdash; {product.seller.email}
          </span>
        </div>
      )}

      {/* Approval Actions (only for SUBMITTED / IN_REVIEW products) */}
      {isSubmitted && (
        <div className="form-card" style={{ marginBottom: 16 }}>
          <div className="form-card-title">APPROVAL</div>
          <p style={{ fontSize: 14, marginBottom: 12, color: '#374151' }}>
            This product is awaiting approval. Take an action:
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className="form-btn primary"
              style={{ background: '#16a34a' }}
              onClick={handleApprove}
            >
              Approve
            </button>
            <button
              type="button"
              className="form-btn"
              style={{ background: '#dc2626', color: '#fff', border: 'none' }}
              onClick={() => setActiveModal('reject')}
            >
              Reject
            </button>
            <button
              type="button"
              className="form-btn"
              style={{ background: '#f59e0b', color: '#fff', border: 'none' }}
              onClick={() => setActiveModal('requestChanges')}
            >
              Request Changes
            </button>
          </div>
        </div>
      )}

      {/* Duplicate Warning Card */}
      {(product as any).potentialDuplicateOf && duplicateProduct && (
        <div className="form-card" style={{ marginBottom: 16, border: '2px solid #f59e0b', background: '#fffbeb' }}>
          <div className="form-card-title" style={{ color: '#92400e' }}>
            &#9888; DUPLICATE WARNING
          </div>
          <p style={{ fontSize: 14, marginBottom: 16, color: '#78350f' }}>
            This product may be a duplicate of an existing product in the catalog. Review the comparison below.
          </p>

          {duplicateLoading ? (
            <p style={{ fontSize: 13, color: '#92400e' }}>Loading duplicate details...</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 16 }}>
              {/* Submitted product */}
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: '#fff' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' as const, marginBottom: 8 }}>
                  Submitted Product
                </div>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>{product.title}</div>
                <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>
                  Brand: {(product as any).brand?.name || 'N/A'}
                </div>
                <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
                  Category: {(product as any).category?.name || 'N/A'}
                </div>
                {product.images && product.images.length > 0 && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {product.images.slice(0, 3).map((img: any) => (
                      <img
                        key={img.id}
                        src={img.url}
                        alt={product.title}
                        style={{ width: 60, height: 60, objectFit: 'cover' as const, borderRadius: 6, border: '1px solid #e5e7eb' }}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Existing product */}
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: '#fff' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' as const, marginBottom: 8 }}>
                  Existing Product
                </div>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>{duplicateProduct.title}</div>
                <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>
                  Brand: {duplicateProduct.brandName || 'N/A'}
                </div>
                <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>
                  Category: {duplicateProduct.categoryName || 'N/A'}
                </div>
                <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
                  Status: {duplicateProduct.status} | Code: {duplicateProduct.productCode || 'N/A'}
                </div>
                {duplicateProduct.images && duplicateProduct.images.length > 0 && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {duplicateProduct.images.slice(0, 3).map((img: any) => (
                      <img
                        key={img.id}
                        src={img.url}
                        alt={duplicateProduct.title}
                        style={{ width: 60, height: 60, objectFit: 'cover' as const, borderRadius: 6, border: '1px solid #e5e7eb' }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className="form-btn primary"
              style={{ background: '#16a34a' }}
              onClick={handleApprove}
            >
              Approve as New Product
            </button>
            <button
              type="button"
              className="form-btn"
              style={{ background: '#2563eb', color: '#fff', border: 'none' }}
              onClick={() => handleMerge(duplicateProduct.id)}
              disabled={merging}
            >
              {merging ? 'Merging...' : 'Merge into Existing'}
            </button>
            <button
              type="button"
              className="form-btn"
              style={{ background: '#dc2626', color: '#fff', border: 'none' }}
              onClick={() => setActiveModal('reject')}
            >
              Reject as Duplicate
            </button>
          </div>
        </div>
      )}

      {/* Section 1: Basic Info */}
      <div className="form-card">
        <div className="form-card-title">BASIC INFORMATION</div>
        <div className="form-grid">
          <div className="form-group full-width">
            <label className="form-label">
              Title <span className="required">*</span>
            </label>
            <input
              type="text"
              className="form-input"
              value={form.title}
              onChange={e => updateField('title', e.target.value)}
              placeholder="Product title"
              maxLength={200}
              disabled={!isEditable}
            />
            {errors.title && <span className="form-error">{errors.title}</span>}
          </div>

          <div className="form-group">
            <label className="form-label">Category</label>
            <input
              type="text"
              className="form-input"
              list="category-list"
              value={form.categoryName}
              onChange={e => {
                const typed = e.target.value;
                const match = categories.find(c => c.name.toLowerCase() === typed.toLowerCase());
                if (match) {
                  setForm(prev => ({ ...prev, categoryId: match.id, categoryName: match.name }));
                } else {
                  setForm(prev => ({ ...prev, categoryId: '', categoryName: typed }));
                }
              }}
              placeholder="Type or select category"
              disabled={!isEditable}
            />
            <datalist id="category-list">
              {categories.map(cat => (
                <option key={cat.id} value={cat.name} />
              ))}
            </datalist>
            <span className="form-hint">Type a new category or select from existing</span>
          </div>

          <div className="form-group">
            <label className="form-label">Brand</label>
            <input
              type="text"
              className="form-input"
              list="brand-list"
              value={form.brandName}
              onChange={e => {
                const typed = e.target.value;
                const match = brands.find(b => b.name.toLowerCase() === typed.toLowerCase());
                if (match) {
                  setForm(prev => ({ ...prev, brandId: match.id, brandName: match.name }));
                } else {
                  setForm(prev => ({ ...prev, brandId: '', brandName: typed }));
                }
              }}
              placeholder="Type or select brand"
              disabled={!isEditable}
            />
            <datalist id="brand-list">
              {brands.map(b => (
                <option key={b.id} value={b.name} />
              ))}
            </datalist>
            <span className="form-hint">Type a new brand or select from existing</span>
          </div>

          <div className="form-group full-width">
            <label className="form-label">Short Description</label>
            <textarea
              className="form-textarea"
              value={form.shortDescription}
              onChange={e => updateField('shortDescription', e.target.value)}
              placeholder="Brief description (shown in product cards)"
              maxLength={300}
              disabled={!isEditable}
            />
            <span className="form-hint">{form.shortDescription.length}/300</span>
          </div>

          <div className="form-group full-width">
            <label className="form-label">Description</label>
            <RichTextEditor
              value={form.description}
              onChange={(val) => updateField('description', val)}
              placeholder="Full product description"
              minHeight={200}
            />
          </div>
        </div>
      </div>

      {/* Section 2: Product Type & Pricing */}
      <div className="form-card">
        <div className="form-card-title">PRODUCT TYPE &amp; PRICING</div>

        <div className="form-checkbox-group">
          <input
            type="checkbox"
            id="hasVariants"
            checked={form.hasVariants}
            disabled
          />
          <label htmlFor="hasVariants">This product has variants</label>
          <span className="form-hint" style={{ marginLeft: 8 }}>
            {form.hasVariants
              ? '(auto-enabled when variants are generated)'
              : '(generate variants below to enable)'}
          </span>
        </div>

        {form.hasVariants ? (
          <div className="info-box">
            Stock and SKU are managed by sellers. Prices for variants can be set on each variant&apos;s detail page.
          </div>
        ) : (
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Price</label>
              <div className="input-with-prefix">
                <span className="input-prefix">&#8377;</span>
                <input
                  type="number"
                  className="form-input"
                  value={form.platformPrice || form.basePrice}
                  onChange={e => { updateField('platformPrice', e.target.value); updateField('basePrice', e.target.value); }}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  disabled={!isEditable}
                />
              </div>
              <span className="form-hint">The selling price shown to customers</span>
            </div>

            <div className="form-group">
              <label className="form-label">Compare at Price</label>
              <div className="input-with-prefix">
                <span className="input-prefix">&#8377;</span>
                <input
                  type="number"
                  className="form-input"
                  value={form.compareAtPrice}
                  onChange={e => updateField('compareAtPrice', e.target.value)}
                  placeholder=""
                  min="0"
                  step="0.01"
                  disabled={!isEditable}
                />
              </div>
              <span className="form-hint">Original price (shown as strikethrough). Leave empty if not applicable.</span>
            </div>

            <div className="form-group">
              <label className="form-label">Barcode</label>
              <input
                type="text"
                className="form-input"
                value={form.baseBarcode}
                onChange={e => updateField('baseBarcode', e.target.value)}
                placeholder="UPC, EAN, ISBN, etc."
                disabled={!isEditable}
              />
            </div>
          </div>
        )}
      </div>

      {/* Shipping */}
      <div className="form-card">
        <div className="form-card-title">SHIPPING</div>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Weight</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="number"
                className="form-input"
                style={{ flex: 1 }}
                value={form.weight}
                onChange={e => updateField('weight', e.target.value)}
                placeholder="0"
                min="0"
                step="0.01"
                disabled={!isEditable}
              />
              <select
                className="form-select"
                value={form.weightUnit}
                onChange={e => updateField('weightUnit', e.target.value)}
                style={{ width: 80 }}
                disabled={!isEditable}
              >
                <option value="kg">kg</option>
                <option value="g">g</option>
                <option value="lb">lb</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Dimensions (L x W x H)</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="number"
                className="form-input"
                style={{ flex: 1 }}
                value={form.length}
                onChange={e => updateField('length', e.target.value)}
                placeholder="L"
                min="0"
                step="0.1"
                disabled={!isEditable}
              />
              <span style={{ color: 'var(--color-text-secondary)' }}>&times;</span>
              <input
                type="number"
                className="form-input"
                style={{ flex: 1 }}
                value={form.width}
                onChange={e => updateField('width', e.target.value)}
                placeholder="W"
                min="0"
                step="0.1"
                disabled={!isEditable}
              />
              <span style={{ color: 'var(--color-text-secondary)' }}>&times;</span>
              <input
                type="number"
                className="form-input"
                style={{ flex: 1 }}
                value={form.height}
                onChange={e => updateField('height', e.target.value)}
                placeholder="H"
                min="0"
                step="0.1"
                disabled={!isEditable}
              />
              <select
                className="form-select"
                value={form.dimensionUnit}
                onChange={e => updateField('dimensionUnit', e.target.value)}
                style={{ width: 80 }}
                disabled={!isEditable}
              >
                <option value="cm">cm</option>
                <option value="in">in</option>
                <option value="m">m</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Variants Section */}
      <div className="form-card">
        <div className="form-card-title">VARIANTS</div>

        {/* Options Editor */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: '#374151' }}>Options</div>

          {productOptions.map((opt, optIdx) => {
            // Find the matching predefined option for this entry
            const matchedPredefined = predefinedOptions.find(
              po => po.name.toLowerCase() === opt.name.toLowerCase() || po.displayName.toLowerCase() === opt.name.toLowerCase()
            );
            // Get predefined values not already selected
            const availablePredefinedValues = matchedPredefined
              ? matchedPredefined.values.filter(pv => !opt.values.includes(pv.displayValue))
              : [];
            // Options already used in other entries
            const usedOptionNames = productOptions.filter((_, i) => i !== optIdx).map(o => o.name.toLowerCase());

            return (
            <div key={optIdx} className="option-card">
              {opt.isEditing ? (
                /* Editing mode */
                <div className="option-card-editing">
                  <div className="option-card-edit-header">
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label className="form-label">Option name</label>
                      <select
                        className="form-input"
                        value={predefinedOptions.some(po => po.name.toLowerCase() === opt.name.toLowerCase() || po.displayName.toLowerCase() === opt.name.toLowerCase()) ? opt.name : '__custom__'}
                        onChange={e => {
                          const val = e.target.value;
                          if (val === '__custom__') {
                            updateOptionName(optIdx, '');
                          } else {
                            updateOptionName(optIdx, val);
                          }
                        }}
                      >
                        <option value="" disabled>Select an option</option>
                        {predefinedOptions
                          .filter(po => !usedOptionNames.includes(po.name.toLowerCase()))
                          .map(po => (
                            <option key={po.id} value={po.displayName}>{po.displayName}</option>
                          ))}
                        <option value="__custom__">+ Custom option</option>
                      </select>
                      {!predefinedOptions.some(po => po.name.toLowerCase() === opt.name.toLowerCase() || po.displayName.toLowerCase() === opt.name.toLowerCase()) && (
                        <input
                          type="text"
                          className="form-input"
                          style={{ marginTop: 8 }}
                          value={opt.name}
                          onChange={e => updateOptionName(optIdx, e.target.value)}
                          placeholder="Enter custom option name"
                          autoFocus
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      className="option-delete-btn"
                      onClick={() => removeOption(optIdx)}
                      title="Delete option"
                    >
                      &#128465;
                    </button>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <label className="form-label">Option values</label>
                    {opt.values.map((val, valIdx) => (
                      <div key={valIdx} className="option-value-row">
                        <input
                          type="text"
                          className="form-input"
                          value={val}
                          onChange={e => updateOptionValue(optIdx, valIdx, e.target.value)}
                          placeholder="Enter value"
                        />
                        <button
                          type="button"
                          className="option-delete-btn"
                          onClick={() => removeOptionValue(optIdx, valIdx)}
                          title="Remove value"
                        >
                          &#128465;
                        </button>
                      </div>
                    ))}

                    {/* Dropdown to add predefined values */}
                    {availablePredefinedValues.length > 0 && (
                      <select
                        className="form-input"
                        style={{ marginTop: 8 }}
                        value=""
                        onChange={e => {
                          const selected = e.target.value;
                          if (selected) {
                            const lastIdx = opt.values.length - 1;
                            if (lastIdx >= 0 && opt.values[lastIdx].trim() === '') {
                              updateOptionValue(optIdx, lastIdx, selected);
                            } else {
                              updateOptionValue(optIdx, opt.values.length, selected);
                            }
                          }
                        }}
                      >
                        <option value="">Add from predefined values...</option>
                        {availablePredefinedValues.map(pv => (
                          <option key={pv.id} value={pv.displayValue}>{pv.displayValue}</option>
                        ))}
                      </select>
                    )}

                    <button
                      type="button"
                      className="add-option-btn"
                      style={{ marginTop: 8 }}
                      onClick={() => addOptionValue(optIdx)}
                    >
                      + Add custom value
                    </button>
                  </div>

                  <button
                    type="button"
                    className="form-btn primary"
                    style={{ marginTop: 12, padding: '6px 20px', fontSize: 13 }}
                    onClick={() => toggleOptionEdit(optIdx)}
                  >
                    Done
                  </button>
                </div>
              ) : (
                /* Collapsed mode */
                <div className="option-card-collapsed">
                  <div className="option-card-info">
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{opt.name || 'Unnamed option'}</div>
                    <div className="option-chips">
                      {opt.values.filter(v => v.trim()).map((val, i) => (
                        <span key={i} className="option-chip">{val}</span>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="form-btn"
                    style={{ padding: '4px 16px', fontSize: 13 }}
                    onClick={() => toggleOptionEdit(optIdx)}
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>
          );
          })}

          <button
            type="button"
            className="add-option-btn"
            onClick={addOption}
          >
            + Add another option
          </button>
        </div>

        {/* Generate button */}
        {productOptions.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <button
              type="button"
              className="form-btn primary"
              onClick={handleGenerateVariants}
              disabled={generatingVariants}
            >
              {generatingVariants ? 'Generating...' : 'Generate Variants'}
            </button>
            {sortedVariants.length > 0 && (
              <span className="form-hint" style={{ marginLeft: 12 }}>
                This will replace existing {sortedVariants.length} variant(s)
              </span>
            )}
          </div>
        )}

        {/* Variants Table */}
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: '#374151' }}>
          Variants ({sortedVariants.length})
        </div>

        {sortedVariants.length === 0 ? (
          <div className="info-box">
            No variants yet. Define options above and click &quot;Generate Variants&quot; to create them.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="variant-table-rich">
              <thead>
                <tr>
                  <th>Image</th>
                  <th>Option Values</th>
                  <th>Weight</th>
                  <th>SKU</th>
                  <th>Price</th>
                  <th>Quantity</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedVariants.map((variant: any) => {
                  const ovs = (variant.optionValues || []).map((ov: any) => {
                    if (ov.optionValue) return { value: ov.optionValue.value, displayValue: ov.optionValue.displayValue, optionName: ov.optionValue.optionDefinition?.name };
                    return ov;
                  });
                  const variantLabel = ovs.map((ov: any) => ov.displayValue || ov.value).join(' / ') || variant.title || 'Unnamed';
                  const variantImg = (variant.images && variant.images.length > 0) ? variant.images[0].url : (product.images.length > 0 ? product.images[0].url : null);
                  const weightDisplay = variant.weight ? `${variant.weight}${variant.weightUnit || 'g'}` : '\u2014';

                  return (
                    <tr key={variant.id}>
                      <td>
                        {variantImg ? (
                          <img src={variantImg} alt="" className="variant-table-thumb" />
                        ) : (
                          <div className="variant-table-thumb-placeholder">?</div>
                        )}
                      </td>
                      <td style={{ fontWeight: 500, fontSize: 13 }}>{variantLabel}</td>
                      <td style={{ fontSize: 13, color: variant.weight ? 'var(--color-text)' : '#9ca3af' }}>{weightDisplay}</td>
                      <td style={{ fontSize: 13, color: variant.sku ? 'var(--color-text)' : '#9ca3af' }}>{variant.sku || '\u2014'}</td>
                      <td style={{ fontSize: 13, fontWeight: 500 }}>&#8377; {variant.price}</td>
                      <td style={{ fontSize: 13 }}>{variant.stock}</td>
                      <td>
                        <div className="variant-table-actions">
                          <Link href={`/dashboard/products/${productId}/variants/${variant.id}`}>Edit</Link>
                          <button className="danger" onClick={() => deleteVariant(variant.id)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Images Section */}
      <div className="form-card">
        <div className="form-card-title">IMAGES</div>

        {isEditable && (
          <div
            className="image-upload-area"
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageUpload}
              style={{ display: 'none' }}
            />
            <p>{uploadingImage ? 'Uploading...' : 'Click to upload images'}</p>
            <p className="upload-hint">Select one or more images. Max 5MB each. JPG, PNG, or WebP.</p>
          </div>
        )}

        {sortedImages.length > 0 ? (
          <div className="image-grid">
            {sortedImages.map((img: any, idx: number) => (
              <div key={img.id}>
                <div className={`image-card${img.isPrimary ? ' primary' : ''}`}>
                  <img src={img.url} alt={img.altText || 'Product image'} />
                  {img.isPrimary && (
                    <div className="image-primary-badge">Primary</div>
                  )}
                  {isEditable && (
                    <div className="image-card-actions">
                      {!img.isPrimary && (
                        <button
                          className="primary-btn"
                          onClick={() => handleSetPrimary(img.id)}
                          title="Set as primary"
                        >
                          &#9733;
                        </button>
                      )}
                      <button
                        className="delete-btn"
                        onClick={() => handleDeleteImage(img.id)}
                        title="Delete image"
                      >
                        &times;
                      </button>
                    </div>
                  )}
                </div>
                {isEditable && sortedImages.length > 1 && (
                  <div className="image-move-buttons">
                    <button
                      disabled={idx === 0}
                      onClick={() => handleMoveImage(img.id, 'up')}
                      title="Move left"
                    >
                      &larr;
                    </button>
                    <button
                      disabled={idx === sortedImages.length - 1}
                      onClick={() => handleMoveImage(img.id, 'down')}
                      title="Move right"
                    >
                      &rarr;
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>No images uploaded yet.</p>
        )}
      </div>

      {/* Tags */}
      <div className="form-card">
        <div className="form-card-title">TAGS</div>
        {isEditable && (
          <div className="tags-input-group">
            <input
              type="text"
              className="form-input"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTag();
                }
              }}
              placeholder="Add a tag"
            />
            <button type="button" onClick={addTag}>Add</button>
          </div>
        )}
        {form.tags.length > 0 ? (
          <div className="tags-list">
            {form.tags.map(tag => (
              <span key={tag} className="tag-chip">
                {tag}
                {isEditable && (
                  <button type="button" onClick={() => removeTag(tag)}>&times;</button>
                )}
              </span>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>No tags added.</p>
        )}
      </div>

      {/* SEO */}
      <div className="form-card">
        <div className="form-card-title">SEO (SEARCH ENGINE OPTIMIZATION)</div>
        <div className="form-grid">
          <div className="form-group full-width">
            <label className="form-label">Handle (URL slug)</label>
            <input
              type="text"
              className="form-input"
              value={form.seoHandle}
              onChange={e => {
                setSeoHandleEdited(true);
                updateField('seoHandle', e.target.value);
              }}
              placeholder="product-url-slug"
              disabled={!isEditable}
            />
          </div>

          <div className="form-group full-width">
            <label className="form-label">Meta Title</label>
            <input
              type="text"
              className="form-input"
              value={form.seoMetaTitle}
              onChange={e => updateField('seoMetaTitle', e.target.value)}
              placeholder="SEO meta title"
              maxLength={70}
              disabled={!isEditable}
            />
          </div>

          <div className="form-group full-width">
            <label className="form-label">Meta Description</label>
            <textarea
              className="form-textarea"
              value={form.seoMetaDescription}
              onChange={e => updateField('seoMetaDescription', e.target.value)}
              placeholder="SEO meta description"
              maxLength={160}
              disabled={!isEditable}
            />
            <span className="form-hint">{form.seoMetaDescription.length}/160</span>
          </div>
        </div>
      </div>

      {/* Policies */}
      <div className="form-card">
        <div className="form-card-title">POLICIES</div>
        <div className="form-grid">
          <div className="form-group full-width">
            <label className="form-label">Return Policy</label>
            <textarea
              className="form-textarea"
              value={form.returnPolicy}
              onChange={e => updateField('returnPolicy', e.target.value)}
              placeholder="Describe your return policy"
              disabled={!isEditable}
            />
          </div>

          <div className="form-group full-width">
            <label className="form-label">Warranty Info</label>
            <textarea
              className="form-textarea"
              value={form.warrantyInfo}
              onChange={e => updateField('warrantyInfo', e.target.value)}
              placeholder="Describe warranty coverage"
              disabled={!isEditable}
            />
          </div>
        </div>
      </div>

      {/* Seller Mappings */}
      <div className="form-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div className="form-card-title" style={{ marginBottom: 0 }}>
            SELLER MAPPINGS
            {sellerMappings.length > 0 && (
              <span style={{ fontWeight: 400, fontSize: 13, color: '#6b7280', marginLeft: 8 }}>
                ({sellerMappings.length} seller{sellerMappings.length !== 1 ? 's' : ''})
              </span>
            )}
          </div>
          <button
            type="button"
            className="form-btn"
            style={{ padding: '4px 14px', fontSize: 12, fontWeight: 500 }}
            onClick={loadSellerMappings}
            disabled={sellerMappingsLoading}
          >
            {sellerMappingsLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {sellerMappingsLoading && sellerMappings.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', padding: '16px 0' }}>Loading seller mappings...</p>
        ) : sellerMappings.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', padding: '16px 0' }}>No sellers mapped to this product yet.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--color-border, #e3e3e3)' }}>
                    <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>Seller</th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>Internal SKU</th>
                    <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>Stock</th>
                    <th style={{ textAlign: 'center', padding: '8px 10px', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>Approval Status</th>
                    <th style={{ textAlign: 'center', padding: '8px 10px', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sellerMappings.map((m) => (
                    <tr key={m.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 500 }}>
                        {m.seller?.sellerName || 'Unknown'}
                        {m.variant && (
                          <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace' }}>
                            {m.variant.title || m.variant.masterSku}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '8px 10px', color: (m.sellerInternalSku || m.variant?.sku) ? '#374151' : '#9ca3af', fontFamily: (m.sellerInternalSku || m.variant?.sku) ? 'monospace' : 'inherit', fontSize: 12 }}>
                        {m.sellerInternalSku || m.variant?.sku || '\u2014'}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 500 }}>{m.stockQty}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 10px',
                          borderRadius: 12,
                          fontSize: 11,
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                          ...getApprovalBadgeStyle(m.approvalStatus),
                        }}>
                          {formatApprovalStatus(m.approvalStatus)}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                          {(m.approvalStatus === 'PENDING_APPROVAL' || m.approvalStatus === 'STOPPED') && (
                            <button
                              type="button"
                              onClick={() => handleApproveMapping(m.id)}
                              disabled={mappingActionLoading === m.id}
                              style={{
                                padding: '4px 12px',
                                fontSize: 11,
                                fontWeight: 600,
                                border: 'none',
                                borderRadius: 6,
                                cursor: 'pointer',
                                background: '#16a34a',
                                color: '#fff',
                                opacity: mappingActionLoading === m.id ? 0.6 : 1,
                              }}
                            >
                              Approve
                            </button>
                          )}
                          {(m.approvalStatus === 'PENDING_APPROVAL' || m.approvalStatus === 'APPROVED') && (
                            <button
                              type="button"
                              onClick={() => handleStopMapping(m.id)}
                              disabled={mappingActionLoading === m.id}
                              style={{
                                padding: '4px 12px',
                                fontSize: 11,
                                fontWeight: 600,
                                border: 'none',
                                borderRadius: 6,
                                cursor: 'pointer',
                                background: '#dc2626',
                                color: '#fff',
                                opacity: mappingActionLoading === m.id ? 0.6 : 1,
                              }}
                            >
                              Stop
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 12, padding: '10px 0 0', borderTop: '1px solid #f3f4f6', fontSize: 13, color: '#6b7280', display: 'flex', gap: 16 }}>
              <span>Approved stock: <strong style={{ color: '#374151' }}>
                {sellerMappings.filter(m => m.approvalStatus === 'APPROVED').reduce((s, m) => s + m.stockQty, 0).toLocaleString()}
              </strong></span>
              <span>Total stock (all): <strong style={{ color: '#374151' }}>
                {sellerMappings.reduce((s, m) => s + m.stockQty, 0).toLocaleString()}
              </strong></span>
            </div>
          </>
        )}
      </div>

      {/* Status Change (admin-only for ACTIVE/SUSPENDED/APPROVED) */}
      {(product.status === 'ACTIVE' || product.status === 'SUSPENDED' || product.status === 'APPROVED') && (
        <div className="form-card">
          <div className="form-card-title">STATUS CHANGE</div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Change Status</label>
              <select
                className="form-select"
                value={statusAction}
                onChange={e => setStatusAction(e.target.value)}
              >
                <option value="">Select new status</option>
                {product.status !== 'ACTIVE' && <option value="ACTIVE">Active</option>}
                {product.status !== 'SUSPENDED' && <option value="SUSPENDED">Suspended</option>}
                {(product.status as string) !== 'ARCHIVED' && <option value="ARCHIVED">Archived</option>}
              </select>
            </div>
            <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button
                type="button"
                className="form-btn primary"
                onClick={handleStatusChange}
                disabled={!statusAction || statusChanging}
              >
                {statusChanging ? 'Updating...' : 'Update Status'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons (sticky footer) */}
      {isEditable && (
        <div className="form-actions">
          <button
            type="button"
            className="form-btn"
            onClick={() => handleSave()}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}

      {/* Modals */}
      {activeModal === 'reject' && product && (
        <RejectModal
          product={product}
          onClose={() => setActiveModal(null)}
          onSuccess={onModalSuccess}
        />
      )}
      {activeModal === 'requestChanges' && product && (
        <RequestChangesModal
          product={product}
          onClose={() => setActiveModal(null)}
          onSuccess={onModalSuccess}
        />
      )}
    </div>
  );
}
