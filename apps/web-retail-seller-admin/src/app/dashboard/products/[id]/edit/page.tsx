'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { adminProductsService, ProductDetail } from '@/services/admin-products.service';
import { ApiError } from '@/lib/api-client';
import { validateUploadFile } from '@/lib/validators';
import RejectModal from '../../components/reject-modal';
import RequestChangesModal from '../../components/request-changes-modal';
import '../../product-form.css';
import { RichTextEditor, useModal } from '@sportsmart/ui';

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
  const { notify, confirmDialog } = useModal();
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
    compareAtPrice: '',
    costPrice: '',
    procurementPrice: '',
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
    // Tax & GST — populated from the product in populateForm() and
    // sent back as part of every save. Admin always touches them on
    // any update (no change detection), so the audit stamp fires
    // whenever the admin clicks Save with values in this section.
    hsnCode: '',
    gstRateBps: '',
    supplyTaxability: '',
    cessRateBps: '',
    defaultUqcCode: '',
    taxCategory: '',
    taxInclusivePricing: true,
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

  // Admin role — only a SUPER_ADMIN may make a product live (status → ACTIVE),
  // which is the tax/finance signoff step. The option is hidden for other admins
  // (the backend also enforces it).
  const [adminRole, setAdminRole] = useState('');
  useEffect(() => {
    try {
      const adminData = sessionStorage.getItem('admin');
      if (adminData) setAdminRole(JSON.parse(adminData).role || '');
    } catch {
      // ignore
    }
  }, []);

  // Variant options state
  const [productOptions, setProductOptions] = useState<OptionEntry[]>([]);
  const [predefinedOptions, setPredefinedOptions] = useState<PredefinedOption[]>([]);
  const [generatingVariants, setGeneratingVariants] = useState(false);

  // Image state
  const [uploadingImage, setUploadingImage] = useState(false);
  // Per-batch upload progress so the gallery can show "Uploading X of Y…" and a
  // matching number of skeleton tiles while files upload + the reload runs.
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      compareAtPrice: p.compareAtPrice && Number(p.compareAtPrice) > 0 ? p.compareAtPrice : '',
      costPrice: p.costPrice ?? '',
      procurementPrice: (p as any).procurementPrice ?? '',
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
      // Tax fields — string-coerced so they slot into the form state.
      // Old products predating the Phase 1 GST migration may carry
      // nulls; the defaults preserve a usable starting state.
      hsnCode: p.hsnCode || '',
      gstRateBps: p.gstRateBps != null ? String(p.gstRateBps) : '',
      supplyTaxability: p.supplyTaxability || '',
      cessRateBps: p.cessRateBps != null ? String(p.cessRateBps) : '',
      defaultUqcCode: p.defaultUqcCode || '',
      taxCategory: p.taxCategory || '',
      taxInclusivePricing: p.taxInclusivePricing ?? true,
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
      }).catch((err) => console.warn(err));
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
    // Stop requires a reason (backend min 3 chars). Prompt for it so the action
    // actually succeeds instead of silently 400ing.
    const reason = (window.prompt('Reason for stopping this seller mapping:') || '').trim();
    if (!reason) return; // cancelled
    if (reason.length < 3) {
      showToast('error', 'Stop reason must be at least 3 characters.');
      return;
    }
    setMappingActionLoading(mappingId);
    try {
      await adminProductsService.stopMapping(mappingId, reason);
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

  const handleRejectMapping = async (mappingId: string) => {
    // Reject is the valid takedown for a PENDING_APPROVAL mapping (/stop is
    // APPROVED-only). Backend RejectMappingDto requires a reason (min 3 chars).
    const reason = (window.prompt('Reason for rejecting this seller mapping:') || '').trim();
    if (!reason) return; // cancelled
    if (reason.length < 3) {
      showToast('error', 'Reject reason must be at least 3 characters.');
      return;
    }
    setMappingActionLoading(mappingId);
    try {
      await adminProductsService.rejectMapping(mappingId, reason);
      setSellerMappings(prev =>
        prev.map(m => m.id === mappingId ? { ...m, approvalStatus: 'REJECTED' } : m)
      );
      showToast('success', 'Mapping rejected.');
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'Failed to reject mapping.');
    } finally {
      setMappingActionLoading(null);
    }
  };

  const handleReapproveMapping = async (mappingId: string) => {
    // Reapprove lifts a STOPPED mapping back to APPROVED. Backend
    // ReapproveMappingDto requires a reason (min 3 chars).
    const reason = (window.prompt('Reason for re-approving this stopped mapping:') || '').trim();
    if (!reason) return; // cancelled
    if (reason.length < 3) {
      showToast('error', 'Reapprove reason must be at least 3 characters.');
      return;
    }
    setMappingActionLoading(mappingId);
    try {
      await adminProductsService.reapproveMapping(mappingId, reason);
      setSellerMappings(prev =>
        prev.map(m => m.id === mappingId ? { ...m, approvalStatus: 'APPROVED' } : m)
      );
      showToast('success', 'Mapping re-approved.');
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'Failed to re-approve mapping.');
    } finally {
      setMappingActionLoading(null);
    }
  };

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
    // Taxonomy is referenced by id — a typed value that didn't match an existing
    // category/brand can't be saved (the backend rejects free-text names).
    if (!form.categoryId && form.categoryName?.trim()) {
      errs.category = 'Select an existing category from the list';
    }
    if (!form.brandId && form.brandName?.trim()) {
      errs.brand = 'Select an existing brand from the list';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ----- Build payload -----

  function buildPayload() {
    const payload: any = {
      title: form.title.trim(),
    };

    // Admins reference existing taxonomy by id only — the update DTO rejects
    // free-text categoryName/brandName (forbidNonWhitelisted). Send ids only;
    // a typed-but-unmatched value is blocked in validate().
    if (form.categoryId) payload.categoryId = form.categoryId;
    if (form.brandId) payload.brandId = form.brandId;
    payload.shortDescription = form.shortDescription.trim();
    payload.description = form.description.trim();

    // Procurement price applies to both simple and variant products
    // (fallback for product-level mappings with no variant).
    if (form.procurementPrice) payload.procurementPrice = Number(form.procurementPrice);
    else payload.procurementPrice = null;

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

    // Tax fields — always send the current form state. Admin controller
    // writes through whatever arrives and stamps taxConfigUpdatedBy/At
    // when any tax key is present, so a Save with no tax changes still
    // refreshes the audit stamp (acceptable — admin saw and confirmed
    // the tax config). Empty optional strings clear via null; numeric
    // defaults fall back to 0 (column is non-nullable).
    // Tax fields (HSN, GST rate, supply type, cess, UQC, tax category) are
    // super-admin-only and not sent from this form.

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

  async function handleGenerateVariants() {const validOptions = productOptions
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
      if (!(await confirmDialog('This will replace all existing variants. Continue?'))) return;
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

  async function deleteVariant(variantId: string) {if (!(await confirmDialog('Are you sure you want to delete this variant?'))) return;

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
      const fileError = validateUploadFile(files[i], {
        maxBytes: 5 * 1024 * 1024,
        types: ['image/jpeg', 'image/png', 'image/webp'],
      });
      if (fileError) {
        showToast('error', `"${files[i].name}": ${fileError} — skipped.`);
      } else {
        validFiles.push(files[i]);
      }
    }

    if (validFiles.length === 0) return;

    setUploadingImage(true);
    setUploadProgress({ done: 0, total: validFiles.length });
    let uploaded = 0;
    let failed = 0;

    for (const file of validFiles) {
      try {
        await adminProductsService.uploadImage(productId, file);
        uploaded++;
      } catch {
        failed++;
      }
      setUploadProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    }

    if (failed > 0) {
      showToast('error', `${uploaded} image(s) uploaded, ${failed} failed.`);
    } else {
      showToast('success', `${uploaded} image(s) uploaded successfully.`);
    }

    await loadProduct();
    setUploadingImage(false);
    setUploadProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleDeleteImage(imageId: string) {if (!(await confirmDialog('Delete this image?'))) return;

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

  // Seller-mapping summary. NOTE: each row is a per-variant mapping, so
  // one seller can own several rows -- count DISTINCT sellers separately
  // from the number of mappings.
  const distinctSellerCount = new Set(
    sellerMappings.map((m) => m.seller?.id).filter(Boolean),
  ).size;
  const pendingMappingCount = sellerMappings.filter(
    (m) => m.approvalStatus === 'PENDING_APPROVAL',
  ).length;
  const approvedStockTotal = sellerMappings
    .filter((m) => m.approvalStatus === 'APPROVED')
    .reduce((s, m) => s + m.stockQty, 0);
  const totalStockAll = sellerMappings.reduce((s, m) => s + m.stockQty, 0);

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

      {/* Compact context bar — replaces the verbose status banner +
          seller info row with a single chip row: status, seller, last
          update. Rejection / change-request notes surface inline. */}
      <ProductContextBar product={product} />

      {/* Read-only banner for admin-created products — separate from
          the context bar because it's about edit permission, not
          lifecycle state. */}
      {isAdminCreated && (
        <div style={{
          padding: '10px 14px',
          background: '#eff6ff',
          border: '1px solid #bfdbfe',
          borderRadius: 8,
          marginBottom: 16,
          fontSize: 12.5,
          color: '#1e40af',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 8h8v6H4zM5 8V5a3 3 0 016 0v3"
            />
          </svg>
          Created by Storefront Admin — product content is read-only here.
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

      {/* Seller Mappings — primary admin surface, surfaced at the top */}
      <div className="form-card">
        <div className="sm-header">
          <div className="sm-header-titles">
            <span className="sm-title">Seller Mappings</span>
            {sellerMappings.length > 0 && (
              <span className="sm-count">
                {distinctSellerCount} seller{distinctSellerCount !== 1 ? 's' : ''} ·{' '}
                {sellerMappings.length} mapping{sellerMappings.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <button
            type="button"
            className="sm-refresh"
            onClick={loadSellerMappings}
            disabled={sellerMappingsLoading}
          >
            <svg
              className={sellerMappingsLoading ? 'sm-spin' : ''}
              viewBox="0 0 16 16"
              width="14"
              height="14"
              aria-hidden="true"
            >
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89M13.5 1.5v3h-3"
              />
            </svg>
            {sellerMappingsLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {sellerMappingsLoading && sellerMappings.length === 0 ? (
          <div className="sm-loading">Loading seller mappings…</div>
        ) : sellerMappings.length === 0 ? (
          <div className="sm-empty">
            <div className="sm-empty-title">No sellers mapped yet</div>
            <div>
              Sellers who map this product to their inventory will appear here for
              approval.
            </div>
          </div>
        ) : (
          <>
            <div className="sm-stats">
              <div className="sm-stat">
                <span className="sm-stat-label">Sellers</span>
                <span className="sm-stat-value">{distinctSellerCount}</span>
              </div>
              <div className="sm-stat">
                <span className="sm-stat-label">Mappings</span>
                <span className="sm-stat-value">{sellerMappings.length}</span>
              </div>
              <div className={`sm-stat ${pendingMappingCount === 0 ? 'zero' : 'accent-amber'}`}>
                <span className="sm-stat-label">Pending</span>
                <span className="sm-stat-value">{pendingMappingCount}</span>
              </div>
              <div className={`sm-stat ${approvedStockTotal === 0 ? 'zero' : 'accent-green'}`}>
                <span className="sm-stat-label">Approved stock</span>
                <span className="sm-stat-value">{approvedStockTotal.toLocaleString()}</span>
              </div>
              <div className="sm-stat">
                <span className="sm-stat-label">Total stock</span>
                <span className="sm-stat-value">{totalStockAll.toLocaleString()}</span>
              </div>
            </div>

            <div className="sm-table-wrap">
              <table className="sm-table">
                <thead>
                  <tr>
                    <th>Seller</th>
                    <th>Internal SKU</th>
                    <th className="num">Stock</th>
                    <th>Status</th>
                    <th className="actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sellerMappings.map((m) => {
                    const pill =
                      m.approvalStatus === 'APPROVED'
                        ? 'approved'
                        : m.approvalStatus === 'STOPPED'
                        ? 'stopped'
                        : m.approvalStatus === 'PENDING_APPROVAL'
                        ? 'pending'
                        : 'neutral';
                    const sku =
                      m.sellerInternalSku ||
                      m.variant?.sku ||
                      product?.baseSku ||
                      product?.productCode;
                    // Gate to the transitions the backend accepts: /approve and
                    // /reject are PENDING_APPROVAL-only, /stop is APPROVED-only,
                    // /reapprove is STOPPED-only. Each row therefore shows the
                    // exact action(s) valid for its current status.
                    const canApprove = m.approvalStatus === 'PENDING_APPROVAL';
                    const canReject = m.approvalStatus === 'PENDING_APPROVAL';
                    const canStop = m.approvalStatus === 'APPROVED';
                    const canReapprove = m.approvalStatus === 'STOPPED';
                    return (
                      <tr key={m.id}>
                        <td>
                          <div className="sm-seller-name">
                            {m.seller?.sellerName || 'Unknown'}
                          </div>
                          {m.variant && (
                            <div className="sm-seller-sub">
                              {m.variant.title || m.variant.masterSku}
                            </div>
                          )}
                        </td>
                        <td>
                          {sku ? (
                            <span className="sm-sku">{sku}</span>
                          ) : (
                            <span className="sm-sku empty">—</span>
                          )}
                        </td>
                        <td className="num">{m.stockQty.toLocaleString()}</td>
                        <td>
                          <span className={`sm-pill ${pill}`}>
                            {formatApprovalStatus(m.approvalStatus)}
                          </span>
                        </td>
                        <td className="actions">
                          <div className="sm-actions">
                            {canApprove && (
                              <button
                                type="button"
                                className="sm-act sm-act-approve"
                                onClick={() => handleApproveMapping(m.id)}
                                disabled={mappingActionLoading === m.id}
                              >
                                <svg viewBox="0 0 16 16" aria-hidden="true">
                                  <path
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M3.5 8.5l3 3 6-7"
                                  />
                                </svg>
                                Approve
                              </button>
                            )}
                            {canReject && (
                              <button
                                type="button"
                                className="sm-act sm-act-stop"
                                onClick={() => handleRejectMapping(m.id)}
                                disabled={mappingActionLoading === m.id}
                              >
                                <svg viewBox="0 0 16 16" aria-hidden="true">
                                  <path
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    d="M4 4l8 8M12 4l-8 8"
                                  />
                                </svg>
                                Reject
                              </button>
                            )}
                            {canStop && (
                              <button
                                type="button"
                                className="sm-act sm-act-stop"
                                onClick={() => handleStopMapping(m.id)}
                                disabled={mappingActionLoading === m.id}
                              >
                                <svg viewBox="0 0 16 16" aria-hidden="true">
                                  <path
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    d="M4 4l8 8M12 4l-8 8"
                                  />
                                </svg>
                                Stop
                              </button>
                            )}
                            {canReapprove && (
                              <button
                                type="button"
                                className="sm-act sm-act-approve"
                                onClick={() => handleReapproveMapping(m.id)}
                                disabled={mappingActionLoading === m.id}
                              >
                                <svg viewBox="0 0 16 16" aria-hidden="true">
                                  <path
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M3.5 8.5l3 3 6-7"
                                  />
                                </svg>
                                Reapprove
                              </button>
                            )}
                            {!canApprove && !canReject && !canStop && !canReapprove && (
                              <span className="sm-act-dim">—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

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

          {/* Master Code — auto-generated platform identifier. Always shown,
              regardless of whether the product has variants. Read-only. */}
          <div className="form-group">
            <label className="form-label">Master Code</label>
            <input
              type="text"
              className="form-input"
              value={product?.productCode || ''}
              readOnly
              placeholder="Auto-generated"
              style={{ background: '#f3f4f6', cursor: 'not-allowed', fontFamily: 'monospace' }}
            />
            <span className="form-hint">Auto-generated platform code. Stable across renames.</span>
          </div>

          <div className="form-group">
            <label className="form-label">Base SKU</label>
            <input
              type="text"
              className="form-input"
              value={form.baseSku}
              onChange={e => updateField('baseSku', e.target.value)}
              placeholder="e.g. BAT-MRF-PRO"
              maxLength={100}
              disabled={!isEditable}
              style={{ fontFamily: 'monospace' }}
            />
            <span className="form-hint">Seller&apos;s product-level SKU (optional). Useful for simple products without variants.</span>
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
                  value={form.basePrice}
                  onChange={e => updateField('basePrice', e.target.value)}
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
              <label className="form-label">Cost Price</label>
              <div className="input-with-prefix">
                <span className="input-prefix">&#8377;</span>
                <input
                  type="number"
                  className="form-input"
                  value={form.costPrice}
                  onChange={e => updateField('costPrice', e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  disabled={!isEditable}
                />
              </div>
              <span className="form-hint">
                Display-only informational cost. Not used by any pricing logic.
              </span>
            </div>

            {/*
              Product-level procurement cost. Used by the franchise
              procurement flow when a mapping has no variant
              (rare — most mappings are variant-level). Variant-level
              procurementPrice wins when set; per-franchise overrides
              set on the franchise's Procurement Pricing page take
              precedence over both.
            */}
            <div className="form-group">
              <label className="form-label">Procurement Price</label>
              <div className="input-with-prefix">
                <span className="input-prefix">&#8377;</span>
                <input
                  type="number"
                  className="form-input"
                  value={form.procurementPrice}
                  onChange={e => updateField('procurementPrice', e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  disabled={!isEditable}
                />
              </div>
              <span className="form-hint">
                Platform-wide default landed cost applied when franchises procure this
                product. Variant-level procurement price wins when set; franchise-
                specific overrides on each franchise&apos;s Procurement Pricing page
                take precedence over both.
              </span>
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
                  <th>Master SKU</th>
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
                      <td style={{ fontSize: 13, fontFamily: 'monospace', color: variant.masterSku ? 'var(--color-text)' : '#9ca3af' }}>{variant.masterSku || '\u2014'}</td>
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
            className={`image-upload-area${uploadingImage ? ' is-uploading' : ''}`}
            onClick={() => {
              if (!uploadingImage) fileInputRef.current?.click();
            }}
            aria-busy={uploadingImage}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              disabled={uploadingImage}
              onChange={handleImageUpload}
              style={{ display: 'none' }}
            />
            {uploadingImage ? (
              <div className="upload-progress" role="status" aria-live="polite">
                <span className="upload-spinner" aria-hidden="true" />
                <p>
                  Uploading {uploadProgress?.done ?? 0} of {uploadProgress?.total ?? 0}…
                </p>
              </div>
            ) : (
              <p>Click to upload images</p>
            )}
            <p className="upload-hint">Select one or more images. Max 5MB each. JPG, PNG, or WebP.</p>
          </div>
        )}

        {sortedImages.length > 0 || uploadingImage ? (
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
            {uploadingImage &&
              Array.from({ length: uploadProgress?.total ?? 0 }).map((_, i) => (
                <div key={`upload-skeleton-${i}`}>
                  <div className="image-card image-skeleton" aria-hidden="true" />
                </div>
              ))}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>No images uploaded yet.</p>
        )}
      </div>

      {/* Tax & GST classification is set by a super-admin per product
          (HSN, GST rate, supply type, cess, UQC) — not editable here. */}

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
                {adminRole === 'SUPER_ADMIN' && product.status !== 'ACTIVE' && (
                  <option value="ACTIVE">Active (make live)</option>
                )}
                {product.status !== 'SUSPENDED' && product.status !== 'APPROVED' && (
                  <option value="SUSPENDED">Suspended</option>
                )}
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
            aria-busy={saving}
          >
            {saving ? (
              <>
                <span className="btn-spinner" aria-hidden="true" />
                Saving…
              </>
            ) : (
              'Save Changes'
            )}
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

/* ── Product context bar ───────────────────────────────────────
   One compact row at the top of the edit page: status pill, seller
   chip, last-updated timestamp. Replaces the old "live on storefront"
   banner + the verbose seller info row. Rejection / change-request
   notes surface in a small note row underneath when present. */

function ProductContextBar({ product }: { product: any }) {
  const status: string = product.status ?? 'DRAFT';
  const moderationStatus: string | null = product.moderationStatus ?? null;

  let label: string;
  let tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  let note: string | null = null;

  if (moderationStatus === 'REJECTED') {
    label = 'Rejected';
    tone = 'danger';
    // Phase 32 (2026-05-21) — prefer structured column.
    note = product.rejectionReason || product.moderationNote || null;
  } else if (moderationStatus === 'CHANGES_REQUESTED') {
    label = 'Changes requested';
    tone = 'warning';
    note = product.changeRequestNote || product.moderationNote || null;
  } else if (moderationStatus === 'SUBMITTED' || moderationStatus === 'IN_REVIEW' || status === 'SUBMITTED') {
    label = 'Pending review';
    tone = 'warning';
  } else if (status === 'ACTIVE') {
    label = 'Live on storefront';
    tone = 'success';
  } else if (status === 'APPROVED') {
    label = 'Approved';
    tone = 'info';
  } else if (status === 'DRAFT') {
    label = 'Draft';
    tone = 'neutral';
  } else if (status === 'SUSPENDED') {
    label = 'Suspended';
    tone = 'neutral';
  } else if (status === 'ARCHIVED') {
    label = 'Archived';
    tone = 'neutral';
  } else {
    label = status.replace(/_/g, ' ').toLowerCase();
    tone = 'neutral';
  }

  const tonePalette: Record<typeof tone, { dot: string; fg: string; bg: string }> = {
    success: { dot: '#16a34a', fg: '#15803d', bg: '#f0fdf4' },
    warning: { dot: '#d97706', fg: '#b45309', bg: '#fffbeb' },
    danger:  { dot: '#dc2626', fg: '#b91c1c', bg: '#fef2f2' },
    info:    { dot: '#2563eb', fg: '#1d4ed8', bg: '#eff6ff' },
    neutral: { dot: '#94a3b8', fg: '#475569', bg: '#f8fafc' },
  };
  const p = tonePalette[tone];

  const sellerName: string | null =
    product.seller?.sellerShopName || product.seller?.sellerName || null;

  let lastUpdate: Date | null = null;
  const history = Array.isArray(product.statusHistory) ? product.statusHistory : [];
  if (history.length > 0) {
    const latest = [...history].sort(
      (a: any, b: any) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];
    if (latest?.createdAt) lastUpdate = new Date(latest.createdAt);
  } else if (product.updatedAt) {
    lastUpdate = new Date(product.updatedAt);
  }

  const lastUpdateLabel = lastUpdate
    ? lastUpdate.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: lastUpdate.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
      })
    : null;

  const chipBase: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 28,
    padding: '0 10px',
    fontSize: 12.5,
    fontWeight: 500,
    borderRadius: 6,
    whiteSpace: 'nowrap',
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ ...chipBase, background: p.bg, color: p.fg, fontWeight: 600 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: p.dot,
              flexShrink: 0,
            }}
          />
          {label}
        </span>

        {sellerName && (
          <>
            <span style={{ width: 1, height: 18, background: '#e2e8f0' }} />
            <span style={{ ...chipBase, color: '#475569' }}>
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" style={{ color: '#94a3b8' }}>
                <path
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 8a3 3 0 100-6 3 3 0 000 6zM2 14a6 6 0 1112 0"
                />
              </svg>
              <span style={{ color: '#94a3b8' }}>Sold by</span>
              <strong style={{ color: '#0f172a', fontWeight: 600 }}>{sellerName}</strong>
            </span>
          </>
        )}

        {lastUpdateLabel && (
          <>
            <span style={{ flex: 1, minWidth: 8 }} />
            <span style={{ ...chipBase, color: '#94a3b8', fontSize: 12 }}>
              Updated {lastUpdateLabel}
            </span>
          </>
        )}
      </div>

      {note && (
        <div
          style={{
            marginTop: 6,
            padding: '8px 14px',
            background: p.bg,
            border: `1px solid ${p.dot}33`,
            borderRadius: 6,
            fontSize: 12.5,
            color: p.fg,
          }}
        >
          <strong style={{ fontWeight: 600 }}>{label}:</strong> {note}
        </div>
      )}
    </div>
  );
}
