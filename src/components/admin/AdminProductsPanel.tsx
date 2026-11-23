import React, { useEffect, useState } from 'react';
import { Check, Edit3, Plus, Trash2, Upload, X } from 'lucide-react';
import type {
  CategoryConfig,
  Language,
  OptionGroup,
  OptionItem,
  Product,
  ProductKind,
  StoreSettings,
} from '../../shared/types.ts';
import { formatIqd, getEffectiveProductPrice } from '../../shared/pricing.ts';
import {
  deleteOptionFromFirestore,
  deleteProductFromFirestore,
  syncOptionToFirestore,
  syncProductToFirestore,
  syncSettingsToFirestore,
} from '../../lib/firestoreCatalogSync.ts';
import { apiUrl } from '../../lib/api.ts';
import { SafeImage } from '../SafeImage.tsx';

interface AdminProductsPanelProps {
  lang: Language;
  adminToken: string;
  products: Product[];
  options: OptionItem[];
  settings: StoreSettings;
  onRefresh: () => Promise<void>;
}

export const AdminProductsPanel: React.FC<AdminProductsPanelProps> = ({
  lang,
  adminToken,
  products,
  options,
  settings,
  onRefresh,
}) => {
  const [rosePriceInput, setRosePriceInput] = useState(String(settings.roseUnitPriceIqd));
  const [maxRosesInput, setMaxRosesInput] = useState(String(settings.maxCustomRoses || 100));
  const [savingPrice, setSavingPrice] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    setRosePriceInput(String(settings.roseUnitPriceIqd));
    setMaxRosesInput(String(settings.maxCustomRoses || 100));
  }, [settings.roseUnitPriceIqd, settings.maxCustomRoses]);

  // Categories management
  const [categories, setCategories] = useState<CategoryConfig[]>(settings.categories || []);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [newCat, setNewCat] = useState({
    id: '',
    kind: 'bouquet' as ProductKind,
    titleAr: '',
    titleEn: '',
    subtitleAr: '',
    subtitleEn: '',
    imageUrl: '/src/assets/images/bouquet_red_velvet_1795361896339.jpg',
    showOnHome: true,
  });

  useEffect(() => {
    setCategories(settings.categories || []);
  }, [settings.categories]);

  // New Product form
  const [newProd, setNewProd] = useState({
    kind: 'bouquet' as ProductKind,
    category: settings.categories?.[0]?.id || 'red_roses',
    categoryAr: settings.categories?.[0]?.titleAr || 'باقات الورد الأحمر',
    nameAr: '',
    nameEn: '',
    descriptionAr: '',
    descriptionEn: '',
    priceIqd: '35000',
    promoPriceIqd: '',
    roseCount: '10',
    stock: '20',
    isFeatured: true,
    isBestSeller: false,
    imageUrl: '/src/assets/images/bouquet_red_velvet_1795361896339.jpg',
  });

  // Editing Product state
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // New Custom Option form
  const [newOpt, setNewOpt] = useState({
    group: 'wrapping' as OptionGroup,
    nameAr: '',
    nameEn: '',
    priceIqd: '5000',
    colorHex: '#8B3F35',
    stock: '100',
    imageUrl: '/src/assets/images/bouquet_ivory_blush_1795361894392.jpg',
  });

  // Editing Option state
  const [editingOption, setEditingOption] = useState<OptionItem | null>(null);

  const handleImageUpload = async (file: File, onUrl: (url: string) => void) => {
    setUploading(true);
    setFeedback('');
    try {
      const form = new FormData();
      form.append('image', file);
      const resp = await fetch(apiUrl('/api/admin/upload'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: form,
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Upload failed');
      onUrl(data.url);
      setFeedback(lang === 'ar' ? 'تم رفع الصورة بنجاح' : 'Image uploaded successfully');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleSaveRosePrice = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPrice(true);
    setFeedback('');
    try {
      const resp = await fetch(apiUrl('/api/admin/settings'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          roseUnitPriceIqd: Number(rosePriceInput),
          maxCustomRoses: Number(maxRosesInput) || 100,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to update rose unit price');
      if (data.settings) {
        void syncSettingsToFirestore(data.settings).catch(() => {});
      }
      await onRefresh();
      setFeedback(lang === 'ar' ? 'تم تحديث سعر الوردة والحد الأقصى بنجاح' : 'Rose unit price and limit updated');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSavingPrice(false);
    }
  };

  const persistCategories = async (nextCategories: CategoryConfig[], msgAr: string, msgEn: string) => {
    setFeedback('');
    const resp = await fetch(apiUrl('/api/admin/settings'), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ categories: nextCategories }),
    });
    const data = await resp.json();
    if (resp.ok) {
      setCategories(nextCategories);
      if (data.settings) {
        void syncSettingsToFirestore(data.settings).catch(() => {});
      }
      await onRefresh();
      setFeedback(lang === 'ar' ? msgAr : msgEn);
    } else {
      setFeedback(data.error || 'Failed to save categories');
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawSlug = (newCat.id.trim() || newCat.titleEn.trim() || `cat_${Date.now()}`)
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const id = rawSlug || `cat_${Date.now()}`;
    if (categories.some((c) => c.id === id)) {
      setFeedback(lang === 'ar' ? 'معرف التصنيف موجود مسبقاً' : 'Category ID already exists');
      return;
    }
    const created: CategoryConfig = {
      id,
      kind: newCat.kind,
      titleAr: newCat.titleAr.trim(),
      titleEn: newCat.titleEn.trim(),
      subtitleAr: newCat.subtitleAr.trim(),
      subtitleEn: newCat.subtitleEn.trim(),
      imageUrl: newCat.imageUrl.trim() || '/src/assets/images/bouquet_red_velvet_1795361896339.jpg',
      isActive: true,
      showOnHome: newCat.showOnHome,
    };
    await persistCategories(
      [...categories, created],
      'تمت إضافة التصنيف بنجاح',
      'Category added successfully'
    );
    setNewCat({
      id: '',
      kind: 'bouquet',
      titleAr: '',
      titleEn: '',
      subtitleAr: '',
      subtitleEn: '',
      imageUrl: '/src/assets/images/bouquet_red_velvet_1795361896339.jpg',
      showOnHome: true,
    });
  };

  const saveProductPayload = async (payload: Record<string, unknown>, msgAr: string, msgEn: string) => {
    setFeedback('');
    const resp = await fetch(apiUrl('/api/admin/products'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setFeedback(data.error || 'Failed to save product');
      return false;
    }
    if (data.product) {
      void syncProductToFirestore(data.product).catch(() => {});
    }
    await onRefresh();
    setFeedback(lang === 'ar' ? msgAr : msgEn);
    return true;
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await saveProductPayload(
      {
        kind: newProd.kind,
        category: newProd.category.trim() || 'general',
        categoryAr: newProd.categoryAr.trim() || newProd.category.trim() || 'عام',
        nameAr: newProd.nameAr.trim(),
        nameEn: newProd.nameEn.trim(),
        descriptionAr: newProd.descriptionAr.trim(),
        descriptionEn: newProd.descriptionEn.trim(),
        priceIqd: Number(newProd.priceIqd) || 0,
        promoPriceIqd: newProd.promoPriceIqd ? Number(newProd.promoPriceIqd) : null,
        roseCount: newProd.kind === 'bouquet' && newProd.roseCount ? Number(newProd.roseCount) : undefined,
        stock: Number(newProd.stock) || 0,
        isAvailable: true,
        isFeatured: newProd.isFeatured,
        isBestSeller: newProd.isBestSeller,
        imageUrl: newProd.imageUrl.trim(),
      },
      'تمت إضافة المنتج بنجاح',
      'Product added successfully'
    );
    if (ok) {
      setNewProd({
        ...newProd,
        nameAr: '',
        nameEn: '',
        descriptionAr: '',
        descriptionEn: '',
        promoPriceIqd: '',
      });
    }
  };

  const handleSaveEditedProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    const ok = await saveProductPayload(
      {
        id: editingProduct.id,
        kind: editingProduct.kind,
        category: editingProduct.category.trim(),
        categoryAr: editingProduct.categoryAr.trim() || editingProduct.category.trim(),
        nameAr: editingProduct.nameAr.trim(),
        nameEn: editingProduct.nameEn.trim(),
        descriptionAr: editingProduct.descriptionAr.trim(),
        descriptionEn: editingProduct.descriptionEn.trim(),
        priceIqd: Math.max(0, Number(editingProduct.priceIqd) || 0),
        promoPriceIqd:
          editingProduct.promoPriceIqd !== null &&
          editingProduct.promoPriceIqd !== undefined &&
          Number(editingProduct.promoPriceIqd) >= 0
            ? Number(editingProduct.promoPriceIqd)
            : null,
        roseCount:
          editingProduct.kind === 'bouquet' && editingProduct.roseCount !== undefined
            ? Number(editingProduct.roseCount)
            : undefined,
        stock: Math.max(0, Number(editingProduct.stock) || 0),
        isAvailable: editingProduct.isAvailable,
        isFeatured: editingProduct.isFeatured,
        isBestSeller: editingProduct.isBestSeller,
        imageUrl: editingProduct.imageUrl.trim(),
      },
      'تم تحديث بيانات المنتج بنجاح',
      'Product details updated'
    );
    if (ok) setEditingProduct(null);
  };

  const handleToggleProductAvail = async (p: Product) => {
    await saveProductPayload(
      { ...p, isAvailable: !p.isAvailable },
      'تم تحديث حالة التوفر',
      'Product availability updated'
    );
  };

  const handleUpdateProductPrice = async (p: Product, newPrice: number) => {
    if (!Number.isFinite(newPrice) || newPrice < 0 || newPrice === p.priceIqd) return;
    await saveProductPayload(
      { ...p, priceIqd: Math.round(newPrice) },
      'تم تحديث سعر المنتج',
      'Product price updated'
    );
  };

  const handleDeleteProduct = async (id: string) => {
    const resp = await fetch(apiUrl(`/api/admin/products/${id}`), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (resp.ok) {
      void deleteProductFromFirestore(id).catch(() => {});
      await onRefresh();
      setFeedback(lang === 'ar' ? 'تم حذف المنتج' : 'Product deleted');
    }
  };

  const saveOptionPayload = async (payload: Record<string, unknown>, msgAr: string, msgEn: string) => {
    setFeedback('');
    const resp = await fetch(apiUrl('/api/admin/options'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setFeedback(data.error || 'Failed to save option');
      return false;
    }
    if (data.option) {
      void syncOptionToFirestore(data.option).catch(() => {});
    }
    await onRefresh();
    setFeedback(lang === 'ar' ? msgAr : msgEn);
    return true;
  };

  const handleCreateOption = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await saveOptionPayload(
      {
        group: newOpt.group,
        nameAr: newOpt.nameAr.trim(),
        nameEn: newOpt.nameEn.trim(),
        priceIqd: Number(newOpt.priceIqd) || 0,
        colorHex: newOpt.group === 'flower_color' ? newOpt.colorHex : undefined,
        stock: Number(newOpt.stock) || 100,
        isAvailable: true,
        imageUrl: newOpt.imageUrl.trim(),
      },
      'تمت إضافة خيار الباقة',
      'Bouquet option added'
    );
    if (ok) {
      setNewOpt({ ...newOpt, nameAr: '', nameEn: '' });
    }
  };

  const handleSaveEditedOption = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOption) return;
    const ok = await saveOptionPayload(
      {
        ...editingOption,
        nameAr: editingOption.nameAr.trim(),
        nameEn: editingOption.nameEn.trim(),
        priceIqd: Math.max(0, Number(editingOption.priceIqd) || 0),
        stock: Math.max(0, Number(editingOption.stock) || 0),
        colorHex: editingOption.group === 'flower_color' ? editingOption.colorHex : undefined,
        imageUrl: editingOption.imageUrl.trim(),
      },
      'تم تحديث خيار الباقة',
      'Bouquet option updated'
    );
    if (ok) setEditingOption(null);
  };

  const handleUpdateOptionPrice = async (opt: OptionItem, newPrice: number) => {
    if (!Number.isFinite(newPrice) || newPrice < 0 || newPrice === opt.priceIqd) return;
    await saveOptionPayload(
      { ...opt, priceIqd: Math.round(newPrice) },
      'تم تحديث سعر الخيار',
      'Option price updated'
    );
  };

  const handleReplaceOptionImage = async (opt: OptionItem, file: File) => {
    await handleImageUpload(file, async (url) => {
      await saveOptionPayload(
        { ...opt, imageUrl: url },
        'تم تحديث صورة الخيار',
        'Option photo updated'
      );
    });
  };

  const handleDeleteOption = async (id: string) => {
    const resp = await fetch(apiUrl(`/api/admin/options/${id}`), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (resp.ok) {
      void deleteOptionFromFirestore(id).catch(() => {});
      await onRefresh();
      setFeedback(lang === 'ar' ? 'تم حذف الخيار' : 'Option deleted');
    }
  };

  return (
    <div className="space-y-10 text-white">
      {feedback && (
        <div className="border border-[#944A5E] bg-[#0E0A0C] px-4 py-3 text-xs text-white">
          {feedback}
        </div>
      )}

      {/* Base Rose Unit Price & Max Roses */}
      <form
        onSubmit={handleSaveRosePrice}
        className="border border-[#944A5E] bg-[#6E2438] p-6 flex flex-wrap items-end justify-between gap-4"
      >
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-white">
            {lang === 'ar' ? 'سعر الوردة الواحدة الأساسي والحد الأقصى (مصمم الباقات)' : 'Base Rose Unit Price & Limit (Custom Builder)'}
          </h3>
          <p className="text-xs text-white/80">
            {lang === 'ar'
              ? 'ينعكس التغيير فوراً على حاسبة الأسعار والتحقق البرمجي في الخادم.'
              : 'Updates client calculator and server-side checkout verification immediately.'}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3 text-xs">
          <div className="space-y-1">
            <label className="block text-white/80">{lang === 'ar' ? 'سعر الوردة (IQD)' : 'Rose Price (IQD)'}</label>
            <input
              type="number"
              min={0}
              step={250}
              value={rosePriceInput}
              onChange={(e) => setRosePriceInput(e.target.value)}
              aria-label="Rose unit price IQD"
              className="w-36 px-3 py-2 border border-[#944A5E] bg-[#461221] text-white text-sm font-bold tabular-nums-en focus:outline-none focus:border-white"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-white/80">{lang === 'ar' ? 'أقصى عدد وردات' : 'Max Roses'}</label>
            <input
              type="number"
              min={1}
              max={500}
              value={maxRosesInput}
              onChange={(e) => setMaxRosesInput(e.target.value)}
              aria-label="Max custom roses"
              className="w-28 px-3 py-2 border border-[#944A5E] bg-[#461221] text-white text-sm font-bold tabular-nums-en focus:outline-none focus:border-white"
            />
          </div>
          <button
            type="submit"
            disabled={savingPrice}
            className="px-5 py-2.5 bg-[#0E0A0C] border border-[#944A5E] text-white text-xs font-medium hover:bg-[#1E1418] transition-colors"
          >
            {savingPrice ? '...' : lang === 'ar' ? 'حفظ السعر' : 'Save Price'}
          </button>
        </div>
      </form>

      {/* Categories Management */}
      <div className="space-y-4 border border-[#944A5E] bg-[#6E2438] p-6">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-white">
            {lang === 'ar' ? 'إدارة التصنيفات وصور الرئيسية' : 'Categories & Homepage Category Cards'}
          </h3>
          <p className="text-xs text-white/80">
            {lang === 'ar'
              ? 'تحكم بأسماء التصنيفات، أوصافها، صورها، وظهورها في الصفحة الرئيسية.'
              : 'Edit category titles, subtitles, images, and homepage visibility.'}
          </p>
        </div>

        <form onSubmit={handleCreateCategory} className="border border-[#944A5E] bg-[#461221] p-4 space-y-3 text-xs">
          <div className="font-semibold text-white">
            {lang === 'ar' ? 'إضافة تصنيف جديد' : 'Add New Category'}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <select
              value={newCat.kind}
              onChange={(e) => setNewCat({ ...newCat, kind: e.target.value as ProductKind })}
              className="px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white"
            >
              <option value="bouquet">{lang === 'ar' ? 'قسم الباقات' : 'Bouquets Section'}</option>
              <option value="gift">{lang === 'ar' ? 'قسم الهدايا' : 'Gifts Section'}</option>
            </select>
            <input
              required
              placeholder={lang === 'ar' ? 'اسم التصنيف (عربي)' : 'Title (AR)'}
              value={newCat.titleAr}
              onChange={(e) => setNewCat({ ...newCat, titleAr: e.target.value })}
              className="px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white placeholder:text-white/45"
            />
            <input
              required
              placeholder={lang === 'ar' ? 'اسم التصنيف (إنجليزي)' : 'Title (EN)'}
              value={newCat.titleEn}
              onChange={(e) => setNewCat({ ...newCat, titleEn: e.target.value })}
              className="px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white placeholder:text-white/45"
            />
            <input
              placeholder={lang === 'ar' ? 'وصف فرعي (عربي)' : 'Subtitle (AR)'}
              value={newCat.subtitleAr}
              onChange={(e) => setNewCat({ ...newCat, subtitleAr: e.target.value })}
              className="px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white placeholder:text-white/45"
            />
            <input
              placeholder={lang === 'ar' ? 'وصف فرعي (إنجليزي)' : 'Subtitle (EN)'}
              value={newCat.subtitleEn}
              onChange={(e) => setNewCat({ ...newCat, subtitleEn: e.target.value })}
              className="px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white placeholder:text-white/45"
            />
            <input
              placeholder={lang === 'ar' ? 'المعرّف البرمجي (اختياري مثال: wedding)' : 'Slug ID (optional)'}
              dir="ltr"
              value={newCat.id}
              onChange={(e) => setNewCat({ ...newCat, id: e.target.value })}
              className="px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white placeholder:text-white/45"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 px-3 py-2 border border-[#944A5E] bg-[#0E0A0C] text-white cursor-pointer hover:border-white">
              <Upload className="w-3.5 h-3.5" />
              <span>{lang === 'ar' ? 'رفع صورة' : 'Upload Photo'}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImageUpload(f, (url) => setNewCat({ ...newCat, imageUrl: url }));
                }}
              />
            </label>
            <input
              dir="ltr"
              placeholder="Image URL"
              value={newCat.imageUrl}
              onChange={(e) => setNewCat({ ...newCat, imageUrl: e.target.value })}
              className="flex-1 min-w-[200px] px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white"
            />
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={newCat.showOnHome}
                onChange={(e) => setNewCat({ ...newCat, showOnHome: e.target.checked })}
                className="accent-[#0E0A0C]"
              />
              <span>{lang === 'ar' ? 'إظهار بالرئيسية' : 'Show on Home'}</span>
            </label>
            <button type="submit" className="px-4 py-2 bg-[#0E0A0C] border border-[#944A5E] text-white font-medium hover:border-white">
              {lang === 'ar' ? 'إضافة التصنيف' : 'Add Category'}
            </button>
          </div>
        </form>

        <div className="border border-[#944A5E] divide-y divide-[#944A5E] bg-[#461221]">
          {categories.map((cat, idx) => {
            const isEditing = editingCatId === cat.id;
            return (
              <div key={cat.id} className="p-3.5 space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 border border-[#944A5E] bg-[#5E1D2F] overflow-hidden shrink-0">
                      <SafeImage src={cat.imageUrl} alt={cat.titleEn} />
                    </div>
                    <div>
                      <div className="font-bold text-white">
                        {lang === 'ar' ? cat.titleAr : cat.titleEn}{' '}
                        <span className="text-white/60 font-normal" dir="ltr">({cat.id})</span>
                      </div>
                      <div className="text-white/75">
                        {lang === 'ar' ? cat.subtitleAr : cat.subtitleEn} ·{' '}
                        {cat.showOnHome
                          ? lang === 'ar'
                            ? 'ظاهر بالرئيسية'
                            : 'On Home'
                          : lang === 'ar'
                            ? 'فلتر الكتالوج فقط'
                            : 'Catalog Only'}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingCatId(isEditing ? null : cat.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 border border-[#944A5E] bg-[#6E2438] text-white hover:border-white"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>{isEditing ? (lang === 'ar' ? 'إغلاق' : 'Close') : lang === 'ar' ? 'تعديل' : 'Edit'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const updated = categories.filter((c) => c.id !== cat.id);
                        void persistCategories(updated, 'تم حذف التصنيف', 'Category deleted');
                      }}
                      aria-label={`Delete category ${cat.titleEn}`}
                      className="p-1.5 text-white/75 hover:text-white"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {isEditing && (
                  <div className="border-t border-[#944A5E] pt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <select
                      value={cat.kind}
                      onChange={(e) => {
                        const next = [...categories];
                        next[idx] = { ...cat, kind: e.target.value as ProductKind };
                        setCategories(next);
                      }}
                      className="px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white"
                    >
                      <option value="bouquet">{lang === 'ar' ? 'باقات' : 'Bouquet'}</option>
                      <option value="gift">{lang === 'ar' ? 'هدايا' : 'Gift'}</option>
                    </select>
                    <input
                      value={cat.titleAr}
                      onChange={(e) => {
                        const next = [...categories];
                        next[idx] = { ...cat, titleAr: e.target.value };
                        setCategories(next);
                      }}
                      placeholder="Title AR"
                      className="px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white"
                    />
                    <input
                      value={cat.titleEn}
                      onChange={(e) => {
                        const next = [...categories];
                        next[idx] = { ...cat, titleEn: e.target.value };
                        setCategories(next);
                      }}
                      placeholder="Title EN"
                      className="px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white"
                    />
                    <input
                      value={cat.subtitleAr}
                      onChange={(e) => {
                        const next = [...categories];
                        next[idx] = { ...cat, subtitleAr: e.target.value };
                        setCategories(next);
                      }}
                      placeholder="Subtitle AR"
                      className="px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white"
                    />
                    <input
                      value={cat.subtitleEn}
                      onChange={(e) => {
                        const next = [...categories];
                        next[idx] = { ...cat, subtitleEn: e.target.value };
                        setCategories(next);
                      }}
                      placeholder="Subtitle EN"
                      className="px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white"
                    />
                    <div className="flex items-center gap-2">
                      <input
                        dir="ltr"
                        value={cat.imageUrl}
                        onChange={(e) => {
                          const next = [...categories];
                          next[idx] = { ...cat, imageUrl: e.target.value };
                          setCategories(next);
                        }}
                        placeholder="Image URL"
                        className="flex-1 px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white"
                      />
                      <label className="px-2.5 py-2 border border-[#944A5E] bg-[#0E0A0C] cursor-pointer hover:border-white">
                        <Upload className="w-3.5 h-3.5" />
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) {
                              void handleImageUpload(f, (url) => {
                                const next = [...categories];
                                next[idx] = { ...cat, imageUrl: url };
                                setCategories(next);
                              });
                            }
                          }}
                        />
                      </label>
                    </div>
                    <div className="sm:col-span-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-4">
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={cat.showOnHome}
                            onChange={(e) => {
                              const next = [...categories];
                              next[idx] = { ...cat, showOnHome: e.target.checked };
                              setCategories(next);
                            }}
                            className="accent-[#0E0A0C]"
                          />
                          <span>{lang === 'ar' ? 'إظهار بالصفحة الرئيسية' : 'Show on Home'}</span>
                        </label>
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={cat.isActive}
                            onChange={(e) => {
                              const next = [...categories];
                              next[idx] = { ...cat, isActive: e.target.checked };
                              setCategories(next);
                            }}
                            className="accent-[#0E0A0C]"
                          />
                          <span>{lang === 'ar' ? 'مفعّل' : 'Active'}</span>
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingCatId(null);
                          void persistCategories(categories, 'تم حفظ تعديلات التصنيف', 'Category updated');
                        }}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0E0A0C] border border-white text-white font-medium"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{lang === 'ar' ? 'حفظ التصنيف' : 'Save Category'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Add New Ready-Made Product */}
      <form onSubmit={handleCreateProduct} className="border border-[#944A5E] bg-[#6E2438] p-6 space-y-4">
        <h3 className="text-base font-semibold text-white flex items-center gap-2">
          <Plus className="w-4 h-4 text-white" />
          <span>{lang === 'ar' ? 'إضافة منتج أو باقة جاهزة' : 'Add Ready-Made Product or Gift'}</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <select
            value={newProd.kind}
            onChange={(e) => setNewProd({ ...newProd, kind: e.target.value as ProductKind })}
            className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
          >
            <option value="bouquet">{lang === 'ar' ? 'باقة ورد' : 'Bouquet'}</option>
            <option value="gift">{lang === 'ar' ? 'هدية / إكسسوار' : 'Gift / Accessory'}</option>
          </select>
          <select
            value={newProd.category}
            onChange={(e) => {
              const found = categories.find((c) => c.id === e.target.value);
              setNewProd({
                ...newProd,
                category: e.target.value,
                categoryAr: found?.titleAr || newProd.categoryAr,
              });
            }}
            className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {lang === 'ar' ? c.titleAr : c.titleEn} ({c.id})
              </option>
            ))}
          </select>
          <input
            required
            placeholder={lang === 'ar' ? 'اسم التصنيف بالعربي' : 'Category Name (AR)'}
            value={newProd.categoryAr}
            onChange={(e) => setNewProd({ ...newProd, categoryAr: e.target.value })}
            className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45"
          />
          <input
            required
            placeholder={lang === 'ar' ? 'الاسم بالعربية' : 'Arabic Name'}
            value={newProd.nameAr}
            onChange={(e) => setNewProd({ ...newProd, nameAr: e.target.value })}
            className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45"
          />
          <input
            required
            placeholder={lang === 'ar' ? 'الاسم بالإنجليزية' : 'English Name'}
            value={newProd.nameEn}
            onChange={(e) => setNewProd({ ...newProd, nameEn: e.target.value })}
            className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45"
          />
          <input
            type="number"
            placeholder={lang === 'ar' ? 'عدد الوردات (اختياري)' : 'Rose Count (optional)'}
            value={newProd.roseCount}
            onChange={(e) => setNewProd({ ...newProd, roseCount: e.target.value })}
            className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45 tabular-nums-en"
          />
          <input
            required
            type="number"
            placeholder={lang === 'ar' ? 'السعر (IQD)' : 'Price (IQD)'}
            value={newProd.priceIqd}
            onChange={(e) => setNewProd({ ...newProd, priceIqd: e.target.value })}
            className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45 tabular-nums-en"
          />
          <input
            type="number"
            placeholder={lang === 'ar' ? 'سعر الخصم (اختياري)' : 'Discount Price (optional)'}
            value={newProd.promoPriceIqd}
            onChange={(e) => setNewProd({ ...newProd, promoPriceIqd: e.target.value })}
            className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45 tabular-nums-en"
          />
          <input
            required
            type="number"
            placeholder={lang === 'ar' ? 'المخزون' : 'Stock Qty'}
            value={newProd.stock}
            onChange={(e) => setNewProd({ ...newProd, stock: e.target.value })}
            className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45 tabular-nums-en"
          />
          <textarea
            rows={2}
            placeholder={lang === 'ar' ? 'الوصف بالعربية' : 'Description (AR)'}
            value={newProd.descriptionAr}
            onChange={(e) => setNewProd({ ...newProd, descriptionAr: e.target.value })}
            className="sm:col-span-3 px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45"
          />
          <textarea
            rows={2}
            placeholder={lang === 'ar' ? 'الوصف بالإنجليزية' : 'Description (EN)'}
            value={newProd.descriptionEn}
            onChange={(e) => setNewProd({ ...newProd, descriptionEn: e.target.value })}
            className="sm:col-span-3 px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45"
          />
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <label className="inline-flex items-center gap-2 px-4 py-2 border border-[#944A5E] bg-[#461221] text-white cursor-pointer hover:border-white transition-colors">
            <Upload className="w-4 h-4 text-white" />
            <span>{uploading ? '...' : lang === 'ar' ? 'رفع صورة المنتج' : 'Upload Product Photo'}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImageUpload(file, (url) => setNewProd({ ...newProd, imageUrl: url }));
              }}
            />
          </label>
          <input
            dir="ltr"
            value={newProd.imageUrl}
            onChange={(e) => setNewProd({ ...newProd, imageUrl: e.target.value })}
            placeholder="Image URL"
            className="flex-1 min-w-[200px] px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
          />
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={newProd.isFeatured}
              onChange={(e) => setNewProd({ ...newProd, isFeatured: e.target.checked })}
              className="accent-[#0E0A0C]"
            />
            <span>{lang === 'ar' ? 'مميز بالرئيسية' : 'Featured'}</span>
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={newProd.isBestSeller}
              onChange={(e) => setNewProd({ ...newProd, isBestSeller: e.target.checked })}
              className="accent-[#0E0A0C]"
            />
            <span>{lang === 'ar' ? 'الأكثر مبيعاً' : 'Best Seller'}</span>
          </label>
          <button
            type="submit"
            className="ms-auto px-5 py-2 bg-[#0E0A0C] border border-[#944A5E] text-white font-medium hover:bg-[#1E1418] transition-colors"
          >
            {lang === 'ar' ? 'حفظ المنتج' : 'Save Product'}
          </button>
        </div>
      </form>

      {/* Existing Products Table with Full Editor */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-white">
          {lang === 'ar' ? 'إدارة المنتجات والأسعار والخصومات والصور' : 'Products, Prices, Discounts & Photos'}
        </h3>
        <div className="border border-[#944A5E] divide-y divide-[#944A5E] bg-[#6E2438]">
          {products.map((p) => {
            const isEditing = editingProduct?.id === p.id;
            const effective = getEffectiveProductPrice(p);
            const hasPromo = effective < p.priceIqd;
            return (
              <div key={p.id} className="p-4 space-y-4 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-[220px]">
                    <div className="w-14 h-14 bg-[#461221] border border-[#944A5E] shrink-0 overflow-hidden">
                      <SafeImage src={p.imageUrl} alt={p.nameEn} />
                    </div>
                    <div>
                      <div className="font-bold text-sm text-white">
                        {lang === 'ar' ? p.nameAr : p.nameEn}
                      </div>
                      <div className="text-white/75 tabular-nums-en">
                        {formatIqd(effective, lang)}
                        {hasPromo ? ` (Was ${formatIqd(p.priceIqd, 'en')})` : ''} · Stock: {p.stock} ·{' '}
                        {lang === 'ar' ? p.categoryAr : p.category}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <label className="px-3 py-1.5 border border-[#944A5E] bg-[#461221] text-white cursor-pointer hover:border-white transition-colors">
                      <span>{lang === 'ar' ? 'تغيير الصورة' : 'Replace Image'}</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) {
                            void handleImageUpload(f, async (url) => {
                              await saveProductPayload(
                                { ...p, imageUrl: url },
                                'تم تحديث صورة المنتج',
                                'Product photo updated'
                              );
                            });
                          }
                        }}
                      />
                    </label>

                    <input
                      type="number"
                      defaultValue={p.priceIqd}
                      key={`${p.id}-${p.priceIqd}`}
                      onBlur={(e) => void handleUpdateProductPrice(p, Number(e.target.value))}
                      aria-label={`Price for ${p.nameEn}`}
                      className="w-24 px-2 py-1.5 border border-[#944A5E] bg-[#461221] text-white tabular-nums-en"
                    />

                    <button
                      type="button"
                      onClick={() => setEditingProduct(isEditing ? null : { ...p })}
                      className="inline-flex items-center gap-1 px-3 py-1.5 border border-[#944A5E] bg-[#461221] text-white hover:border-white transition-colors"
                    >
                      {isEditing ? <X className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
                      <span>{isEditing ? (lang === 'ar' ? 'إلغاء' : 'Cancel') : lang === 'ar' ? 'تعديل كامل' : 'Edit All'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleToggleProductAvail(p)}
                      className={`px-3 py-1.5 border transition-colors ${
                        p.isAvailable
                          ? 'border-white bg-[#0E0A0C] text-white'
                          : 'border-[#944A5E] bg-[#461221] text-white/60'
                      }`}
                    >
                      {p.isAvailable
                        ? lang === 'ar'
                          ? 'متوفر'
                          : 'Active'
                        : lang === 'ar'
                          ? 'معطل'
                          : 'Hidden'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteProduct(p.id)}
                      aria-label={`Delete ${p.nameEn}`}
                      className="p-1.5 text-white/75 hover:text-white transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {isEditing && editingProduct && (
                  <form
                    onSubmit={handleSaveEditedProduct}
                    className="border border-[#944A5E] bg-[#461221] p-4 space-y-3"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <label className="text-white/80">{lang === 'ar' ? 'النوع' : 'Kind'}</label>
                        <select
                          value={editingProduct.kind}
                          onChange={(e) =>
                            setEditingProduct({ ...editingProduct, kind: e.target.value as ProductKind })
                          }
                          className="w-full px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white"
                        >
                          <option value="bouquet">{lang === 'ar' ? 'باقة ورد' : 'Bouquet'}</option>
                          <option value="gift">{lang === 'ar' ? 'هدية' : 'Gift'}</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-white/80">{lang === 'ar' ? 'معرف التصنيف' : 'Category Key'}</label>
                        <input
                          required
                          value={editingProduct.category}
                          onChange={(e) =>
                            setEditingProduct({ ...editingProduct, category: e.target.value })
                          }
                          className="w-full px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-white/80">{lang === 'ar' ? 'اسم التصنيف (AR)' : 'Category Label (AR)'}</label>
                        <input
                          required
                          value={editingProduct.categoryAr}
                          onChange={(e) =>
                            setEditingProduct({ ...editingProduct, categoryAr: e.target.value })
                          }
                          className="w-full px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-white/80">{lang === 'ar' ? 'اسم المنتج (عربي)' : 'Name (AR)'}</label>
                        <input
                          required
                          value={editingProduct.nameAr}
                          onChange={(e) =>
                            setEditingProduct({ ...editingProduct, nameAr: e.target.value })
                          }
                          className="w-full px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-white/80">{lang === 'ar' ? 'اسم المنتج (إنجليزي)' : 'Name (EN)'}</label>
                        <input
                          required
                          value={editingProduct.nameEn}
                          onChange={(e) =>
                            setEditingProduct({ ...editingProduct, nameEn: e.target.value })
                          }
                          className="w-full px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-white/80">{lang === 'ar' ? 'عدد الوردات' : 'Rose Count'}</label>
                        <input
                          type="number"
                          min={0}
                          value={editingProduct.roseCount ?? ''}
                          onChange={(e) =>
                            setEditingProduct({
                              ...editingProduct,
                              roseCount: e.target.value ? Number(e.target.value) : undefined,
                            })
                          }
                          className="w-full px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white tabular-nums-en"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-white/80">{lang === 'ar' ? 'السعر الأصلي (IQD)' : 'Regular Price (IQD)'}</label>
                        <input
                          required
                          type="number"
                          min={0}
                          value={editingProduct.priceIqd}
                          onChange={(e) =>
                            setEditingProduct({ ...editingProduct, priceIqd: Number(e.target.value) || 0 })
                          }
                          className="w-full px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white tabular-nums-en"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-white/80">
                          {lang === 'ar' ? 'سعر الخصم (اتركه فارغاً لإلغاء الخصم)' : 'Promo/Discount Price (blank = none)'}
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={editingProduct.promoPriceIqd ?? ''}
                          onChange={(e) =>
                            setEditingProduct({
                              ...editingProduct,
                              promoPriceIqd: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          className="w-full px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white tabular-nums-en"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-white/80">{lang === 'ar' ? 'الكمية بالمخزون' : 'Stock'}</label>
                        <input
                          required
                          type="number"
                          min={0}
                          value={editingProduct.stock}
                          onChange={(e) =>
                            setEditingProduct({ ...editingProduct, stock: Number(e.target.value) || 0 })
                          }
                          className="w-full px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white tabular-nums-en"
                        />
                      </div>
                      <div className="sm:col-span-3 space-y-1">
                        <label className="text-white/80">{lang === 'ar' ? 'الوصف بالعربية' : 'Description (AR)'}</label>
                        <textarea
                          rows={2}
                          value={editingProduct.descriptionAr}
                          onChange={(e) =>
                            setEditingProduct({ ...editingProduct, descriptionAr: e.target.value })
                          }
                          className="w-full px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white"
                        />
                      </div>
                      <div className="sm:col-span-3 space-y-1">
                        <label className="text-white/80">{lang === 'ar' ? 'الوصف بالإنجليزية' : 'Description (EN)'}</label>
                        <textarea
                          rows={2}
                          value={editingProduct.descriptionEn}
                          onChange={(e) =>
                            setEditingProduct({ ...editingProduct, descriptionEn: e.target.value })
                          }
                          className="w-full px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white"
                        />
                      </div>
                      <div className="sm:col-span-3 space-y-1">
                        <label className="text-white/80">{lang === 'ar' ? 'رابط الصورة أو رفع صورة جديدة' : 'Image URL or Upload'}</label>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            dir="ltr"
                            required
                            value={editingProduct.imageUrl}
                            onChange={(e) =>
                              setEditingProduct({ ...editingProduct, imageUrl: e.target.value })
                            }
                            className="flex-1 min-w-[200px] px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white"
                          />
                          <label className="inline-flex items-center gap-1.5 px-3 py-2 border border-[#944A5E] bg-[#0E0A0C] cursor-pointer hover:border-white">
                            <Upload className="w-3.5 h-3.5" />
                            <span>{lang === 'ar' ? 'رفع' : 'Upload'}</span>
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) {
                                  void handleImageUpload(f, (url) =>
                                    setEditingProduct((prev) => (prev ? { ...prev, imageUrl: url } : prev))
                                  );
                                }
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#944A5E]">
                      <div className="flex flex-wrap items-center gap-4">
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editingProduct.isAvailable}
                            onChange={(e) =>
                              setEditingProduct({ ...editingProduct, isAvailable: e.target.checked })
                            }
                            className="accent-[#0E0A0C]"
                          />
                          <span>{lang === 'ar' ? 'متوفر' : 'Available'}</span>
                        </label>
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editingProduct.isFeatured}
                            onChange={(e) =>
                              setEditingProduct({ ...editingProduct, isFeatured: e.target.checked })
                            }
                            className="accent-[#0E0A0C]"
                          />
                          <span>{lang === 'ar' ? 'مميز بالرئيسية' : 'Featured'}</span>
                        </label>
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editingProduct.isBestSeller}
                            onChange={(e) =>
                              setEditingProduct({ ...editingProduct, isBestSeller: e.target.checked })
                            }
                            className="accent-[#0E0A0C]"
                          />
                          <span>{lang === 'ar' ? 'الأكثر مبيعاً' : 'Best Seller'}</span>
                        </label>
                      </div>

                      <button
                        type="submit"
                        className="inline-flex items-center gap-1.5 px-5 py-2 bg-[#0E0A0C] border border-white text-white font-medium hover:bg-[#1E1418]"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{lang === 'ar' ? 'حفظ التعديلات' : 'Save Changes'}</span>
                      </button>
                    </div>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Custom Bouquet Options Management */}
      <div className="space-y-4">
        <h3 className="text-base font-semibold text-white">
          {lang === 'ar'
            ? 'خيارات مصمم الباقات (الأنواع، الألوان، التغليف، التنسيق، الهدايا)'
            : 'Custom Bouquet Options (Varieties, Colors, Wrapping, Arrangements, Gifts)'}
        </h3>

        <form onSubmit={handleCreateOption} className="border border-[#944A5E] bg-[#6E2438] p-4 space-y-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            <select
              value={newOpt.group}
              onChange={(e) => setNewOpt({ ...newOpt, group: e.target.value as OptionGroup })}
              className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
            >
              <option value="flower_type">Flower Type</option>
              <option value="flower_color">Flower Color</option>
              <option value="wrapping">Wrapping</option>
              <option value="arrangement">Arrangement</option>
              <option value="gift">Gift Add-on</option>
            </select>
            <input
              required
              placeholder={lang === 'ar' ? 'الاسم بالعربية' : 'Arabic Name'}
              value={newOpt.nameAr}
              onChange={(e) => setNewOpt({ ...newOpt, nameAr: e.target.value })}
              className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45"
            />
            <input
              required
              placeholder={lang === 'ar' ? 'الاسم بالإنجليزية' : 'English Name'}
              value={newOpt.nameEn}
              onChange={(e) => setNewOpt({ ...newOpt, nameEn: e.target.value })}
              className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45"
            />
            <input
              required
              type="number"
              placeholder="Price IQD"
              value={newOpt.priceIqd}
              onChange={(e) => setNewOpt({ ...newOpt, priceIqd: e.target.value })}
              className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45 tabular-nums-en"
            />
            <input
              required
              type="number"
              placeholder={lang === 'ar' ? 'المخزون' : 'Stock'}
              value={newOpt.stock}
              onChange={(e) => setNewOpt({ ...newOpt, stock: e.target.value })}
              className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45 tabular-nums-en"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5 px-3 py-2 border border-[#944A5E] bg-[#461221] cursor-pointer hover:border-white">
              <Upload className="w-3.5 h-3.5" />
              <span>{lang === 'ar' ? 'رفع صورة الخيار' : 'Upload Photo'}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImageUpload(f, (url) => setNewOpt({ ...newOpt, imageUrl: url }));
                }}
              />
            </label>
            <input
              dir="ltr"
              value={newOpt.imageUrl}
              onChange={(e) => setNewOpt({ ...newOpt, imageUrl: e.target.value })}
              placeholder="Image URL"
              className="flex-1 min-w-[180px] px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
            />
            {newOpt.group === 'flower_color' && (
              <input
                type="color"
                value={newOpt.colorHex}
                onChange={(e) => setNewOpt({ ...newOpt, colorHex: e.target.value })}
                aria-label="Flower color swatch"
                className="w-10 h-9 border border-[#944A5E] bg-[#461221] cursor-pointer"
              />
            )}
            <button type="submit" className="px-4 py-2 bg-[#0E0A0C] border border-[#944A5E] text-white font-medium hover:bg-[#1E1418] transition-colors">
              {lang === 'ar' ? 'إضافة خيار' : 'Add Option'}
            </button>
          </div>
        </form>

        <div className="border border-[#944A5E] divide-y divide-[#944A5E] bg-[#6E2438]">
          {options.map((opt) => {
            const isEditing = editingOption?.id === opt.id;
            return (
              <div key={opt.id} className="p-3.5 space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 bg-[#461221] border border-[#944A5E] overflow-hidden shrink-0">
                      <SafeImage src={opt.imageUrl} alt={opt.nameEn} />
                    </div>
                    <div>
                      <div className="font-semibold text-white">
                        {lang === 'ar' ? opt.nameAr : opt.nameEn}
                      </div>
                      <div className="text-white/75">
                        {opt.group} · <span className="tabular-nums-en">{formatIqd(opt.priceIqd, lang)}</span> · Stock: {opt.stock}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="px-2.5 py-1 border border-[#944A5E] bg-[#461221] text-white cursor-pointer hover:border-white transition-colors">
                      <span>{lang === 'ar' ? 'صورة' : 'Photo'}</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleReplaceOptionImage(opt, f);
                        }}
                      />
                    </label>
                    <input
                      type="number"
                      defaultValue={opt.priceIqd}
                      key={`${opt.id}-${opt.priceIqd}`}
                      onBlur={(e) => void handleUpdateOptionPrice(opt, Number(e.target.value))}
                      aria-label={`Option price for ${opt.nameEn}`}
                      className="w-24 px-2 py-1 border border-[#944A5E] bg-[#461221] text-white tabular-nums-en"
                    />
                    <button
                      type="button"
                      onClick={() => setEditingOption(isEditing ? null : { ...opt })}
                      className="inline-flex items-center gap-1 px-2.5 py-1 border border-[#944A5E] bg-[#461221] text-white hover:border-white"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>{isEditing ? (lang === 'ar' ? 'إغلاق' : 'Close') : lang === 'ar' ? 'تعديل' : 'Edit'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteOption(opt.id)}
                      aria-label={`Delete option ${opt.nameEn}`}
                      className="p-1 text-white/75 hover:text-white transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {isEditing && editingOption && (
                  <form
                    onSubmit={handleSaveEditedOption}
                    className="border border-[#944A5E] bg-[#461221] p-3 grid grid-cols-1 sm:grid-cols-3 gap-3"
                  >
                    <input
                      required
                      value={editingOption.nameAr}
                      onChange={(e) => setEditingOption({ ...editingOption, nameAr: e.target.value })}
                      placeholder="Name AR"
                      className="px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white"
                    />
                    <input
                      required
                      value={editingOption.nameEn}
                      onChange={(e) => setEditingOption({ ...editingOption, nameEn: e.target.value })}
                      placeholder="Name EN"
                      className="px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white"
                    />
                    <input
                      required
                      type="number"
                      min={0}
                      value={editingOption.priceIqd}
                      onChange={(e) =>
                        setEditingOption({ ...editingOption, priceIqd: Number(e.target.value) || 0 })
                      }
                      placeholder="Price IQD"
                      className="px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white tabular-nums-en"
                    />
                    <input
                      required
                      type="number"
                      min={0}
                      value={editingOption.stock}
                      onChange={(e) =>
                        setEditingOption({ ...editingOption, stock: Number(e.target.value) || 0 })
                      }
                      placeholder="Stock"
                      className="px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white tabular-nums-en"
                    />
                    <input
                      dir="ltr"
                      required
                      value={editingOption.imageUrl}
                      onChange={(e) => setEditingOption({ ...editingOption, imageUrl: e.target.value })}
                      placeholder="Image URL"
                      className="px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editingOption.isAvailable}
                          onChange={(e) =>
                            setEditingOption({ ...editingOption, isAvailable: e.target.checked })
                          }
                          className="accent-[#0E0A0C]"
                        />
                        <span>{lang === 'ar' ? 'متاح' : 'Available'}</span>
                      </label>
                      {editingOption.group === 'flower_color' && (
                        <input
                          type="color"
                          value={editingOption.colorHex || '#8B3F35'}
                          onChange={(e) =>
                            setEditingOption({ ...editingOption, colorHex: e.target.value })
                          }
                          className="w-8 h-8 border border-[#944A5E] bg-[#5E1D2F] cursor-pointer"
                        />
                      )}
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1 px-4 py-1.5 bg-[#0E0A0C] border border-white text-white font-medium"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{lang === 'ar' ? 'حفظ' : 'Save'}</span>
                      </button>
                    </div>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
