import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { Language, Product, ProductKind, StoreSettings } from '../shared/types.ts';
import { formatIqd, getEffectiveProductPrice } from '../shared/pricing.ts';
import { UI_COPY } from '../i18n/translations.ts';
import { SafeImage } from './SafeImage.tsx';

interface CatalogSectionProps {
  lang: Language;
  products: Product[];
  settings?: StoreSettings;
  mode: ProductKind | 'all';
  selectedCategory: string;
  onSelectCategory: (cat: string) => void;
  onAddToCart: (product: Product) => void;
  onOpenBuilder: () => void;
}

export const CatalogSection: React.FC<CatalogSectionProps> = ({
  lang,
  products,
  settings,
  mode,
  selectedCategory,
  onSelectCategory,
  onAddToCart,
  onOpenBuilder,
}) => {
  const [query, setQuery] = useState('');
  const t = UI_COPY[lang];

  const categories = useMemo(() => {
    const configuredMap = new Map(
      (settings?.categories || [])
        .filter((c) => c.isActive)
        .map((c) => [c.id, lang === 'ar' ? c.titleAr : c.titleEn])
    );
    const base = products.filter((p) => (mode === 'all' ? true : p.kind === mode));
    const map: Record<string, string> = {};
    for (const p of base) {
      map[p.category] = configuredMap.get(p.category) || (lang === 'ar' ? p.categoryAr : p.category);
    }
    return Object.entries(map);
  }, [products, settings?.categories, mode, lang]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (mode !== 'all' && p.kind !== mode) return false;
      if (selectedCategory !== 'all' && p.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        p.nameAr.toLowerCase().includes(q) ||
        p.nameEn.toLowerCase().includes(q) ||
        p.descriptionAr.toLowerCase().includes(q) ||
        p.descriptionEn.toLowerCase().includes(q)
      );
    });
  }, [products, mode, selectedCategory, query]);

  const heading =
    mode === 'gift'
      ? t.giftsAndAccessories
      : lang === 'ar'
        ? 'الباقات الجاهزة والتصنيفات'
        : 'Ready-Made Bouquets & Categories';

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#944A5E] pb-6">
        <div className="space-y-1">
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-white">
            {heading}
          </h1>
          <p className="text-sm text-white/80">
            {lang === 'ar'
              ? 'جميع الأسعار محدثة بالدينار العراقي ويمكنك إضافة أي باقة للسلة مباشرة.'
              : 'All prices in Iraqi Dinars (IQD) with live stock availability.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-white/60 absolute top-1/2 -translate-y-1/2 start-3" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={lang === 'ar' ? 'ابحث عن باقة أو هدية...' : 'Search bouquets or gifts...'}
              aria-label={lang === 'ar' ? 'بحث في المنتجات' : 'Search products'}
              className="ps-9 pe-4 py-2 border border-[#944A5E] bg-[#461221] text-sm text-white placeholder:text-white/55 focus:outline-none focus:border-white w-64"
            />
          </div>
          {mode !== 'gift' && (
            <button
              type="button"
              onClick={onOpenBuilder}
              className="px-4 py-2 bg-[#0E0A0C] text-white border border-[#944A5E] text-xs sm:text-sm font-medium hover:bg-[#1E1418] transition-colors whitespace-nowrap shrink-0"
            >
              {t.designYourBouquet}
            </button>
          )}
        </div>
      </div>

      {/* Interactive Category Segmented Filter */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onSelectCategory('all')}
          className={`px-4 py-2 text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
            selectedCategory === 'all'
              ? 'bg-[#0E0A0C] text-white border-white'
              : 'bg-[#6E2438] text-white/85 border-[#944A5E] hover:border-white/70'
          }`}
        >
          {lang === 'ar' ? 'الكل' : 'All'}
        </button>
        {categories.map(([catId, label]) => (
          <button
            key={catId}
            type="button"
            onClick={() => onSelectCategory(catId)}
            className={`px-4 py-2 text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
              selectedCategory === catId
                ? 'bg-[#0E0A0C] text-white border-white'
                : 'bg-[#6E2438] text-white/85 border-[#944A5E] hover:border-white/70'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="border border-[#944A5E] bg-[#6E2438] p-12 text-center space-y-3">
          <p className="text-base font-medium text-white">
            {lang === 'ar' ? 'لا توجد منتجات مطابقة لبحثك.' : 'No matching products found.'}
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery('');
              onSelectCategory('all');
            }}
            className="px-5 py-2 border border-[#944A5E] bg-[#0E0A0C] text-white text-xs font-medium hover:border-white"
          >
            {lang === 'ar' ? 'إعادة ضبط الفلتر' : 'Reset Filters'}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {filtered.map((product) => {
            const effective = getEffectiveProductPrice(product);
            const hasPromo = effective < product.priceIqd;
            const available = product.isAvailable && product.stock > 0;
            return (
              <article
                key={product.id}
                className="border border-[#944A5E] bg-[#6E2438] flex flex-col justify-between transition-transform duration-200 hover:-translate-y-0.5"
              >
                <div>
                  <div className="aspect-[4/3] w-full overflow-hidden bg-[#461221]">
                    <SafeImage
                      src={product.imageUrl}
                      alt={lang === 'ar' ? product.nameAr : product.nameEn}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="p-5 space-y-2">
                    <div className="text-xs text-white/70 flex items-center gap-2">
                      <span>{lang === 'ar' ? product.categoryAr : product.category}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums-en">
                        {available
                          ? lang === 'ar'
                            ? `متوفر (${product.stock})`
                            : `In Stock (${product.stock})`
                          : t.outOfStock}
                      </span>
                    </div>
                    <h2 className="text-base font-semibold text-white">
                      {lang === 'ar' ? product.nameAr : product.nameEn}
                    </h2>
                    <p className="text-sm text-white/80 leading-relaxed">
                      {lang === 'ar' ? product.descriptionAr : product.descriptionEn}
                    </p>
                  </div>
                </div>

                <div className="px-5 pb-5 pt-3 border-t border-[#944A5E]/60 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-base font-bold text-white tabular-nums-en">
                      {formatIqd(effective, lang)}
                    </div>
                    {hasPromo && (
                      <div className="text-xs text-white/55 line-through tabular-nums-en">
                        {formatIqd(product.priceIqd, lang)}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={!available}
                    onClick={() => onAddToCart(product)}
                    className="px-4 py-2 bg-[#0E0A0C] text-white border border-[#944A5E] text-xs font-medium hover:bg-[#1E1418] disabled:bg-[#461221] disabled:text-white/45 transition-colors whitespace-nowrap shrink-0"
                  >
                    {available ? t.addToCart : t.outOfStock}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
