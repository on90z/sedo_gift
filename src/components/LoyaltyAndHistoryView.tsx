import React, { useState } from 'react';
import { Award, Bell, Check, MapPin, ShieldCheck } from 'lucide-react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase.ts';
import type {
  CustomerRecord,
  Language,
  LoyaltyCardRecord,
  LoyaltyTransaction,
  OrderRecord,
  StoreSettings,
} from '../shared/types.ts';
import { formatIqd } from '../shared/pricing.ts';
import { evaluateProximityAlert } from '../shared/geo.ts';
import { STATUS_LABELS, UI_COPY } from '../i18n/translations.ts';

interface LoyaltyAndHistoryViewProps {
  lang: Language;
  settings: StoreSettings;
  customerToken: string | null;
  customer: CustomerRecord | null;
  loyaltyCard: LoyaltyCardRecord | null;
  orders: OrderRecord[];
  transactions: LoyaltyTransaction[];
  onAuthenticated: (payload: {
    customerToken: string;
    customer: CustomerRecord;
    loyaltyCard: LoyaltyCardRecord | null;
    orders: OrderRecord[];
    transactions: LoyaltyTransaction[];
  }) => void;
  onConsentUpdated: (customer: CustomerRecord) => void;
}

export const LoyaltyAndHistoryView: React.FC<LoyaltyAndHistoryViewProps> = ({
  lang,
  settings,
  customerToken,
  customer,
  loyaltyCard,
  orders,
  transactions,
  onAuthenticated,
  onConsentUpdated,
}) => {
  const t = UI_COPY[lang];
  const [phone, setPhone] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [proximityStatus, setProximityStatus] = useState('');

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);
    try {
      const resp = await fetch('/api/customers/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), birthDate }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Verification failed');
      onAuthenticated(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setErrorMsg('');
    try {
      await signInWithPopup(auth, googleProvider);
      setErrorMsg(
        lang === 'ar'
          ? 'تم تسجيل دخول Google بنجاح. للربط بسجل الطلبات استخدم رقم الهاتف وتاريخ الميلاد أدناه.'
          : 'Google sign-in succeeded. Enter your order phone and birth date below to link your loyalty card.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Google Sign-In failed');
    }
  };

  const handleRequestLocation = async () => {
    setProximityStatus('');
    if (!('geolocation' in navigator)) {
      setProximityStatus(
        lang === 'ar' ? 'المتصفح لا يدعم خدمة الموقع.' : 'Geolocation is not supported in this browser.'
      );
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (customerToken) {
          const resp = await fetch('/api/customers/me/consent', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${customerToken}`,
            },
            body: JSON.stringify({ locationConsent: true }),
          });
          if (resp.ok) {
            const d = await resp.json();
            onConsentUpdated(d.customer);
          }
        }
        const storeCoords =
          typeof settings.latitude === 'number' && typeof settings.longitude === 'number'
            ? { lat: settings.latitude, lng: settings.longitude }
            : null;
        const evalRes = evaluateProximityAlert({
          userCoords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          storeCoords,
          radiusMeters: settings.proximityRadiusMeters,
          proximityEnabled: settings.proximityEnabled,
          locationConsent: true,
          notificationConsent: typeof Notification !== 'undefined' && Notification.permission === 'granted',
          lastTriggeredAtMs: null,
          cooldownHours: settings.proximityCooldownHours,
        });
        setProximityStatus(
          evalRes.shouldTrigger
            ? lang === 'ar'
              ? `${settings.proximityMessageAr} (المسافة: ${evalRes.distanceMeters} متر)`
              : `${settings.proximityMessageEn} (${evalRes.distanceMeters}m away)`
            : lang === 'ar'
              ? `تم تفعيل إذن الموقع بنجاح${evalRes.distanceMeters !== null ? ` (المسافة الحالية: ${evalRes.distanceMeters} م)` : ''}.`
              : `Location permission enabled${evalRes.distanceMeters !== null ? ` (${evalRes.distanceMeters}m from store)` : ''}.`
        );
      },
      () => {
        setProximityStatus(
          lang === 'ar' ? 'تم رفض إذن الموقع من المتصفح.' : 'Location permission was denied.'
        );
      }
    );
  };

  const handleRequestNotification = async () => {
    if (typeof Notification === 'undefined') {
      setProximityStatus(
        lang === 'ar' ? 'المتصفح لا يدعم إشعارات الويب.' : 'Web notifications are unavailable.'
      );
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      if (customerToken) {
        const resp = await fetch('/api/customers/me/consent', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerToken}`,
          },
          body: JSON.stringify({ marketingConsent: true }),
        });
        if (resp.ok) {
          const d = await resp.json();
          onConsentUpdated(d.customer);
        }
      }
      setProximityStatus(
        lang === 'ar'
          ? 'تم تفعيل إشعارات المتصفح لعروض SEDO.'
          : 'Browser notifications enabled for SEDO offers.'
      );
    }
  };

  const handleWithdrawConsent = async () => {
    if (!customerToken) return;
    const resp = await fetch('/api/customers/me/consent', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ marketingConsent: false, locationConsent: false }),
    });
    if (resp.ok) {
      const d = await resp.json();
      onConsentUpdated(d.customer);
      setProximityStatus(
        lang === 'ar'
          ? 'تم سحب الموافقة وإيقاف الإشعارات الترويجية والموقع.'
          : 'Marketing and location consent withdrawn.'
      );
    }
  };

  const stampsCount = loyaltyCard?.stampsCount ?? 0;
  const remaining = Math.max(0, 10 - stampsCount);

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
      <div className="border-b border-[#944A5E] pb-6 space-y-2">
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-white">
          {t.loyaltyTitle}
        </h1>
        <p className="text-sm text-white/80 max-w-2xl">
          {lang === 'ar'
            ? 'بطاقة الولاء الرقمية من SEDO تُمنح وتُختم حصراً من قبل إدارة المتجر بعد التحقق من كل عملية شراء مؤهلة.'
            : 'SEDO digital loyalty stamps are verified and approved exclusively by store administrators after qualifying purchases.'}
        </p>
      </div>

      {!customer ? (
        <div className="max-w-lg border border-[#944A5E] bg-[#6E2438] p-6 sm:p-8 space-y-5">
          <div className="flex items-center gap-2 text-white">
            <ShieldCheck className="w-5 h-5" />
            <h2 className="text-lg font-semibold">
              {lang === 'ar' ? 'التحقق من هوية العميل' : 'Customer Verification'}
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-white/80 leading-relaxed">{t.verifyPrompt}</p>

          {errorMsg && (
            <div className="border border-[#944A5E] bg-[#0E0A0C] px-4 py-3 text-xs text-white">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleVerify} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="loy-phone" className="block text-xs font-medium text-white">
                {t.phone}
              </label>
              <input
                id="loy-phone"
                required
                type="tel"
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="07701234567"
                className="w-full px-3.5 py-2.5 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45 text-sm tabular-nums-en focus:outline-none focus:border-white"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="loy-dob" className="block text-xs font-medium text-white">
                {t.birthDate}
              </label>
              <input
                id="loy-dob"
                required
                type="date"
                dir="ltr"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-[#944A5E] bg-[#461221] text-white text-sm tabular-nums-en focus:outline-none focus:border-white"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-[#0E0A0C] border border-[#944A5E] text-white text-sm font-medium hover:bg-[#1E1418] transition-colors"
            >
              {loading ? '...' : t.verifyButton}
            </button>
          </form>

          <div className="pt-3 border-t border-[#944A5E]">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              className="w-full py-2.5 border border-[#944A5E] bg-[#461221] text-xs font-medium text-white hover:border-white transition-colors"
            >
              {t.signInGoogle}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-10">
          {/* Branded 10-Stamp Digital Loyalty Card — Pink reserved exclusively for Loyalty Stamp system */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-7 border border-[#944A5E] bg-[#0E0A0C] text-white p-6 sm:p-8 space-y-6">
              <div className="flex items-start justify-between gap-4 border-b border-white/15 pb-4">
                <div>
                  <div className="font-display text-2xl font-bold tracking-wider text-white">SEDO</div>
                  <div className="text-xs text-white/75">{t.brandFull}</div>
                </div>
                <div className="text-end">
                  <div className="text-xs text-white/70">
                    {lang === 'ar' ? 'رقم العضوية' : 'Customer ID'}
                  </div>
                  <div className="text-xs tabular-nums-en text-white" dir="ltr">
                    {customer.id}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-xs text-white/70">{t.fullName}</div>
                  <div className="text-xl font-semibold text-white">{customer.fullName}</div>
                </div>
                <div className="text-end">
                  <div className="text-xs text-white/70">{t.stampsCompleted}</div>
                  <div className="text-2xl font-bold tabular-nums-en text-[#F8BBD0]" dir="ltr">
                    {stampsCount} / 10
                  </div>
                </div>
              </div>

              {/* 10 Stamp Circles — Pink Accent Exclusively Here */}
              <div className="grid grid-cols-5 gap-3 sm:gap-4 py-2" data-testid="loyalty-stamps-grid">
                {Array.from({ length: 10 }, (_, idx) => {
                  const filled = idx < stampsCount;
                  return (
                    <div
                      key={idx}
                      aria-label={`Stamp ${idx + 1} ${filled ? 'completed' : 'empty'}`}
                      className={`aspect-square rounded-full border-2 flex items-center justify-center transition-colors ${
                        filled
                          ? 'bg-[#F48FB1] border-[#F8BBD0] text-[#0E0A0C]'
                          : 'border-[#F48FB1]/45 bg-[#5E1D2F]/40 text-[#F8BBD0]/85'
                      }`}
                    >
                      {filled ? (
                        <Check className="w-6 h-6 stroke-[2.5]" />
                      ) : (
                        <span className="text-xs font-semibold tabular-nums-en">{idx + 1}</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {stampsCount === 10 ? (
                <div className="bg-[#F48FB1] text-[#0E0A0C] p-4 text-center font-bold text-sm">
                  {t.congrats10}
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/85 border-t border-white/15 pt-4">
                  <span>
                    {t.stampsRemaining}:{' '}
                    <strong className="tabular-nums-en text-[#F8BBD0]">{remaining}</strong>
                  </span>
                  <span>
                    {lang === 'ar'
                      ? settings.loyaltyReward.titleAr
                      : settings.loyaltyReward.titleEn}
                  </span>
                </div>
              )}
            </div>

            {/* Loyalty Reward & Privacy / Proximity Controls */}
            <div className="lg:col-span-5 space-y-6">
              <div className="border border-[#944A5E] bg-[#6E2438] p-6 space-y-3 text-white">
                <div className="flex items-center gap-2 text-[#F8BBD0]">
                  <Award className="w-5 h-5 text-[#F48FB1]" />
                  <h2 className="text-base font-semibold">
                    {lang === 'ar' ? 'مكافأة الختم العاشر' : '10th-Stamp Reward'}
                  </h2>
                </div>
                <p className="text-sm font-semibold text-white">
                  {lang === 'ar'
                    ? settings.loyaltyReward.titleAr
                    : settings.loyaltyReward.titleEn}
                </p>
                <p className="text-xs text-white/80 leading-relaxed">
                  {lang === 'ar'
                    ? settings.loyaltyReward.descriptionAr
                    : settings.loyaltyReward.descriptionEn}
                </p>
                <div className="text-xs text-white/75 pt-2 border-t border-[#944A5E] tabular-nums-en">
                  {lang === 'ar'
                    ? `الحد الأدنى للطلب المؤهل: ${formatIqd(settings.loyaltyReward.minOrderIqd, lang)}`
                    : `Minimum qualifying order: ${formatIqd(settings.loyaltyReward.minOrderIqd, lang)}`}
                </div>
              </div>

              {/* Proximity & Notification Consent */}
              <div className="border border-[#944A5E] bg-[#6E2438] p-6 space-y-3 text-white">
                <h2 className="text-base font-semibold text-white">{t.proximityTitle}</h2>
                <p className="text-xs text-white/80 leading-relaxed">
                  {t.proximityDisclaimer}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleRequestLocation}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-[#944A5E] bg-[#461221] text-white text-xs font-medium hover:border-white transition-colors"
                  >
                    <MapPin className="w-3.5 h-3.5 text-white" />
                    <span>{t.enableLocation}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleRequestNotification}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-[#944A5E] bg-[#461221] text-white text-xs font-medium hover:border-white transition-colors"
                  >
                    <Bell className="w-3.5 h-3.5 text-white" />
                    <span>{t.enableNotifications}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleWithdrawConsent}
                    className="px-3.5 py-2 text-xs text-white/80 hover:text-white hover:underline"
                  >
                    {t.withdrawConsent}
                  </button>
                </div>
                {proximityStatus && (
                  <p className="text-xs text-white bg-[#461221] p-2.5 border border-[#944A5E]">
                    {proximityStatus}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Customer Order History */}
          <div className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-white">
              {lang === 'ar' ? 'سجل طلباتك' : 'Your Order History'}
            </h2>
            {orders.length === 0 ? (
              <div className="border border-[#944A5E] bg-[#6E2438] p-6 text-sm text-white/80">
                {lang === 'ar' ? 'لا توجد طلبات مسجلة بعد.' : 'No orders recorded yet.'}
              </div>
            ) : (
              <div className="border border-[#944A5E] divide-y divide-[#944A5E] bg-[#6E2438]">
                {orders.map((ord) => (
                  <div
                    key={ord.id}
                    className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="text-sm font-bold text-white tabular-nums-en" dir="ltr">
                        {ord.orderNumber}
                      </div>
                      <div className="text-xs text-white/80">
                        {ord.items
                          .map((i) => `${lang === 'ar' ? i.titleAr : i.titleEn} × ${i.quantity}`)
                          .join(' · ')}
                      </div>
                      <div className="text-xs text-white/65 tabular-nums-en" dir="ltr">
                        {new Date(ord.createdAt).toLocaleString('en-US')}
                      </div>
                    </div>
                    <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2">
                      <span className="text-sm font-bold text-white tabular-nums-en">
                        {formatIqd(ord.totalIqd, lang)}
                      </span>
                      <span className="text-xs font-medium text-white/85">
                        {STATUS_LABELS[ord.status][lang]}
                        {ord.stampAwarded ? (lang === 'ar' ? ' · مختوم' : ' · Stamped') : ''}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Loyalty Transaction History */}
          {transactions.length > 0 && (
            <div className="space-y-4">
              <h2 className="font-display text-xl font-semibold text-white">
                {lang === 'ar' ? 'سجل حركات الولاء' : 'Loyalty Transaction Ledger'}
              </h2>
              <div className="border border-[#944A5E] divide-y divide-[#944A5E] bg-[#6E2438]">
                {transactions.map((tx) => (
                  <div key={tx.id} className="px-4 py-3 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-semibold text-white">{tx.note}</span>
                      <span className="text-white/65 ms-2 tabular-nums-en" dir="ltr">
                        {new Date(tx.createdAt).toLocaleDateString('en-US')}
                      </span>
                    </div>
                    <span className="font-bold text-[#F8BBD0] tabular-nums-en" dir="ltr">
                      {tx.delta > 0 ? `+${tx.delta}` : tx.delta}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
