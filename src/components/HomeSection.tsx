import React from 'react';
import { ArrowLeft, ArrowRight, Award, Instagram, MapPin, Sparkles } from 'lucide-react';
import type { Language, Product, StoreSettings } from '../shared/types.ts';
import { formatIqd, getEffectiveProductPrice } from '../shared/pricing.ts';
import { UI_COPY } from '../i18n/translations.ts';
import { SafeImage } from './SafeImage.tsx';
import type { ActiveRoute } from './Header.tsx';

interface HomeSectionProps {
  lang: Language;
  settings: StoreSettings;
  products: Product[];
  onNavigate: (route: ActiveRoute) => void;
  onAddReadyMade: (product: Product) => void;
  onSelectCategory: (category: string) => void;
}

export const HomeSection: React.FC<HomeSectionProps> = ({
  lang,
  settings,
  products,
  onNavigate,
  onAddReadyMade,
  onSelectCategory,
}) => {
  const t = UI_COPY[lang];
  const ArrowIcon = lang === 'ar' ? ArrowLeft : ArrowRight;

  const featuredProducts = products
    .filter((p) => p.isAvailable && (p.isFeatured || p.isBestSeller))
    .slice(0, 3);

  const categories = (settings.categories || []).filter((c) => c.isActive && c.showOnHome);
  const offerText = lang === 'ar' ? settings.offerBannerTextAr : settings.offerBannerTextEn;

  return (
    <div className="space-y-20 pb-16">
      {settings.offerBannerEnabled && offerText?.trim() && (
        <div className="border-b border-[#944A5E] bg-[#0E0A0C] text-white text-xs sm:text-sm py-2.5 px-4 text-center font-medium">
          {offerText}
        </div>
      )}

      {/* 1. Split Editorial Hero */}
      <section className="border-b border-[#944A5E] bg-[#461221]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 lg:py-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
              <div className="text-xs tracking-wide text-white/80 font-medium flex items-center gap-2">
                <span>{lang === 'ar' ? settings.storeNameAr : settings.storeNameEn}</span>
                <span aria-hidden="true">·</span>
                <span>{lang === 'ar' ? settings.taglineAr : settings.taglineEn}</span>
              </div>

              <h1 className="font-display text-4xl sm:text-5xl lg:text-[3.4rem] leading-[1.18] font-bold text-white text-balance">
                {lang === 'ar' ? settings.heroHeadlineAr : settings.heroHeadlineEn}
              </h1>

              <p className="text-base sm:text-lg text-white/80 leading-relaxed max-w-xl">
                {lang === 'ar' ? settings.heroSubtitleAr : settings.heroSubtitleEn}
              </p>

              <div className="flex flex-wrap items-center gap-4 pt-2">
                <button
                  type="button"
                  onClick={() => onNavigate('builder')}
                  className="inline-flex items-center gap-2.5 px-7 py-3.5 bg-[#0E0A0C] text-white border border-[#944A5E] text-sm font-medium hover:bg-[#1E1418] transition-colors whitespace-nowrap shrink-0"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>
                    {(lang === 'ar' ? settings.heroPrimaryCtaAr : settings.heroPrimaryCtaEn) ||
                      t.designYourBouquet}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('bouquets')}
                  className="inline-flex items-center gap-2 px-6 py-3.5 border border-[#944A5E] bg-[#6E2438] text-white text-sm font-medium hover:bg-[#7C2C42] transition-colors whitespace-nowrap shrink-0"
                >
                  <span>
                    {(lang === 'ar' ? settings.heroSecondaryCtaAr : settings.heroSecondaryCtaEn) ||
                      t.browseBouquets}
                  </span>
                  <ArrowIcon className="w-4 h-4" />
                </button>
              </div>

              <div className="pt-4 border-t border-[#944A5E]/70 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-white/75">
                <span>
                  {lang === 'ar' ? 'سعر الوردة الواحدة:' : 'Base Rose Unit:'}{' '}
                  <strong className="text-white tabular-nums-en">
                    {formatIqd(settings.roseUnitPriceIqd, lang)}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>{lang === 'ar' ? 'كربلاء المقدسة، العراق' : 'Karbala, Iraq'}</span>
                <span aria-hidden="true" className="hidden sm:inline">·</span>
                <a
                  href={settings.instagramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-white hover:underline"
                >
                  <Instagram className="w-3.5 h-3.5" />
                  <span dir="ltr">{settings.instagramHandle}</span>
                </a>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="w-full h-72 sm:h-96 lg:h-full min-h-[380px] border border-[#944A5E] overflow-hidden bg-[#0E0A0C]">
                <SafeImage
                  src={settings.heroBannerUrl}
                  alt={lang === 'ar' ? settings.storeNameAr : settings.storeNameEn}
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Shop by Category + Featured Best Sellers */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-14">
        {categories.length > 0 && (
          <div className="space-y-6">
            <div className="flex items-end justify-between gap-4 border-b border-[#944A5E] pb-4">
              <div>
                <h2 className="font-display text-2xl sm:text-3xl font-semibold text-white">
                  {(lang === 'ar'
                    ? settings.categoriesSectionTitleAr
                    : settings.categoriesSectionTitleEn) || t.shopByCategory}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('bouquets')}
                className="text-sm font-medium text-white/85 hover:text-white inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <span>{t.viewAll}</span>
                <ArrowIcon className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    if (cat.kind === 'gift') {
                      onSelectCategory('all');
                      onNavigate('gifts');
                    } else {
                      onSelectCategory(cat.id);
                      onNavigate('bouquets');
                    }
                  }}
                  className="group text-start border border-[#944A5E] bg-[#6E2438] hover:border-white/75 transition-colors overflow-hidden"
                >
                  <div className="aspect-[4/3] w-full overflow-hidden bg-[#461221]">
                    <SafeImage
                      src={cat.imageUrl}
                      alt={lang === 'ar' ? cat.titleAr : cat.titleEn}
                      className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                    />
                  </div>
                  <div className="p-5 space-y-1">
                    <div className="text-xs text-white/75">
                      {lang === 'ar' ? cat.subtitleAr : cat.subtitleEn}
                    </div>
                    <h3 className="text-lg font-semibold text-white">
                      {lang === 'ar' ? cat.titleAr : cat.titleEn}
                    </h3>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Featured & Best Selling Bouquets */}
        <div className="space-y-6">
          <div className="flex items-end justify-between gap-4 border-b border-[#944A5E] pb-4">
            <h2 className="font-display text-2xl sm:text-3xl font-semibold text-white">
              {(lang === 'ar'
                ? settings.featuredSectionTitleAr
                : settings.featuredSectionTitleEn) || t.featuredBouquets}
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('bouquets')}
              className="text-sm font-medium text-white/85 hover:text-white inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <span>{t.viewAll}</span>
              <ArrowIcon className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {featuredProducts.map((product) => {
              const effectivePrice = getEffectiveProductPrice(product);
              const hasPromo = effectivePrice < product.priceIqd;
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
                        {product.roseCount ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums-en">
                              {product.roseCount} {t.roses}
                            </span>
                          </>
                        ) : null}
                        {product.isBestSeller && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-white font-medium">{t.bestSellers}</span>
                          </>
                        )}
                      </div>
                      <h3 className="text-base font-semibold text-white">
                        {lang === 'ar' ? product.nameAr : product.nameEn}
                      </h3>
                      <p className="text-sm text-white/80 line-clamp-2">
                        {lang === 'ar' ? product.descriptionAr : product.descriptionEn}
                      </p>
                    </div>
                  </div>

                  <div className="px-5 pb-5 pt-3 border-t border-[#944A5E]/60 flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="text-base font-bold text-white tabular-nums-en">
                        {formatIqd(effectivePrice, lang)}
                      </div>
                      {hasPromo && (
                        <div className="text-xs text-white/55 line-through tabular-nums-en">
                          {formatIqd(product.priceIqd, lang)}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={!product.isAvailable || product.stock <= 0}
                      onClick={() => onAddReadyMade(product)}
                      className="px-4 py-2 bg-[#0E0A0C] text-white border border-[#944A5E] text-xs font-medium hover:bg-[#1E1418] disabled:bg-[#461221] disabled:text-white/45 transition-colors whitespace-nowrap shrink-0"
                    >
                      {product.isAvailable && product.stock > 0 ? t.addToCart : t.outOfStock}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* 3. Digital Loyalty & Store Location Editorial Band */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 border border-[#944A5E] bg-[#6E2438] items-stretch">
          <div className="lg:col-span-6 p-8 lg:p-12 flex flex-col justify-center space-y-5">
            <div className="inline-flex items-center gap-2 text-xs font-medium text-[#F8BBD0]">
              <Award className="w-4 h-4 text-[#F48FB1]" />
              <span>
                {(lang === 'ar' ? settings.loyaltyPromoBadgeAr : settings.loyaltyPromoBadgeEn) ||
                  (lang === 'ar' ? 'برنامج الولاء الرقمي · 10 أختام' : '10-Stamp Digital Loyalty')}
              </span>
            </div>
            <h2 className="font-display text-3xl font-semibold text-white text-balance">
              {(lang === 'ar' ? settings.loyaltyPromoTitleAr : settings.loyaltyPromoTitleEn) ||
                t.loyaltyPromoTitle}
            </h2>
            <p className="text-sm sm:text-base text-white/80 leading-relaxed">
              {(lang === 'ar' ? settings.loyaltyPromoDescAr : settings.loyaltyPromoDescEn) ||
                t.loyaltyPromoDesc}
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <button
                type="button"
                onClick={() => onNavigate('loyalty')}
                className="px-6 py-3 bg-[#0E0A0C] text-white border border-[#944A5E] text-xs sm:text-sm font-medium hover:bg-[#1E1418] transition-colors whitespace-nowrap shrink-0"
              >
                {t.openLoyaltyCard}
              </button>
              <button
                type="button"
                onClick={() => onNavigate('contact')}
                className="inline-flex items-center gap-2 px-5 py-3 border border-[#944A5E] bg-[#461221] text-white text-xs sm:text-sm font-medium hover:bg-[#5E1D2F] transition-colors whitespace-nowrap shrink-0"
              >
                <MapPin className="w-4 h-4 text-white" />
                <span>{t.navContact}</span>
              </button>
            </div>
          </div>

          <div className="lg:col-span-6 min-h-[280px] border-t lg:border-t-0 lg:border-s border-[#944A5E]">
            <SafeImage
              src={settings.storePhotoUrl}
              alt={(lang === 'ar' ? settings.aboutTitleAr : settings.aboutTitleEn) || t.aboutTitle}
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      </section>
    </div>
  );
};
