import React, { useMemo, useState } from 'react';
import { Check, ShoppingBag } from 'lucide-react';
import type {
  CustomBouquetSelection,
  Language,
  OptionItem,
  StoreSettings,
} from '../shared/types.ts';
import { calculateCustomBouquetPrice, formatIqd } from '../shared/pricing.ts';
import { UI_COPY } from '../i18n/translations.ts';
import { SafeImage } from './SafeImage.tsx';

interface CustomBouquetBuilderProps {
  lang: Language;
  options: OptionItem[];
  settings: StoreSettings;
  onAddCustomBouquet: (selection: CustomBouquetSelection) => void;
}

const PRESET_COUNTS = [7, 8, 10, 12, 15, 20];

export const CustomBouquetBuilder: React.FC<CustomBouquetBuilderProps> = ({
  lang,
  options,
  settings,
  onAddCustomBouquet,
}) => {
  const t = UI_COPY[lang];

  const flowerTypes = useMemo(
    () => options.filter((o) => o.group === 'flower_type' && o.isAvailable),
    [options]
  );
  const flowerColors = useMemo(
    () => options.filter((o) => o.group === 'flower_color' && o.isAvailable),
    [options]
  );
  const wrappings = useMemo(
    () => options.filter((o) => o.group === 'wrapping' && o.isAvailable),
    [options]
  );
  const arrangements = useMemo(
    () => options.filter((o) => o.group === 'arrangement' && o.isAvailable),
    [options]
  );
  const gifts = useMemo(
    () => options.filter((o) => o.group === 'gift' && o.isAvailable),
    [options]
  );

  const [roseQuantity, setRoseQuantity] = useState<number>(10);
  const [flowerTypeId, setFlowerTypeId] = useState<string>(flowerTypes[0]?.id || '');
  const [colorIds, setColorIds] = useState<string[]>(
    flowerColors[0]?.id ? [flowerColors[0].id] : []
  );
  const [wrappingId, setWrappingId] = useState<string>(wrappings[0]?.id || '');
  const [arrangementId, setArrangementId] = useState<string>(arrangements[0]?.id || '');
  const [giftIds, setGiftIds] = useState<string[]>([]);
  const [cardMessage, setCardMessage] = useState<string>('');
  const [addedFeedback, setAddedFeedback] = useState(false);

  const activeFlowerTypeId = flowerTypes.some((f) => f.id === flowerTypeId)
    ? flowerTypeId
    : flowerTypes[0]?.id || '';
  const activeWrappingId = wrappings.some((w) => w.id === wrappingId)
    ? wrappingId
    : wrappings[0]?.id || '';
  const activeArrangementId = arrangements.some((a) => a.id === arrangementId)
    ? arrangementId
    : arrangements[0]?.id || '';

  const selection: CustomBouquetSelection = {
    roseQuantity: Math.max(1, Math.min(settings.maxCustomRoses || 100, roseQuantity || 1)),
    flowerTypeId: activeFlowerTypeId,
    colorIds: colorIds.length > 0 ? colorIds : flowerColors[0]?.id ? [flowerColors[0].id] : [],
    wrappingId: activeWrappingId,
    arrangementId: activeArrangementId,
    giftIds,
    cardMessage,
  };

  const breakdown = useMemo(() => {
    try {
      return calculateCustomBouquetPrice(
        selection,
        options,
        settings.roseUnitPriceIqd,
        settings.maxCustomRoses
      );
    } catch {
      return null;
    }
  }, [selection, options, settings.roseUnitPriceIqd, settings.maxCustomRoses]);

  const selectedFlowerType = flowerTypes.find((f) => f.id === selection.flowerTypeId);
  const selectedWrapping = wrappings.find((w) => w.id === selection.wrappingId);
  const selectedArrangement = arrangements.find((a) => a.id === selection.arrangementId);
  const selectedColors = flowerColors.filter((c) => selection.colorIds.includes(c.id));
  const selectedGifts = gifts.filter((g) => selection.giftIds.includes(g.id));

  const maxStock = selectedFlowerType ? Math.min(settings.maxCustomRoses, selectedFlowerType.stock) : settings.maxCustomRoses;

  const toggleColor = (id: string) => {
    setColorIds((prev) => {
      if (prev.includes(id)) {
        return prev.length > 1 ? prev.filter((x) => x !== id) : prev;
      }
      return [...prev, id];
    });
  };

  const toggleGift = (id: string) => {
    setGiftIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleAdd = () => {
    if (!breakdown) return;
    onAddCustomBouquet(selection);
    setAddedFeedback(true);
    setTimeout(() => setAddedFeedback(false), 1800);
  };

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
      <div className="border-b border-[#944A5E] pb-6 space-y-2">
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-white">
          {(lang === 'ar' ? settings.builderTitleAr : settings.builderTitleEn) || t.builderTitle}
        </h1>
        <p className="text-sm sm:text-base text-white/80 max-w-2xl">
          {(lang === 'ar' ? settings.builderSubtitleAr : settings.builderSubtitleEn) ||
            t.builderSubtitle}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left/Main Column: 6 Step Selectors */}
        <div className="lg:col-span-8 space-y-10">
          {/* A. Number of Roses */}
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-semibold text-white">{t.stepRoses}</h2>
              <span className="text-xs text-white/80 tabular-nums-en">
                {lang === 'ar' ? 'سعر الوردة:' : 'Per Rose:'}{' '}
                {formatIqd(settings.roseUnitPriceIqd, lang)}
              </span>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              {PRESET_COUNTS.map((count) => {
                const active = selection.roseQuantity === count;
                return (
                  <button
                    key={count}
                    type="button"
                    disabled={count > maxStock}
                    onClick={() => setRoseQuantity(count)}
                    className={`py-3 px-2 border text-center transition-colors ${
                      active
                        ? 'border-white bg-[#0E0A0C] text-white'
                        : 'border-[#944A5E] bg-[#6E2438] text-white hover:border-white/75'
                    } disabled:opacity-40`}
                  >
                    <div className="text-lg font-bold tabular-nums-en">{count}</div>
                    <div className="text-[11px] opacity-85 tabular-nums-en">
                      {formatIqd(count * settings.roseUnitPriceIqd, lang)}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-4 pt-1">
              <label htmlFor="custom-rose-qty" className="text-sm font-medium text-white">
                {t.customQtyLabel}:
              </label>
              <input
                id="custom-rose-qty"
                type="number"
                min={1}
                max={maxStock}
                value={roseQuantity}
                onChange={(e) => setRoseQuantity(Math.max(1, Math.min(maxStock, Number(e.target.value) || 1)))}
                className="w-28 px-3 py-2 border border-[#944A5E] bg-[#461221] text-sm font-semibold text-white tabular-nums-en focus:outline-none focus:border-white"
              />
              <span className="text-xs text-white/70 tabular-nums-en">
                {lang === 'ar' ? `المتاح بالمخزون: ${maxStock}` : `Available stock: ${maxStock}`}
              </span>
            </div>
          </div>

          {/* B. Flower Types */}
          <div className="space-y-4 pt-6 border-t border-[#944A5E]">
            <h2 className="text-xl font-semibold text-white">{t.stepFlowerType}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {flowerTypes.map((ft) => {
                const active = selection.flowerTypeId === ft.id;
                return (
                  <button
                    key={ft.id}
                    type="button"
                    onClick={() => setFlowerTypeId(ft.id)}
                    className={`text-start border transition-colors overflow-hidden ${
                      active
                        ? 'border-white ring-1 ring-white bg-[#0E0A0C]'
                        : 'border-[#944A5E] bg-[#6E2438] hover:border-white/75'
                    }`}
                  >
                    <div className="aspect-[4/3] w-full overflow-hidden bg-[#461221]">
                      <SafeImage src={ft.imageUrl} alt={lang === 'ar' ? ft.nameAr : ft.nameEn} />
                    </div>
                    <div className="p-3.5 space-y-1">
                      <div className="text-sm font-semibold text-white">
                        {lang === 'ar' ? ft.nameAr : ft.nameEn}
                      </div>
                      <div className="text-xs text-white/80 tabular-nums-en">
                        {ft.priceIqd === 0
                          ? lang === 'ar'
                            ? 'مشمول بالسعر الأساسي'
                            : 'Included in base price'
                          : `+ ${formatIqd(ft.priceIqd, lang)} / ${t.roses}`}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* C. Flower Colors */}
          <div className="space-y-4 pt-6 border-t border-[#944A5E]">
            <h2 className="text-xl font-semibold text-white">{t.stepColors}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {flowerColors.map((fc) => {
                const active = selection.colorIds.includes(fc.id);
                return (
                  <button
                    key={fc.id}
                    type="button"
                    onClick={() => toggleColor(fc.id)}
                    className={`text-start border p-3 transition-colors flex flex-col gap-2.5 ${
                      active
                        ? 'border-white ring-1 ring-white bg-[#0E0A0C]'
                        : 'border-[#944A5E] bg-[#6E2438] hover:border-white/75'
                    }`}
                  >
                    <div className="aspect-[4/3] w-full overflow-hidden bg-[#461221]">
                      <SafeImage src={fc.imageUrl} alt={lang === 'ar' ? fc.nameAr : fc.nameEn} />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-4 h-4 shrink-0 border border-white/40"
                          style={{ backgroundColor: fc.colorHex || '#8B3F35' }}
                        />
                        <span className="text-xs font-medium text-white truncate">
                          {lang === 'ar' ? fc.nameAr : fc.nameEn}
                        </span>
                      </div>
                      {active && <Check className="w-4 h-4 text-white shrink-0" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* D. Wrapping */}
          <div className="space-y-4 pt-6 border-t border-[#944A5E]">
            <h2 className="text-xl font-semibold text-white">{t.stepWrapping}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {wrappings.map((wrap) => {
                const active = selection.wrappingId === wrap.id;
                return (
                  <button
                    key={wrap.id}
                    type="button"
                    onClick={() => setWrappingId(wrap.id)}
                    className={`text-start border flex items-center gap-4 p-3 transition-colors ${
                      active
                        ? 'border-white ring-1 ring-white bg-[#0E0A0C]'
                        : 'border-[#944A5E] bg-[#6E2438] hover:border-white/75'
                    }`}
                  >
                    <div className="w-24 h-20 shrink-0 overflow-hidden bg-[#461221]">
                      <SafeImage src={wrap.imageUrl} alt={lang === 'ar' ? wrap.nameAr : wrap.nameEn} />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="text-sm font-semibold text-white">
                        {lang === 'ar' ? wrap.nameAr : wrap.nameEn}
                      </div>
                      <div className="text-xs text-white/80 font-medium tabular-nums-en">
                        {wrap.priceIqd === 0 ? (lang === 'ar' ? 'مجاني' : 'Free') : formatIqd(wrap.priceIqd, lang)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* E. Bouquet Arrangement */}
          <div className="space-y-4 pt-6 border-t border-[#944A5E]">
            <h2 className="text-xl font-semibold text-white">{t.stepArrangement}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {arrangements.map((arr) => {
                const active = selection.arrangementId === arr.id;
                return (
                  <button
                    key={arr.id}
                    type="button"
                    onClick={() => setArrangementId(arr.id)}
                    className={`text-start border flex items-center gap-4 p-3 transition-colors ${
                      active
                        ? 'border-white ring-1 ring-white bg-[#0E0A0C]'
                        : 'border-[#944A5E] bg-[#6E2438] hover:border-white/75'
                    }`}
                  >
                    <div className="w-24 h-20 shrink-0 overflow-hidden bg-[#461221]">
                      <SafeImage src={arr.imageUrl} alt={lang === 'ar' ? arr.nameAr : arr.nameEn} />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="text-sm font-semibold text-white">
                        {lang === 'ar' ? arr.nameAr : arr.nameEn}
                      </div>
                      <div className="text-xs text-white/80 font-medium tabular-nums-en">
                        {arr.priceIqd === 0 ? (lang === 'ar' ? 'قياسي' : 'Standard') : `+ ${formatIqd(arr.priceIqd, lang)}`}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* F. Additional Gifts & Greeting Message */}
          <div className="space-y-5 pt-6 border-t border-[#944A5E]">
            <h2 className="text-xl font-semibold text-white">{t.stepGifts}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {gifts.map((gift) => {
                const active = selection.giftIds.includes(gift.id);
                return (
                  <button
                    key={gift.id}
                    type="button"
                    onClick={() => toggleGift(gift.id)}
                    className={`text-start border flex items-center gap-4 p-3 transition-colors ${
                      active
                        ? 'border-white ring-1 ring-white bg-[#0E0A0C]'
                        : 'border-[#944A5E] bg-[#6E2438] hover:border-white/75'
                    }`}
                  >
                    <div className="w-20 h-20 shrink-0 overflow-hidden bg-[#461221]">
                      <SafeImage src={gift.imageUrl} alt={lang === 'ar' ? gift.nameAr : gift.nameEn} />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="text-sm font-semibold text-white">
                        {lang === 'ar' ? gift.nameAr : gift.nameEn}
                      </div>
                      <div className="text-xs text-white/80 font-medium tabular-nums-en">
                        + {formatIqd(gift.priceIqd, lang)}
                      </div>
                    </div>
                    {active && <Check className="w-4 h-4 text-white shrink-0" />}
                  </button>
                );
              })}
            </div>

            <div className="space-y-2 pt-2">
              <label htmlFor="bouquet-card-msg" className="block text-sm font-medium text-white">
                {t.cardMessageLabel}
              </label>
              <textarea
                id="bouquet-card-msg"
                rows={2}
                maxLength={240}
                value={cardMessage}
                onChange={(e) => setCardMessage(e.target.value)}
                placeholder={t.cardMessagePlaceholder}
                className="w-full px-4 py-2.5 border border-[#944A5E] bg-[#461221] text-sm text-white placeholder:text-white/50 focus:outline-none focus:border-white"
              />
            </div>
          </div>
        </div>

        {/* Right Sticky Preview & Automatic Price Breakdown */}
        <aside className="lg:col-span-4 lg:sticky lg:top-24 border border-[#944A5E] bg-[#461221] p-6 space-y-5">
          <div className="aspect-[4/3] w-full overflow-hidden border border-[#944A5E] bg-[#0E0A0C]">
            <SafeImage
              src={selectedWrapping?.imageUrl || selectedFlowerType?.imageUrl}
              alt="Custom Bouquet Preview"
              className="w-full h-full object-cover"
            />
          </div>

          <div className="space-y-2 border-b border-[#944A5E] pb-4">
            <h3 className="font-display text-xl font-semibold text-white">
              {lang === 'ar' ? 'معاينة باقتك المختارة' : 'Your Bouquet Preview'}
            </h3>
            <div className="text-xs text-white/80 space-y-1.5">
              <div>
                <span className="font-semibold text-white">{selection.roseQuantity}</span> {t.roses} ·{' '}
                {lang === 'ar' ? selectedFlowerType?.nameAr : selectedFlowerType?.nameEn}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {selectedColors.map((c) => (
                  <span key={c.id} className="inline-flex items-center gap-1">
                    <span
                      className="w-2.5 h-2.5 inline-block border border-white/40"
                      style={{ backgroundColor: c.colorHex || '#8B3F35' }}
                    />
                    <span>{lang === 'ar' ? c.nameAr : c.nameEn}</span>
                  </span>
                ))}
              </div>
              <div>
                {lang === 'ar' ? selectedWrapping?.nameAr : selectedWrapping?.nameEn} ·{' '}
                {lang === 'ar' ? selectedArrangement?.nameAr : selectedArrangement?.nameEn}
              </div>
              {selectedGifts.length > 0 && (
                <div className="text-white">
                  + {selectedGifts.map((g) => (lang === 'ar' ? g.nameAr : g.nameEn)).join(' · ')}
                </div>
              )}
            </div>
          </div>

          {breakdown && (
            <div className="space-y-2.5 text-sm">
              <div className="text-xs font-semibold text-white/70">{t.priceBreakdown}</div>
              <div className="flex justify-between text-white/85">
                <span>
                  {t.rosesSubtotal} ({breakdown.roseQuantity} ×{' '}
                  <span className="tabular-nums-en">{breakdown.roseUnitPriceIqd.toLocaleString('en-US')}</span>)
                </span>
                <span className="font-medium text-white tabular-nums-en">
                  {formatIqd(breakdown.rosesSubtotalIqd, lang)}
                </span>
              </div>
              {breakdown.flowerTypeSurchargeIqd > 0 && (
                <div className="flex justify-between text-white/85">
                  <span>{t.flowerTypeExtra}</span>
                  <span className="font-medium text-white tabular-nums-en">
                    {formatIqd(breakdown.flowerTypeSurchargeIqd, lang)}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-white/85">
                <span>{t.wrappingCost}</span>
                <span className="font-medium text-white tabular-nums-en">
                  {formatIqd(breakdown.wrappingPriceIqd, lang)}
                </span>
              </div>
              <div className="flex justify-between text-white/85">
                <span>{t.arrangementCost}</span>
                <span className="font-medium text-white tabular-nums-en">
                  {formatIqd(breakdown.arrangementPriceIqd, lang)}
                </span>
              </div>
              {breakdown.giftsSubtotalIqd > 0 && (
                <div className="flex justify-between text-white/85">
                  <span>{t.giftsCost}</span>
                  <span className="font-medium text-white tabular-nums-en">
                    {formatIqd(breakdown.giftsSubtotalIqd, lang)}
                  </span>
                </div>
              )}

              <div className="pt-3 border-t border-[#944A5E] flex items-center justify-between text-base font-bold text-white">
                <span>{t.totalPrice}</span>
                <span className="text-lg tabular-nums-en" data-testid="builder-total-price">
                  {formatIqd(breakdown.totalIqd, lang)}
                </span>
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={!breakdown}
            onClick={handleAdd}
            className="w-full py-3.5 px-5 bg-[#0E0A0C] text-white border border-[#944A5E] text-sm font-medium hover:bg-[#1E1418] transition-colors flex items-center justify-center gap-2"
          >
            {addedFeedback ? (
              <>
                <Check className="w-4 h-4" />
                <span>{lang === 'ar' ? 'تمت الإضافة للسلة' : 'Added to Bag'}</span>
              </>
            ) : (
              <>
                <ShoppingBag className="w-4 h-4" />
                <span>{t.addCustomBouquet}</span>
              </>
            )}
          </button>
        </aside>
      </div>
    </section>
  );
};
