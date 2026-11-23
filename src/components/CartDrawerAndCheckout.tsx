import React, { useEffect, useState } from 'react';
import { CheckCircle2, Minus, Plus, Trash2, X } from 'lucide-react';
import type {
  CartItemInput,
  Language,
  LoyaltyCardRecord,
  OptionItem,
  OrderRecord,
  Product,
  StoreSettings,
} from '../shared/types.ts';
import { formatIqd, isValidIraqiPhone } from '../shared/pricing.ts';
import { STATUS_LABELS, UI_COPY } from '../i18n/translations.ts';
import { apiUrl } from '../lib/api.ts';
import { SafeImage } from './SafeImage.tsx';

export interface LocalCartItem {
  id: string;
  input: CartItemInput;
  titleAr: string;
  titleEn: string;
  unitPriceIqd: number;
  imageUrl: string;
  summaryAr: string;
  summaryEn: string;
}

interface CartDrawerAndCheckoutProps {
  open: boolean;
  onClose: () => void;
  lang: Language;
  items: LocalCartItem[];
  products: Product[];
  options: OptionItem[];
  settings: StoreSettings;
  userUid?: string | null;
  onUpdateQty: (id: string, delta: number) => void;
  onRemoveItem: (id: string) => void;
  onClearCart: () => void;
  onOrderConfirmed: (result: {
    order: OrderRecord;
    loyaltyCard?: LoyaltyCardRecord;
    customerToken?: string;
    marketingConsent: boolean;
  }) => void;
  onOpenLoyalty: () => void;
}

export const CartDrawerAndCheckout: React.FC<CartDrawerAndCheckoutProps> = ({
  open,
  onClose,
  lang,
  items,
  settings,
  userUid,
  onUpdateQty,
  onRemoveItem,
  onClearCart,
  onOrderConfirmed,
  onOpenLoyalty,
}) => {
  const t = UI_COPY[lang];
  const [step, setStep] = useState<'cart' | 'checkout' | 'confirmed'>('cart');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerBirthDate, setCustomerBirthDate] = useState('');
  const [deliveryType, setDeliveryType] = useState<'pickup' | 'delivery'>('pickup');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [marketingConsent, setMarketingConsent] = useState(true);
  const [selectedPayment, setSelectedPayment] = useState('cash_on_delivery');

  const [serverTotals, setServerTotals] = useState<{
    subtotalIqd: number;
    discountIqd: number;
    totalIqd: number;
  } | null>(null);
  const [promoApplied, setPromoApplied] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [confirmedOrder, setConfirmedOrder] = useState<OrderRecord | null>(null);
  const [clientRequestId, setClientRequestId] = useState(() => `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    const activeMethods = settings.paymentMethods.filter((pm) => pm.isActive && pm.isIntegrated);
    if (activeMethods.length > 0 && !activeMethods.some((pm) => pm.id === selectedPayment)) {
      setSelectedPayment(activeMethods[0].id);
    }
  }, [settings.paymentMethods, selectedPayment]);

  useEffect(() => {
    if (!open) return;
    if (step === 'confirmed' && items.length > 0) {
      setStep('cart');
      setConfirmedOrder(null);
      setErrorMsg('');
    }
    if (items.length === 0) {
      setServerTotals(null);
      if (step === 'checkout') setStep('cart');
      return;
    }
    let active = true;
    fetch(apiUrl('/api/calculate-order'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: items.map((i) => i.input),
        promoCode: promoApplied || undefined,
      }),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!active) return;
        if (r.ok && data) {
          setErrorMsg('');
          setServerTotals({
            subtotalIqd: data.subtotalIqd,
            discountIqd: data.discountIqd,
            totalIqd: data.totalIqd,
          });
        } else {
          setServerTotals(null);
          if (data?.error) setErrorMsg(data.error);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open, items, promoApplied, step]);

  if (!open) return null;

  const fallbackSubtotal = items.reduce((s, i) => s + i.unitPriceIqd * i.input.quantity, 0);
  const displaySubtotal = serverTotals?.subtotalIqd ?? fallbackSubtotal;
  const displayDiscount = serverTotals?.discountIqd ?? 0;
  const displayTotal = serverTotals?.totalIqd ?? fallbackSubtotal;

  const handleApplyPromo = async () => {
    setErrorMsg('');
    const code = promoCode.trim().toUpperCase();
    if (!code) {
      setPromoApplied('');
      return;
    }
    try {
      const resp = await fetch(apiUrl('/api/calculate-order'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((i) => i.input),
          promoCode: code,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Promo failed');
      if (data.discountIqd > 0) {
        setPromoApplied(code);
        setServerTotals({
          subtotalIqd: data.subtotalIqd,
          discountIqd: data.discountIqd,
          totalIqd: data.totalIqd,
        });
      } else {
        setErrorMsg(lang === 'ar' ? 'كود الخصم غير صالح أو منتهي.' : 'Promo code is invalid or inactive.');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Promo check failed');
    }
  };

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (customerName.trim().length < 2) {
      setErrorMsg(lang === 'ar' ? 'يرجى إدخال الاسم الكامل.' : 'Please enter your full name.');
      return;
    }
    if (!isValidIraqiPhone(customerPhone)) {
      setErrorMsg(
        lang === 'ar'
          ? 'يرجى إدخال رقم هاتف عراقي صحيح يبدأ بـ 07 (مثال: 07701234567).'
          : 'Please enter a valid Iraqi mobile number starting with 07.'
      );
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(customerBirthDate)) {
      setErrorMsg(lang === 'ar' ? 'يرجى تحديد تاريخ الميلاد.' : 'Please enter your birth date.');
      return;
    }
    if (deliveryType === 'delivery' && deliveryAddress.trim().length < 4) {
      setErrorMsg(
        lang === 'ar' ? 'يرجى كتابة عنوان التوصيل داخل كربلاء.' : 'Please enter your Karbala delivery address.'
      );
      return;
    }

    setSubmitting(true);
    try {
      const resp = await fetch(apiUrl('/api/orders'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientRequestId,
          userId: userUid || null,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          customerBirthDate,
          marketingConsent,
          locationConsent: false,
          deliveryType,
          deliveryAddress: deliveryType === 'delivery' ? deliveryAddress.trim() : '',
          paymentMethod: selectedPayment,
          notes: notes.trim(),
          promoCode: promoApplied || undefined,
          items: items.map((i) => i.input),
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Could not submit order');
      }
      setConfirmedOrder(data.order);
      setStep('confirmed');
      onClearCart();
      setClientRequestId(`req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
      onOrderConfirmed({
        order: data.order,
        loyaltyCard: data.loyaltyCard,
        customerToken: data.customerToken,
        marketingConsent,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Order failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-[2px] flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={t.checkoutTitle}
    >
      <div className="w-full max-w-xl bg-[#5E1D2F] text-white h-full overflow-y-auto border-s border-[#944A5E] flex flex-col justify-between">
        {/* Drawer Header */}
        <div className="sticky top-0 z-10 bg-[#461221] border-b border-[#944A5E] px-6 py-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-white">
            {step === 'confirmed'
              ? t.orderConfirmedTitle
              : step === 'checkout'
                ? t.checkoutTitle
                : t.cart}
          </h2>
          <button
            type="button"
            onClick={() => {
              if (step === 'confirmed') setStep('cart');
              onClose();
            }}
            aria-label={lang === 'ar' ? 'إغلاق السلة' : 'Close cart'}
            className="p-2 border border-[#944A5E] bg-[#5E1D2F] text-white hover:border-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex-1 space-y-6">
          {step === 'confirmed' && confirmedOrder ? (
            <div className="space-y-6">
              <div className="border border-[#944A5E] bg-[#461221] p-6 space-y-3 text-center">
                <CheckCircle2 className="w-10 h-10 text-white mx-auto" />
                <div className="text-xs text-white/75">{t.orderNumberLabel}</div>
                <div className="text-2xl font-bold text-white tabular-nums-en" dir="ltr">
                  {confirmedOrder.orderNumber}
                </div>
                <div className="text-sm text-white/85">
                  {lang === 'ar' ? 'الحالة الحالية:' : 'Status:'}{' '}
                  <strong className="text-white">{STATUS_LABELS[confirmedOrder.status][lang]}</strong>
                </div>
              </div>

              <div className="border border-[#944A5E] bg-[#6E2438] p-5 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/75">{t.fullName}</span>
                  <span className="font-medium text-white">{confirmedOrder.customerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/75">{t.phone}</span>
                  <span className="font-medium text-white tabular-nums-en" dir="ltr">
                    {confirmedOrder.customerPhone}
                  </span>
                </div>
                <div className="flex justify-between border-t border-[#944A5E] pt-3 font-bold text-white">
                  <span>{t.totalPrice}</span>
                  <span className="tabular-nums-en">{formatIqd(confirmedOrder.totalIqd, lang)}</span>
                </div>
              </div>

              <p className="text-xs text-white/75 leading-relaxed">
                {lang === 'ar'
                  ? 'تم إرسال إشعار فوري لإدارة SEDO لتأكيد طلبك. بعد إتمام الشراء والتحقق من الطلب ستتم إضافة ختم لبطاقة الولاء الخاصة بك.'
                  : 'SEDO administrators have been notified immediately. A loyalty stamp will be added once the order is verified and completed by the store.'}
              </p>

              <button
                type="button"
                onClick={() => {
                  setStep('cart');
                  onClose();
                  onOpenLoyalty();
                }}
                className="w-full py-3 bg-[#0E0A0C] text-white border border-[#944A5E] text-sm font-medium hover:bg-[#1E1418] transition-colors"
              >
                {t.openLoyaltyCard}
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="border border-[#944A5E] bg-[#6E2438] p-10 text-center space-y-3">
              <p className="text-sm text-white/80">{t.emptyCart}</p>
            </div>
          ) : step === 'cart' ? (
            <div className="space-y-4">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="border border-[#944A5E] p-4 flex gap-4 items-start bg-[#6E2438]"
                >
                  <div className="w-20 h-20 shrink-0 bg-[#461221] overflow-hidden">
                    <SafeImage
                      src={item.imageUrl}
                      alt={lang === 'ar' ? item.titleAr : item.titleEn}
                    />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="text-sm font-semibold text-white">
                      {lang === 'ar' ? item.titleAr : item.titleEn}
                    </div>
                    <div className="text-xs text-white/75">
                      {lang === 'ar' ? item.summaryAr : item.summaryEn}
                    </div>
                    <div className="text-sm font-bold text-white tabular-nums-en pt-1">
                      {formatIqd(item.unitPriceIqd * item.input.quantity, lang)}
                    </div>
                    <div className="flex items-center gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => onUpdateQty(item.id, -1)}
                        aria-label="Decrease quantity"
                        className="p-1.5 border border-[#944A5E] bg-[#461221] text-white hover:border-white"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-xs font-semibold px-2 text-white tabular-nums-en">
                        {item.input.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => onUpdateQty(item.id, 1)}
                        aria-label="Increase quantity"
                        className="p-1.5 border border-[#944A5E] bg-[#461221] text-white hover:border-white"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveItem(item.id)}
                        aria-label={`Remove ${item.titleEn}`}
                        className="ms-auto p-1.5 text-white/75 hover:text-white"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {/* Promo Code */}
              <div className="border-t border-[#944A5E] pt-4 flex gap-2">
                <input
                  type="text"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value)}
                  placeholder={t.promoCode}
                  aria-label={t.promoCode}
                  className="flex-1 px-3 py-2 border border-[#944A5E] bg-[#461221] text-sm text-white placeholder:text-white/50 focus:outline-none focus:border-white"
                />
                <button
                  type="button"
                  onClick={handleApplyPromo}
                  className="px-4 py-2 border border-[#944A5E] bg-[#0E0A0C] text-white text-xs font-medium hover:border-white"
                >
                  {t.applyPromo}
                </button>
              </div>
              {errorMsg && <p className="text-xs text-white bg-[#0E0A0C] border border-[#944A5E] px-3 py-2">{errorMsg}</p>}
            </div>
          ) : (
            <form id="sedo-checkout-form" onSubmit={handleSubmitOrder} className="space-y-4">
              {errorMsg && (
                <div className="border border-white bg-[#0E0A0C] px-4 py-3 text-xs text-white">
                  {errorMsg}
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="chk-name" className="block text-xs font-medium text-white">
                  {t.fullName} *
                </label>
                <input
                  id="chk-name"
                  required
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder={lang === 'ar' ? 'مثال: زينب علي الحسيني' : 'e.g. Zainab Ali'}
                  className="w-full px-3.5 py-2.5 border border-[#944A5E] bg-[#461221] text-sm text-white placeholder:text-white/50 focus:outline-none focus:border-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="chk-phone" className="block text-xs font-medium text-white">
                    {t.phone} *
                  </label>
                  <input
                    id="chk-phone"
                    required
                    type="tel"
                    dir="ltr"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="07701234567"
                    className="w-full px-3.5 py-2.5 border border-[#944A5E] bg-[#461221] text-sm text-white placeholder:text-white/50 tabular-nums-en focus:outline-none focus:border-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="chk-dob" className="block text-xs font-medium text-white">
                    {t.birthDate} *
                  </label>
                  <input
                    id="chk-dob"
                    required
                    type="date"
                    dir="ltr"
                    value={customerBirthDate}
                    onChange={(e) => setCustomerBirthDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-[#944A5E] bg-[#461221] text-sm text-white tabular-nums-en focus:outline-none focus:border-white"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium text-white">{t.deliveryMethod}</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDeliveryType('pickup')}
                    className={`py-2.5 px-3 border text-xs font-medium ${
                      deliveryType === 'pickup'
                        ? 'border-white bg-[#0E0A0C] text-white'
                        : 'border-[#944A5E] bg-[#6E2438] text-white'
                    }`}
                  >
                    {t.pickup}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeliveryType('delivery')}
                    className={`py-2.5 px-3 border text-xs font-medium ${
                      deliveryType === 'delivery'
                        ? 'border-white bg-[#0E0A0C] text-white'
                        : 'border-[#944A5E] bg-[#6E2438] text-white'
                    }`}
                  >
                    {t.delivery}
                  </button>
                </div>
              </div>

              {deliveryType === 'delivery' && (
                <div className="space-y-1.5">
                  <label htmlFor="chk-addr" className="block text-xs font-medium text-white">
                    {t.deliveryAddress} *
                  </label>
                  <input
                    id="chk-addr"
                    required
                    type="text"
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    placeholder={
                      lang === 'ar'
                        ? 'كربلاء - الحي / أقرب نقطة دالة'
                        : 'Karbala neighborhood / nearest landmark'
                    }
                    className="w-full px-3.5 py-2.5 border border-[#944A5E] bg-[#461221] text-sm text-white placeholder:text-white/50 focus:outline-none focus:border-white"
                  />
                </div>
              )}

              <div className="space-y-2">
                <div className="text-xs font-medium text-white">{t.paymentMethod}</div>
                <div className="space-y-2">
                  {settings.paymentMethods.map((pm) => {
                    const enabled = pm.isActive && pm.isIntegrated;
                    return (
                      <label
                        key={pm.id}
                        className={`flex items-start gap-3 border p-3 text-xs ${
                          enabled
                            ? selectedPayment === pm.id
                              ? 'border-white bg-[#0E0A0C] cursor-pointer'
                              : 'border-[#944A5E] bg-[#6E2438] cursor-pointer'
                            : 'border-[#944A5E]/50 bg-[#461221]/60 opacity-60 cursor-not-allowed'
                        }`}
                      >
                        <input
                          type="radio"
                          name="paymentMethod"
                          value={pm.id}
                          disabled={!enabled}
                          checked={selectedPayment === pm.id}
                          onChange={() => setSelectedPayment(pm.id)}
                          className="mt-0.5 accent-white"
                        />
                        <div className="space-y-0.5">
                          <div className="font-semibold text-white">
                            {lang === 'ar' ? pm.nameAr : pm.nameEn}
                          </div>
                          <div className="text-white/75">
                            {lang === 'ar' ? pm.instructionsAr : pm.instructionsEn}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="chk-notes" className="block text-xs font-medium text-white">
                  {t.notes}
                </label>
                <textarea
                  id="chk-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3.5 py-2 border border-[#944A5E] bg-[#461221] text-sm text-white focus:outline-none focus:border-white"
                />
              </div>

              <label className="flex items-start gap-2.5 text-xs text-white/85 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={marketingConsent}
                  onChange={(e) => setMarketingConsent(e.target.checked)}
                  className="mt-0.5 accent-white"
                />
                <span>{t.marketingConsent}</span>
              </label>
            </form>
          )}
        </div>

        {/* Drawer Footer */}
        {items.length > 0 && step !== 'confirmed' && (
          <div className="sticky bottom-0 bg-[#461221] border-t border-[#944A5E] px-6 py-4 space-y-3">
            <div className="space-y-1 text-sm">
              <div className="flex justify-between text-white/80">
                <span>{lang === 'ar' ? 'المجموع الفرعي' : 'Subtotal'}</span>
                <span className="tabular-nums-en">{formatIqd(displaySubtotal, lang)}</span>
              </div>
              {displayDiscount > 0 && (
                <div className="flex justify-between text-white/90">
                  <span>
                    {lang === 'ar' ? 'خصم' : 'Discount'} ({promoApplied})
                  </span>
                  <span className="tabular-nums-en">- {formatIqd(displayDiscount, lang)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold text-white pt-1 border-t border-[#944A5E]">
                <span>{t.totalPrice}</span>
                <span className="tabular-nums-en">{formatIqd(displayTotal, lang)}</span>
              </div>
            </div>

            {step === 'cart' ? (
              <button
                type="button"
                onClick={() => setStep('checkout')}
                className="w-full py-3.5 bg-[#0E0A0C] text-white border border-[#944A5E] text-sm font-medium hover:bg-[#1E1418] transition-colors"
              >
                {t.checkoutTitle}
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep('cart')}
                  className="px-4 py-3 border border-[#944A5E] bg-[#6E2438] text-white text-xs font-medium hover:border-white"
                >
                  {lang === 'ar' ? 'رجوع' : 'Back'}
                </button>
                <button
                  type="submit"
                  form="sedo-checkout-form"
                  disabled={submitting}
                  className="flex-1 py-3 bg-[#0E0A0C] text-white border border-[#944A5E] text-sm font-medium hover:bg-[#1E1418] disabled:opacity-60 transition-colors"
                >
                  {submitting
                    ? lang === 'ar'
                      ? 'جاري تأكيد الطلب...'
                      : 'Submitting Order...'
                    : t.submitOrder}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
