'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import {
  sellerProductService,
  ProductDetail,
  ProductVariant,
  ProductImage,
} from '@/services/product.service';
import { apiClient, ApiError } from '@/lib/api-client';
import '../../product-form.css';
import { RichTextEditor, useModal } from '@sportsmart/ui';
// Phase 39 (2026-05-21) — category metafield form section + payload mapper.
import {
  CategoryMetafieldFormSection,
  metafieldValuesToPayload,
  type MetafieldValueEntry,
} from '../../components/CategoryMetafieldFormSection';

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

  // Form state
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
    // sent back as part of every save so the controller's change
    // detection sees the new values.
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

  // AI generation
  const [aiGenerating, setAiGenerating] = useState(false);
  // Phase 249 (#4) — the generationLogId returned by the AI generate
  // endpoint (meta.generationLogId), captured only when the seller
  // actually accepts the generated draft. Echoed back on product save
  // so the backend stamps AI provenance + flips the log to ACCEPTED.
  // Cleared after a successful save (consumed) or null when untracked.
  const [aiGenerationLogId, setAiGenerationLogId] = useState<string | null>(null);

  const generateWithAI = useCallback(async () => {
    if (!form.title.trim()) return;
    // Data-loss guard: if the seller already wrote content into any of
    // the fields AI would overwrite, confirm before clobbering it. Reuses
    // the confirmDialog from useModal already used for variant/image deletes.
    const hasExistingContent =
      form.description.trim() !== '' ||
      form.seoHandle.trim() !== '' ||
      form.seoMetaTitle.trim() !== '' ||
      form.seoMetaDescription.trim() !== '';
    if (hasExistingContent) {
      if (!(await confirmDialog('You already have content in some fields. Overwrite it with the AI-generated version?'))) return;
    }
    setAiGenerating(true);
    try {
      const json = await apiClient<any>('/ai/generate-product-content', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title,
          category: form.categoryName || '',
          brand: form.brandName || '',
          shortDescription: form.shortDescription,
        }),
      });
      if (json.data) {
        setForm(prev => ({
          ...prev,
          description: json.data.description || prev.description,
          seoHandle: json.data.slug || prev.seoHandle,
          seoMetaTitle: json.data.metaTitle || prev.seoMetaTitle,
          seoMetaDescription: json.data.metaDescription || prev.seoMetaDescription,
        }));
        // meta is a sibling of data on the raw apiClient response envelope.
        // Captured only here — after the confirm guard passed and we applied
        // the result — so the id is threaded only when the seller accepted.
        setAiGenerationLogId((json as any).meta?.generationLogId ?? null);
        setToast({ type: 'success', message: '✨ AI-generated — review for accuracy before saving.' });
      }
    } catch { setToast({ type: 'error', message: 'AI generation failed.' }); }
    finally { setAiGenerating(false); }
  }, [form.title, form.categoryName, form.brandName, form.shortDescription, form.description, form.seoHandle, form.seoMetaTitle, form.seoMetaDescription, confirmDialog]);

  // UI state
  // Which footer action is in flight, so only the clicked button shows a spinner
  // while the other simply disables — they no longer share one boolean (which made
  // clicking either button flip BOTH to "Saving…").
  const [savingAction, setSavingAction] = useState<'save' | 'submit' | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Track initial form snapshot to detect changes
  const initialFormRef = useRef<string>('');
  const hasChanges = JSON.stringify(form) !== initialFormRef.current;

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

  // Phase 39 (2026-05-21) — category metafield value map. Hydrated
  // from the loaded product's metafields[] in populateForm; sent back
  // as `metafields[]` in buildPayload only if any entries changed.
  const [metafieldValues, setMetafieldValues] = useState<Record<string, MetafieldValueEntry>>({});
  const initialMetafieldsRef = useRef<string>('');

  // ----- Toast helper -----

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ type, message });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // ----- Populate form from product -----

  const populateForm = useCallback((p: ProductDetail) => {
    const formData = {
      title: p.title || '',
      categoryId: p.categoryId || '',
      categoryName: p.category?.name || '',
      brandId: p.brandId || '',
      brandName: p.brand?.name || '',
      shortDescription: p.shortDescription || '',
      description: p.description || '',
      hasVariants: p.hasVariants,
      basePrice: p.basePrice ?? '',
      compareAtPrice: p.compareAtPrice ?? '',
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
      // Tax fields — coerced to strings so they slot into the
      // string-typed form state. Defaults preserved when the column
      // is null (rare — schema sets defaults at insert time, but old
      // products predating the Phase 1 GST migration may have nulls).
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
    };
    setForm(formData);
    initialFormRef.current = JSON.stringify(formData);

    // Phase 39 (2026-05-21) — hydrate the metafield value map from the
    // server response. The seller GET returns `metafields[]` rows with
    // a definition include; we coalesce each row's value columns into
    // a single typed value matching the UI shape.
    const mfMap: Record<string, MetafieldValueEntry> = {};
    const mfRows = (p as unknown as { metafields?: Array<{
      metafieldDefinitionId: string;
      metafieldDefinition?: { namespace: string; key: string; type: string };
      valueText?: string | null;
      valueNumeric?: number | string | null;
      valueBoolean?: boolean | null;
      valueDate?: string | null;
      valueJson?: unknown;
    }> }).metafields;
    for (const row of mfRows ?? []) {
      const def = row.metafieldDefinition;
      if (!def) continue;
      let value: MetafieldValueEntry['value'];
      switch (def.type) {
        case 'NUMBER_INTEGER':
        case 'NUMBER_DECIMAL':
        case 'RATING':
          // valueNumeric is a Prisma Decimal — arrives as a string in JSON.
          value = row.valueNumeric != null ? Number(row.valueNumeric) : null;
          break;
        case 'BOOLEAN':
          value = row.valueBoolean ?? null;
          break;
        case 'DATE':
          value = row.valueDate ? String(row.valueDate).slice(0, 10) : null;
          break;
        case 'MULTI_SELECT':
        case 'DIMENSION':
        case 'WEIGHT':
        case 'VOLUME':
        case 'JSON':
          value = (row.valueJson as MetafieldValueEntry['value']) ?? null;
          break;
        default:
          value = row.valueText ?? null;
      }
      mfMap[row.metafieldDefinitionId] = {
        definitionId: row.metafieldDefinitionId,
        namespace: def.namespace,
        key: def.key,
        value,
      };
    }
    setMetafieldValues(mfMap);
    initialMetafieldsRef.current = JSON.stringify(mfMap);
  }, []);

  // ----- Load product and reference data -----

  const loadProduct = useCallback(async () => {
    try {
      const token = sessionStorage.getItem('accessToken') || '';
      const res = await sellerProductService.getProduct(token, productId);
      if (res.data) {
        setProduct(res.data);
        populateForm(res.data);

        // Reconstruct options from product data
        if ((res.data as any).options && (res.data as any).optionValues) {
          const optEntries: OptionEntry[] = [];
          for (const po of (res.data as any).options) {
            const def = po.optionDefinition;
            if (!def) continue;
            // Find values for this option definition
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
        setLoadError(err.message || 'Failed to load product.');
      } else {
        setLoadError('Failed to load product.');
      }
    } finally {
      setLoading(false);
    }
  }, [productId, populateForm]);

  useEffect(() => {
    async function loadData() {
      try {
        const [catRes, brandRes] = await Promise.all([
          sellerProductService.getCategories(),
          sellerProductService.getBrands(),
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
      sellerProductService.getOptions().then(res => {
        if (res.data) {
          const opts = Array.isArray(res.data) ? res.data : [];
          setPredefinedOptions(opts);
        }
      }).catch(() => {});
    }

    loadData();
    loadProduct();
  }, [loadProduct]);

  // ----- Computed -----

  const isEditable = !!product; // Always editable
  const canSubmitForReview = product
    ? ['DRAFT', 'REJECTED', 'CHANGES_REQUESTED'].includes(product.status)
    : false;

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
      if (form.baseStock === '' || isNaN(Number(form.baseStock)) || Number(form.baseStock) < 0) {
        errs.baseStock = 'Stock is required and must be 0 or more';
      }
    }
    // Sellers cannot mint taxonomy — a typed value that didn't resolve to an
    // existing category/brand id would be rejected by the backend with a 400,
    // so block it here with actionable guidance instead.
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

    // Send ids only — the seller DTO rejects free-text categoryName/brandName
    // (Phase 30 anti-injection). A typed-but-unmatched value is blocked in
    // validate(), so it never reaches here.
    if (form.categoryId) payload.categoryId = form.categoryId;
    if (form.brandId) payload.brandId = form.brandId;
    payload.shortDescription = form.shortDescription.trim();
    payload.description = form.description.trim();

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

    // Tax fields (HSN, GST rate, supply type, cess, UQC, tax category) are
    // super-admin-only and not sent from the seller edit form.

    payload.tags = form.tags;

    const seo: any = {};
    seo.metaTitle = form.seoMetaTitle.trim() || null;
    seo.metaDescription = form.seoMetaDescription.trim() || null;
    seo.handle = form.seoHandle.trim() || null;
    payload.seo = seo;

    // Phase 39 (2026-05-21) — include metafields[] only when the map
    // changed against the loaded state. An unchanged set would be a
    // wasted re-approval trigger (metafield writes are flagged as
    // content by the re-approval classifier).
    if (JSON.stringify(metafieldValues) !== initialMetafieldsRef.current) {
      const metafields = metafieldValuesToPayload(metafieldValues);
      payload.metafields = metafields;
    }

    return payload;
  }

  // ----- Save handler -----

  async function handleSave(submitForReview: boolean) {
    if (!validate()) {
      showToast('error', 'Please fix the errors before saving.');
      return;
    }

    setSavingAction(submitForReview ? 'submit' : 'save');
    try {
      const token = sessionStorage.getItem('accessToken') || '';
      const payload = buildPayload();
      // Phase 249 (#4) — thread the AI generation log id onto the update
      // so the backend stamps provenance + marks the generation ACCEPTED.
      // Allowlisted on SellerUpdateProductDto; backend CAS-guards double-accept.
      if (aiGenerationLogId) payload.aiGenerationLogId = aiGenerationLogId;
      await sellerProductService.updateProduct(token, productId, payload);
      // Consumed — clear so the follow-up reload / next save doesn't re-send it.
      setAiGenerationLogId(null);

      if (submitForReview) {
        try {
          await sellerProductService.submitForReview(token, productId);
          showToast('success', 'Product submitted for review. Your SKU mapping will go live after admin approval.');
        } catch (submitErr) {
          // The product WAS saved, but submit-for-review failed (e.g. it needs
          // at least one image, or a required field). Surface the real,
          // actionable reason as an error — not a green "success" — so the
          // seller knows exactly what to fix before resubmitting.
          const reason = submitErr instanceof ApiError ? submitErr.message : 'Submit for review failed.';
          showToast('error', `Saved, but not submitted: ${reason}`);
        }
      } else {
        showToast('success', 'Product updated successfully.');
      }

      // Always do a full reload to get complete data including variant images
      await loadProduct();
    } catch (err) {
      if (err instanceof ApiError) {
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
      setSavingAction(null);
    }
  }

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

  async function handleGenerateVariants() {// Validate options
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

    // Warn if variants already exist
    if (product && product.variants.length > 0) {
      if (!(await confirmDialog('This will replace all existing variants. Continue?'))) return;
    }

    setGeneratingVariants(true);
    try {
      const token = sessionStorage.getItem('accessToken') || '';
      await sellerProductService.generateManualVariants(token, productId, validOptions);
      showToast('success', 'Variants generated successfully.');
      // Collapse all options
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
      const token = sessionStorage.getItem('accessToken') || '';
      await sellerProductService.deleteVariant(token, productId, variantId);
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
    setUploadProgress({ done: 0, total: validFiles.length });
    const token = sessionStorage.getItem('accessToken') || '';
    let uploaded = 0;
    let failed = 0;

    for (const file of validFiles) {
      try {
        await sellerProductService.uploadImage(token, productId, file);
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
      const token = sessionStorage.getItem('accessToken') || '';
      await sellerProductService.deleteImage(token, productId, imageId);
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
    // Reorder: put selected image first, keep others in existing order
    const currentImages = [...product.images].sort((a, b) => a.sortOrder - b.sortOrder);
    const targetImage = currentImages.find(img => img.id === imageId);
    if (!targetImage) return;
    const otherImages = currentImages.filter(img => img.id !== imageId);
    const newOrder = [targetImage, ...otherImages].map(img => img.id);

    try {
      const token = sessionStorage.getItem('accessToken') || '';
      await sellerProductService.reorderImages(token, productId, newOrder);
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
    const sorted = [...product.images].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex(img => img.id === imageId);
    if (idx === -1) return;

    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= sorted.length) return;

    // Swap
    const newArr = [...sorted];
    [newArr[idx], newArr[newIdx]] = [newArr[newIdx], newArr[idx]];
    const newOrder = newArr.map(img => img.id);

    try {
      const token = sessionStorage.getItem('accessToken') || '';
      await sellerProductService.reorderImages(token, productId, newOrder);
      await loadProduct();
    } catch (err) {
      if (err instanceof ApiError) {
        showToast('error', err.message || 'Failed to reorder images.');
      } else {
        showToast('error', 'Failed to reorder images.');
      }
    }
  }

  // 2026-06-15 — the product-level self-status pause/resume was removed from
  // the edit page (it suspended the shared product for ALL sellers). Per-seller
  // pause now lives in My Products and acts only on this seller's offer.

  // ----- Status banner -----

  function renderStatusBanner() {
    if (!product) return null;
    const status = product.moderationStatus;

    // Phase 32 (2026-05-21) — structured columns preferred.
    if (status === 'REJECTED') {
      const note = product.rejectionReason ?? product.moderationNote;
      return (
        <div className="status-banner rejected">
          <strong>Rejected</strong>
          {note && <> &mdash; {note}</>}
        </div>
      );
    }
    if (status === 'CHANGES_REQUESTED') {
      const note = product.changeRequestNote ?? product.moderationNote;
      return (
        <div className="status-banner changes-requested">
          <strong>Changes Requested</strong>
          {note && <> &mdash; {note}</>}
        </div>
      );
    }
    if (status === 'SUBMITTED' || status === 'IN_REVIEW') {
      // Check if this is a re-approval (status history shows it came from APPROVED/ACTIVE)
      const latestHistory = product.statusHistory?.[0];
      const isReApproval = latestHistory &&
        (latestHistory.fromStatus === 'APPROVED' || latestHistory.fromStatus === 'ACTIVE');
      return (
        <div className="status-banner submitted">
          {isReApproval
            ? 'This product was modified and is pending re-approval.'
            : 'This product is pending review.'}
        </div>
      );
    }
    if (status === 'APPROVED' || status === 'ACTIVE') {
      // 2026-06-15 \u2014 the product-level Pause button was removed: pausing a
      // shared catalog product would stop sales for ALL sellers. To stop
      // selling from your own account, use "Pause sales" in My Products (it
      // pauses only your offer; other sellers keep selling).
      return (
        <div className="status-banner active">
          <span>This product is live.</span>
        </div>
      );
    }
    if (status === 'SUSPENDED') {
      return (
        <div
          className="status-banner"
          style={{
            background: '#f3f4f6',
            border: '1px solid #d1d5db',
            color: '#374151',
          }}
        >
          <span>
            <strong>Suspended by an admin</strong> &mdash; this product is not
            visible to customers. Contact support to restore it.
          </span>
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

  const sortedImages = [...product.images].sort((a, b) => a.sortOrder - b.sortOrder);
  const sortedVariants = [...product.variants];

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
          <h1>Edit Product</h1>
        </div>
      </div>

      {/* Status Banner */}
      {renderStatusBanner()}

      {/* Status notice removed — editing allowed at all times */}

      {/* Section 1: Basic Info */}
      <div className="form-card">
        <div className="form-card-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div className="form-card-title">Basic information</div>
            <div className="form-card-subtitle">Name, category, brand, and product descriptions.</div>
          </div>
          {isEditable && (
            <button type="button" onClick={generateWithAI} disabled={aiGenerating || !form.title.trim()}
              style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: aiGenerating ? '#e5e7eb' : 'linear-gradient(135deg, #8b5cf6, #6366f1)', color: aiGenerating ? '#6b7280' : '#fff', border: 'none', borderRadius: 8, cursor: aiGenerating ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              {aiGenerating ? 'Generating...' : '\u2728 Generate with AI'}
            </button>
          )}
        </div>
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
              for variant and non-variant products alike. Read-only. */}
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
              placeholder="Select a category"
              disabled={!isEditable}
            />
            <datalist id="category-list">
              {categories.map(cat => (
                <option key={cat.id} value={cat.name} />
              ))}
            </datalist>
            <span className="form-hint">Select an existing category</span>
            {errors.category && <span className="form-error">{errors.category}</span>}
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
              placeholder="Select a brand"
              disabled={!isEditable}
            />
            <datalist id="brand-list">
              {brands.map(b => (
                <option key={b.id} value={b.name} />
              ))}
            </datalist>
            <span className="form-hint">Select an existing brand</span>
            {errors.brand && <span className="form-error">{errors.brand}</span>}
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

      {/* Phase 39 (2026-05-21) — category-driven metafield section.
          Placed right after BASIC INFORMATION so the seller sees the
          required fields immediately under the title/category picker. */}
      <CategoryMetafieldFormSection
        categoryId={form.categoryId || null}
        values={metafieldValues}
        onChange={setMetafieldValues}
      />

      {/* Section 2: Product Type & Pricing */}
      <div className="form-card">
        <div className="form-card-head">
          <div className="form-card-title">Product type &amp; pricing</div>
          <div className="form-card-subtitle">How this product is sold and priced.</div>
        </div>

        <div className="form-checkbox-group">
          <input
            type="checkbox"
            id="hasVariants"
            checked={form.hasVariants}
            onChange={e => updateField('hasVariants', e.target.checked)}
            disabled={!isEditable}
          />
          <label htmlFor="hasVariants">This product has variants</label>
          <span className="form-hint" style={{ marginLeft: 8 }}>
            {form.hasVariants
              ? '(tick to manage sizes, colours & variants below)'
              : '(tick if this product comes in multiple sizes or colours)'}
          </span>
        </div>

        {form.hasVariants ? (
          <div className="info-box">
            Pricing is managed per variant below. Set the price, stock, and SKU for each variant individually.
          </div>
        ) : (
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">
                Price <span className="required">*</span>
              </label>
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
              {errors.basePrice && <span className="form-error">{errors.basePrice}</span>}
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
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  disabled={!isEditable}
                />
              </div>
              <span className="form-hint">Original price (shown as strikethrough)</span>
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
              <span className="form-hint">For profit calculation (not shown to customers)</span>
            </div>

            <div className="form-group">
              <label className="form-label">SKU</label>
              <input
                type="text"
                className="form-input"
                value={form.baseSku}
                onChange={e => updateField('baseSku', e.target.value)}
                placeholder="Stock keeping unit"
                disabled={!isEditable}
              />
              <span className="form-hint" style={{ color: '#dc2626', fontWeight: 500 }}>
                NOTE: SKU is mandatory if you want to fulfill orders using Shiprocket Shipping.
              </span>
            </div>

            <div className="form-group">
              <label className="form-label">
                Stock <span className="required">*</span>
              </label>
              <input
                type="number"
                className="form-input"
                value={form.baseStock}
                onChange={e => updateField('baseStock', e.target.value)}
                placeholder="0"
                min="0"
                step="1"
                disabled={!isEditable}
              />
              {errors.baseStock && <span className="form-error">{errors.baseStock}</span>}
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

      {/* Variants Section — only shown when this product is marked as having variants */}
      {form.hasVariants && (
      <div className="form-card">
        <div className="form-card-head">
          <div className="form-card-title">Variants</div>
          <div className="form-card-subtitle">Sizes, colours, and other options for this product.</div>
        </div>

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
                            // Replace the last empty value or add new
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
                {sortedVariants.map(variant => {
                  // optionValues may come as nested { optionValue: { value, displayValue, optionDefinition } } or flat
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
      )}

      {/* Images Section (edit only) */}
      <div className="form-card">
        <div className="form-card-head">
          <div className="form-card-title">Images</div>
          <div className="form-card-subtitle">Photos buyers see on the product page.</div>
        </div>

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
            {sortedImages.map((img, idx) => (
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

      {/* Section 3: Shipping */}
      <div className="form-card">
        <div className="form-card-head">
          <div className="form-card-title">Shipping</div>
          <div className="form-card-subtitle">Package weight and dimensions used for delivery.</div>
        </div>
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

      {/* Tax & GST classification is managed by a super-admin per product
          (HSN, GST rate, supply type, cess, UQC) — not editable by sellers. */}

      {/* Section 4: Tags */}
      <div className="form-card">
        <div className="form-card-head">
          <div className="form-card-title">Tags</div>
          <div className="form-card-subtitle">Keywords that help buyers find this product.</div>
        </div>
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

      {/* Section 5: SEO */}
      <div className="form-card">
        <div className="form-card-head">
          <div className="form-card-title">Search engine optimization</div>
          <div className="form-card-subtitle">How this product appears in search results.</div>
        </div>
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

      {/* Section 6: Policy */}
      <div className="form-card">
        <div className="form-card-head">
          <div className="form-card-title">Policies</div>
          <div className="form-card-subtitle">Returns, warranty, and other buyer-facing policies.</div>
        </div>
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

      {/* Action Buttons */}
      {isEditable && (
        <div className="form-actions">
          <button
            type="button"
            className="form-btn"
            onClick={() => handleSave(false)}
            disabled={savingAction !== null || !hasChanges}
            aria-busy={savingAction === 'save'}
          >
            {savingAction === 'save' ? (
              <>
                <span className="btn-spinner" aria-hidden="true" />
                Saving…
              </>
            ) : (
              'Save Changes'
            )}
          </button>
          {canSubmitForReview && (
            <button
              type="button"
              className="form-btn primary"
              onClick={() => handleSave(true)}
              disabled={savingAction !== null}
              aria-busy={savingAction === 'submit'}
            >
              {savingAction === 'submit' ? (
                <>
                  <span className="btn-spinner" aria-hidden="true" />
                  Saving…
                </>
              ) : (
                'Save & Submit for Review'
              )}
            </button>
          )}
        </div>
      )}

      {/* Status history timeline — full audit trail of moderation decisions.
          Lives at the bottom so the editable form is the first thing the
          seller sees; history is reference-only and pushed below. */}
      {Array.isArray(product.statusHistory) && product.statusHistory.length > 0 && (
        <StatusHistoryPanel entries={product.statusHistory} />
      )}

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// StatusHistoryPanel — renders a compact vertical timeline of every
// status transition on this product. Data comes from the backend's
// `statusHistory` relation which is already populated on every
// transition via ProductRepository.*InTransaction helpers.
// ─────────────────────────────────────────────────────────────────

type StatusHistoryEntry = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  changedBy?: string | null;
  reason: string | null;
  createdAt: string | Date;
};

function StatusHistoryPanel({ entries }: { entries: StatusHistoryEntry[] }) {
  // Newest first — the latest decision (e.g. a rejection note telling the
  // seller what to fix) is the most relevant and should lead the timeline.
  const ordered = [...entries].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const palette = (status: string): string => {
    if (['APPROVED', 'ACTIVE'].includes(status)) return '#16a34a';
    if (['REJECTED', 'SUSPENDED', 'ARCHIVED'].includes(status)) return '#dc2626';
    if (['CHANGES_REQUESTED'].includes(status)) return '#d97706';
    if (['SUBMITTED'].includes(status)) return '#2563eb';
    return '#6b7280';
  };

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: '16px 20px',
        marginBottom: 16,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: '#6b7280',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginBottom: 12,
        }}
      >
        Review Timeline
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {ordered.map((e, i) => {
          const color = palette(e.toStatus);
          const isLast = i === ordered.length - 1;
          return (
            <li
              key={e.id}
              style={{ display: 'flex', gap: 12, position: 'relative' }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  flexShrink: 0,
                  paddingTop: 2,
                }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: color,
                    border: '2px solid #fff',
                    boxShadow: `0 0 0 1px ${color}`,
                  }}
                />
                {!isLast && (
                  <div
                    style={{
                      width: 2,
                      flex: 1,
                      background: '#e5e7eb',
                      marginTop: 4,
                      minHeight: 24,
                    }}
                  />
                )}
              </div>
              <div style={{ paddingBottom: isLast ? 0 : 14, flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: '#111827' }}>
                  <span style={{ fontWeight: 600, color }}>
                    {e.toStatus.replace(/_/g, ' ')}
                  </span>
                  {e.fromStatus && (
                    <span style={{ color: '#9ca3af' }}>
                      {' '}
                      &larr; {e.fromStatus.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
                {e.reason && (
                  <div
                    style={{
                      fontSize: 12,
                      color: '#374151',
                      marginTop: 2,
                      lineHeight: 1.5,
                    }}
                  >
                    {e.reason}
                  </div>
                )}
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                  {new Date(e.createdAt).toLocaleString()}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
