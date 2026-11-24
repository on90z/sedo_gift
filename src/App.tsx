import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  APILoadingStatus,
  APIProvider,
  AdvancedMarker,
  Map as GoogleMap,
  Pin,
  useApiLoadingStatus,
} from '@vis.gl/react-google-maps';
import {
  Award,
  Banknote,
  Check,
  Clock,
  ExternalLink,
  Flower2,
  Gift,
  Instagram,
  MapPin,
  MessageCircle,
  Minus,
  PackageCheck,
  Phone,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react';
import { supabase } from '../supabaseclient.tsx';
import { AdminDashboard, ADMIN_STATUS_LABELS } from './AdminDashboard.tsx';
import {
  calculateBouquetTotal,
  clampFlowerCount,
  extractCoordsFromMapsUrl,
  formatIqd,
  formatOrderDetailsText,
  formatWhatsAppUrl,
  normalizePhone,
  OFFICIAL_INSTAGRAM_URL,
  OFFICIAL_PHONE_PRIMARY,
  OFFICIAL_PHONE_SECONDARY,
  parseStorePhoneList,
  resolveInstagramUrl,
  type BouquetOrderDetails,
} from './pricing.ts';
import type { CustomerRow, OrderRow, ProductRow, RoutePath, StoreSettingsRow } from './types.ts';
import bouquetRedImg from './assets/images/bouquet_red_velvet_1795361896339.jpg';
import bouquetWhiteImg from './assets/images/bouquet_ivory_blush_1795361894392.jpg';
import bouquetMixedImg from './assets/images/bouquet_golden_sun_1795361894089.jpg';
import heroBouquetImg from './assets/images/hero_sedo_bouquet_1795361895118.jpg';
import giftCollectionImg from './assets/images/gift_luxury_collection_1795361894946.jpg';
import boutiqueImg from './assets/images/store_sedo_boutique_1795361894413.jpg';

const FLOWER_COLORS = ['أحمر', 'أبيض', 'وردي', 'مشكّل', 'أصفر', 'بنفسجي'] as const;
const BOUQUET_SHAPES = [
  'كلاسيكية دائرية',
  'طولية فاخرة',
  'بوكس هدايا',
  'باقة يدوية ناعمة',
] as const;
const QUICK_COUNTS = [5, 7, 11, 15, 21, 31] as const;

const MAPS_API_KEY = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '').trim();

function getFallbackProductImage(product: Pick<ProductRow, 'name_ar' | 'category'>): string {
  const name = product.name_ar || '';
  if (product.category === 'gift') return giftCollectionImg;
  if (product.category === 'wrapping') return boutiqueImg;
  if (name.includes('أحمر')) return bouquetRedImg;
  if (name.includes('أبيض')) return bouquetWhiteImg;
  if (name.includes('مشكل')) return bouquetMixedImg;
  if (name.includes('وردي')) return heroBouquetImg;
  return heroBouquetImg;
}

function getRouteFromLocation(): RoutePath {
  return /^\/admin\/?$/i.test(window.location.pathname) ? 'admin' : 'home';
}

function formatDateTimeEn(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

function StoreLocationMap({
  shopName,
  address,
  mapsUrl,
}: {
  shopName: string;
  address: string;
  mapsUrl: string;
}) {
  const [quotaError, setQuotaError] = useState(false);

  useEffect(() => {
    const onQuota = () => setQuotaError(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, []);

  const coords = useMemo(() => extractCoordsFromMapsUrl(mapsUrl), [mapsUrl]);

  if (!MAPS_API_KEY || quotaError) {
    return (
      <div className="h-[300px] w-full rounded-2xl bg-[#461221] border border-white/20 p-6 flex flex-col justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-sm text-white/80">
            <MapPin className="w-4 h-4 shrink-0" />
            <span>موقع المتجر على الخريطة</span>
          </div>
          <h3 className="text-lg font-semibold text-white">{shopName}</h3>
          <p className="text-sm text-white/85 leading-relaxed">{address}</p>
        </div>
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#0E0A0C] text-white text-sm font-medium border border-white/20 hover:bg-black transition"
        >
          <ExternalLink className="w-4 h-4" />
          <span>فتح الموقع في خرائط Google</span>
        </a>
      </div>
    );
  }

  return (
    <APIProvider apiKey={MAPS_API_KEY} language="ar" region="IQ" libraries={['marker']}>
      <InteractiveGoogleMap
        coords={coords}
        shopName={shopName}
        address={address}
        mapsUrl={mapsUrl}
      />
    </APIProvider>
  );
}

function InteractiveGoogleMap({
  coords,
  shopName,
  address,
  mapsUrl,
}: {
  coords: { lat: number; lng: number };
  shopName: string;
  address: string;
  mapsUrl: string;
}) {
  const loadingStatus = useApiLoadingStatus();

  if (
    loadingStatus === APILoadingStatus.FAILED ||
    loadingStatus === APILoadingStatus.AUTH_FAILURE
  ) {
    return (
      <div className="h-[300px] w-full rounded-2xl bg-[#461221] border border-white/20 p-6 flex flex-col justify-between">
        <div className="space-y-2">
          <p className="text-sm text-white/80">تعذّر تحميل الخريطة التفاعلية حالياً</p>
          <h3 className="text-lg font-semibold text-white">{shopName}</h3>
          <p className="text-sm text-white/85">{address}</p>
        </div>
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#0E0A0C] text-white text-sm font-medium border border-white/20 hover:bg-black transition"
        >
          <ExternalLink className="w-4 h-4" />
          <span>فتح الموقع في خرائط Google</span>
        </a>
      </div>
    );
  }

  return (
    <div className="relative h-[300px] w-full rounded-2xl overflow-hidden border border-white/20 bg-[#461221]">
      <GoogleMap
        mapId="DEMO_MAP_ID"
        defaultCenter={coords}
        defaultZoom={15}
        gestureHandling="cooperative"
        disableDefaultUI={false}
        internalUsageAttributionIds={['gmp_git_agentskills_v1']}
        style={{ width: '100%', height: '100%' }}
      >
        <AdvancedMarker position={coords} title={shopName}>
          <Pin background="#0E0A0C" borderColor="#FFFFFF" glyphColor="#FFFFFF" />
        </AdvancedMarker>
      </GoogleMap>
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState<RoutePath>(getRouteFromLocation);

  const navigateTo = useCallback((target: RoutePath) => {
    const nextPath = target === 'admin' ? '/admin' : '/';
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
    }
    setRoute(target);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const onPopState = () => setRoute(getRouteFromLocation());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  if (route === 'admin') {
    return (
      <AdminDashboard
        onBackHome={() => navigateTo('home')}
        getFallbackImage={getFallbackProductImage}
      />
    );
  }

  return <HomePage onOpenAdmin={() => navigateTo('admin')} />;
}

function HomePage({ onOpenAdmin }: { onOpenAdmin: () => void }) {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [settings, setSettings] = useState<StoreSettingsRow>({
    id: 1,
    shop_name: 'SEDO للهدايا والزهور',
    address: 'كربلاء - حي الميلاد - شارع الدرة - مجاور كوفي الدرة',
    working_hours: 'يومياً من الساعة 9:00 صباحاً إلى 1:00 بعد منتصف الليل',
    phone_numbers: `${OFFICIAL_PHONE_PRIMARY}, ${OFFICIAL_PHONE_SECONDARY}`,
    whatsapp_numbers: `${OFFICIAL_PHONE_PRIMARY}, ${OFFICIAL_PHONE_SECONDARY}`,
    instagram_url: OFFICIAL_INSTAGRAM_URL,
    google_maps_url: 'https://maps.google.com/?q=32.6027,44.0197',
    loyalty_required_purchases: 9,
    loyalty_reward_type: 'gift',
    loyalty_reward_value: 'باقة أو هدية مجانية على الطلب العاشر',
    cash_only: true,
  });
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Builder state
  const [selectedFlowerId, setSelectedFlowerId] = useState<string>('');
  const [flowerCount, setFlowerCount] = useState<number>(11);
  const [selectedColor, setSelectedColor] = useState<string>(FLOWER_COLORS[0]);
  const [selectedShape, setSelectedShape] = useState<string>(BOUQUET_SHAPES[0]);
  const [selectedWrappingId, setSelectedWrappingId] = useState<string>('');
  const [selectedGiftId, setSelectedGiftId] = useState<string>('');

  // Customer form state (NO email field)
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerBirthDate, setCustomerBirthDate] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [cityArea, setCityArea] = useState('');
  const [nearestLandmark, setNearestLandmark] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderSuccess, setOrderSuccess] = useState<{
    id: string;
    total: number;
    summary: string;
  } | null>(null);

  // Loyalty search state
  const [loyaltyPhoneInput, setLoyaltyPhoneInput] = useState('');
  const [loyaltyLoading, setLoyaltyLoading] = useState(false);
  const [loyaltySearched, setLoyaltySearched] = useState(false);
  const [loyaltyError, setLoyaltyError] = useState<string | null>(null);
  const [loyaltyCustomer, setLoyaltyCustomer] = useState<CustomerRow | null>(null);
  const [loyaltyOrders, setLoyaltyOrders] = useState<OrderRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function loadStorefront() {
      setLoadingCatalog(true);
      setCatalogError(null);
      const [productsRes, settingsRes] = await Promise.all([
        supabase
          .from('products')
          .select('*')
          .eq('is_active', true)
          .order('created_at', { ascending: true }),
        supabase.from('store_settings').select('*').limit(1).maybeSingle(),
      ]);

      if (cancelled) return;

      if (productsRes.error) {
        setCatalogError('تعذّر تحميل المنتجات من قاعدة البيانات. يرجى المحاولة لاحقاً.');
      } else {
        const list = ((productsRes.data ?? []) as ProductRow[]).sort(
          (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
        );
        setProducts(list);
        const firstFlower =
          list.find((p) => p.category === 'flower' && p.stock_quantity > 0) ??
          list.find((p) => p.category === 'flower');
        const firstWrap =
          list.find((p) => p.category === 'wrapping' && p.stock_quantity > 0) ??
          list.find((p) => p.category === 'wrapping');
        if (firstFlower) setSelectedFlowerId(firstFlower.id);
        if (firstWrap) setSelectedWrappingId(firstWrap.id);
      }

      if (settingsRes.data) {
        setSettings(settingsRes.data as StoreSettingsRow);
      }
      setLoadingCatalog(false);
    }

    loadStorefront();
    return () => {
      cancelled = true;
    };
  }, []);

  const flowers = useMemo(
    () => products.filter((p) => p.category === 'flower'),
    [products]
  );
  const wrappings = useMemo(
    () => products.filter((p) => p.category === 'wrapping'),
    [products]
  );
  const gifts = useMemo(
    () => products.filter((p) => p.category === 'gift'),
    [products]
  );

  const selectedFlower = useMemo(
    () => flowers.find((f) => f.id === selectedFlowerId) ?? flowers[0] ?? null,
    [flowers, selectedFlowerId]
  );
  const selectedWrapping = useMemo(
    () => wrappings.find((w) => w.id === selectedWrappingId) ?? wrappings[0] ?? null,
    [wrappings, selectedWrappingId]
  );
  const selectedGift = useMemo(
    () => gifts.find((g) => g.id === selectedGiftId) ?? null,
    [gifts, selectedGiftId]
  );

  const totalPriceIqd = useMemo(
    () =>
      calculateBouquetTotal({
        flowerPriceIqd: selectedFlower?.price_iqd ?? 0,
        flowerCount,
        wrappingPriceIqd: selectedWrapping?.price_iqd ?? 0,
        giftPriceIqd: selectedGift?.price_iqd ?? 0,
      }),
    [selectedFlower, flowerCount, selectedWrapping, selectedGift]
  );

  const phoneNumbers = useMemo(
    () => parseStorePhoneList(settings.phone_numbers),
    [settings.phone_numbers]
  );
  const whatsappNumbers = useMemo(
    () => parseStorePhoneList(settings.whatsapp_numbers || settings.phone_numbers),
    [settings.whatsapp_numbers, settings.phone_numbers]
  );
  const instagramUrl = useMemo(
    () => resolveInstagramUrl(settings.instagram_url),
    [settings.instagram_url]
  );

  const handleCountChange = (next: number) => {
    setFlowerCount(clampFlowerCount(next, selectedFlower?.stock_quantity));
  };

  const handleSubmitOrder = async (e: FormEvent) => {
    e.preventDefault();
    setOrderError(null);
    setOrderSuccess(null);

    if (!selectedFlower) {
      setOrderError('يرجى اختيار نوع الورد أولاً.');
      return;
    }

    const trimmedName = customerName.trim();
    const normalized = normalizePhone(customerPhone);

    if (trimmedName.length < 2) {
      setOrderError('يرجى إدخال الاسم الكامل.');
      return;
    }
    if (normalized.length < 9) {
      setOrderError('يرجى إدخال رقم هاتف صحيح.');
      return;
    }

    setSubmittingOrder(true);
    try {
      const details: BouquetOrderDetails = {
        flower_id: selectedFlower.id,
        flower_name: selectedFlower.name_ar,
        flower_unit_price_iqd: selectedFlower.price_iqd,
        flower_count: flowerCount,
        flower_color: selectedColor,
        bouquet_shape: selectedShape,
        wrapping_id: selectedWrapping?.id ?? null,
        wrapping_name: selectedWrapping?.name_ar ?? 'بدون تغليف',
        wrapping_price_iqd: selectedWrapping?.price_iqd ?? 0,
        gift_id: selectedGift?.id ?? null,
        gift_name: selectedGift?.name_ar ?? null,
        gift_price_iqd: selectedGift?.price_iqd ?? 0,
        delivery_address: deliveryAddress.trim() || null,
        city: cityArea.trim() || null,
        nearest_landmark: nearestLandmark.trim() || null,
        notes: orderNotes.trim() || null,
        payment_method: 'cash_on_delivery',
      };

      const { data: rpcData, error: rpcError } = await supabase.rpc('submit_sedo_order', {
        p_full_name: trimmedName,
        p_phone: normalized,
        p_birth_date: customerBirthDate || null,
        p_order_details: details,
        p_total_price_iqd: totalPriceIqd,
      });

      if (rpcError) {
        setOrderError(`تعذّر حفظ الطلب: ${rpcError.message}`);
        return;
      }

      const orderId =
        rpcData && typeof rpcData === 'object' && 'order_id' in rpcData
          ? String((rpcData as { order_id: string }).order_id).slice(0, 8)
          : 'SEDO';

      setOrderSuccess({
        id: orderId,
        total: totalPriceIqd,
        summary: formatOrderDetailsText(details),
      });
      setCustomerName('');
      setCustomerPhone('');
      setCustomerBirthDate('');
      setDeliveryAddress('');
      setCityArea('');
      setNearestLandmark('');
      setOrderNotes('');
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : 'حدث خطأ أثناء إرسال الطلب.');
    } finally {
      setSubmittingOrder(false);
    }
  };

  const handleLoyaltySearch = async (e: FormEvent) => {
    e.preventDefault();
    const rawTrimmed = loyaltyPhoneInput.trim();
    const normalized = normalizePhone(rawTrimmed);
    setLoyaltyError(null);
    setLoyaltyCustomer(null);
    setLoyaltyOrders([]);

    if (normalized.length < 7) {
      setLoyaltyError('يرجى إدخال رقم الهاتف للبحث.');
      return;
    }

    setLoyaltyLoading(true);
    setLoyaltySearched(true);
    try {
      const { data, error } = await supabase.rpc('get_loyalty_by_phone', {
        p_phone: normalized,
      });

      if (error) {
        setLoyaltyError(error.message || 'تعذّر البحث في بطاقة الولاء.');
        return;
      }

      const payload = (data ?? {}) as {
        customer?: CustomerRow | null;
        orders?: OrderRow[] | null;
      };
      setLoyaltyCustomer(payload.customer ?? null);
      setLoyaltyOrders(Array.isArray(payload.orders) ? payload.orders : []);
    } finally {
      setLoyaltyLoading(false);
    }
  };

  const mapsUrl =
    settings.google_maps_url || 'https://maps.google.com/?q=32.6027,44.0197';

  return (
    <div dir="rtl" className="min-h-screen bg-[#5E1D2F] text-white">
      {/* Header — NO admin link here per requirement */}
      <header className="sticky top-0 z-30 bg-[#461221]/95 backdrop-blur border-b border-white/15">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <a href="#top" className="flex items-center gap-3 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-[#0E0A0C] border border-white/20 flex items-center justify-center">
              <Flower2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-lg font-bold tracking-wide leading-none">SEDO</div>
              <div className="text-xs text-white/75 mt-0.5">للهدايا والزهور</div>
            </div>
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm text-white/85">
            <a href="#builder" className="hover:text-white transition">
              صمّم باقتك
            </a>
            <a href="#loyalty" className="hover:text-white transition">
              بطاقة الولاء
            </a>
            <a href="#location" className="hover:text-white transition">
              التواصل والموقع
            </a>
          </nav>

          <a
            href={formatWhatsAppUrl(whatsappNumbers[0] ?? OFFICIAL_PHONE_PRIMARY)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0E0A0C] text-white text-xs sm:text-sm font-medium border border-white/20 hover:bg-black transition shrink-0"
          >
            <MessageCircle className="w-4 h-4" />
            <span>تواصل واتساب</span>
          </a>
        </div>
      </header>

      {/* Hero */}
      <section id="top" className="bg-[#461221] border-b border-white/15">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 lg:py-14 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-6 space-y-5">
            <p className="text-xs sm:text-sm uppercase tracking-widest text-white/75">
              {settings.shop_name}
            </p>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold leading-tight text-white">
              صمّم باقتك الخاصة بذوقك الفاخر
            </h1>
            <p className="text-sm sm:text-base text-white/85 leading-relaxed max-w-xl">
              اختر نوع الورد الطبيعي، حدّد العدد واللون وشكل الباقة والتغليف والهدية
              المناسبة، واحصل على السعر الإجمالي مباشرة مع الدفع عند الاستلام.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <a
                href="#builder"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#0E0A0C] text-white text-sm font-semibold border border-white/25 hover:bg-black transition"
              >
                <Sparkles className="w-4 h-4" />
                <span>ابدأ تصميم باقتك</span>
              </a>
              <a
                href="#loyalty"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#5E1D2F] text-white text-sm font-medium border border-white/20 hover:bg-[#6E2438] transition"
              >
                <Award className="w-4 h-4 text-[#F48FB1]" />
                <span>بطاقة الولاء</span>
              </a>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="overflow-hidden rounded-2xl border border-white/20 bg-[#0E0A0C]">
              <img
                src={heroBouquetImg}
                alt="باقة ورد فاخرة من سيدو للزهور والهدايا"
                className="w-full aspect-[16/10] object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-16">
        {/* Section 1: Bouquet Builder */}
        <section id="builder" className="scroll-mt-20 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-white/15 pb-4">
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold text-white">صمّم باقتك</h2>
              <p className="text-sm text-white/80 mt-1">
                جميع الأسعار تُحدّث تلقائياً من قاعدة بيانات المتجر
              </p>
            </div>
            {selectedFlower && (
              <div className="text-sm text-white/85 tabular-nums-en">
                المجموع الحالي: <strong className="text-white">{formatIqd(totalPriceIqd)}</strong>
              </div>
            )}
          </div>

          {catalogError && (
            <div className="rounded-xl bg-[#0E0A0C] border border-white/30 p-4 text-sm text-white">
              {catalogError}
            </div>
          )}

          {loadingCatalog ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((idx) => (
                <div
                  key={idx}
                  className="h-56 rounded-2xl bg-[#6E2438]/70 border border-white/10 animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Left 8 Columns */}
              <div className="lg:col-span-8 space-y-8">
                {/* 1. Flower selection */}
                <div className="rounded-2xl bg-[#6E2438] border border-white/15 p-5 sm:p-6 space-y-4">
                  <h3 className="text-lg font-semibold text-white">1. اختر نوع الورد</h3>
                  {flowers.length === 0 ? (
                    <p className="text-sm text-white/75">لا توجد ورود متاحة حالياً.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {flowers.map((flower) => {
                        const isSelected = selectedFlower?.id === flower.id;
                        const outOfStock = flower.stock_quantity <= 0;
                        const imgSrc = flower.image_url || getFallbackProductImage(flower);
                        return (
                          <button
                            key={flower.id}
                            type="button"
                            disabled={outOfStock}
                            onClick={() => {
                              setSelectedFlowerId(flower.id);
                              setFlowerCount((prev) =>
                                clampFlowerCount(prev, flower.stock_quantity)
                              );
                            }}
                            className={`text-right rounded-2xl overflow-hidden border transition flex flex-col ${
                              isSelected
                                ? 'bg-[#0E0A0C] border-white ring-1 ring-white'
                                : 'bg-[#461221] border-white/15 hover:border-white/40'
                            } ${outOfStock ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                          >
                            <div className="relative w-full aspect-[16/10] bg-[#0E0A0C] overflow-hidden">
                              <img
                                src={imgSrc}
                                alt={flower.name_ar}
                                onError={(ev) => {
                                  ev.currentTarget.src = getFallbackProductImage(flower);
                                }}
                                className="w-full h-full object-cover"
                              />
                              {flower.is_featured && (
                                <span className="absolute top-2.5 right-2.5 px-2.5 py-0.5 rounded-lg bg-[#0E0A0C]/90 border border-white/25 text-[11px] text-[#F8BBD0]">
                                  مميز
                                </span>
                              )}
                            </div>
                            <div className="p-4 flex items-center justify-between gap-2 w-full">
                              <div>
                                <div className="font-semibold text-white text-base">
                                  {flower.name_ar}
                                </div>
                                {flower.description_ar && (
                                  <p className="text-xs text-white/70 mt-0.5 line-clamp-1">
                                    {flower.description_ar}
                                  </p>
                                )}
                                <div className="text-xs text-white/80 mt-1 tabular-nums-en">
                                  {outOfStock
                                    ? 'نفذت الكمية'
                                    : `${formatIqd(flower.price_iqd)} / وردة`}
                                </div>
                              </div>
                              {isSelected && (
                                <span className="w-7 h-7 rounded-lg bg-[#5E1D2F] border border-white/30 flex items-center justify-center shrink-0">
                                  <Check className="w-4 h-4 text-white" />
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 2. Quantity, Color, Shape */}
                <div className="rounded-2xl bg-[#6E2438] border border-white/15 p-5 sm:p-6 space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-white">2. عدد الورد</h3>
                      <span className="text-sm text-white/80 tabular-nums-en">
                        {flowerCount} وردة
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {QUICK_COUNTS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => handleCountChange(preset)}
                          className={`px-3.5 py-2 rounded-xl text-sm font-medium border tabular-nums-en transition ${
                            flowerCount === preset
                              ? 'bg-[#0E0A0C] text-white border-white'
                              : 'bg-[#461221] text-white/85 border-white/15 hover:border-white/40'
                          }`}
                        >
                          {preset}
                        </button>
                      ))}
                      <div className="flex items-center gap-1.5 mr-auto bg-[#0E0A0C] border border-white/20 rounded-xl p-1">
                        <button
                          type="button"
                          aria-label="إنقاص العدد"
                          onClick={() => handleCountChange(flowerCount - 1)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 transition"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={flowerCount}
                          onChange={(e) => handleCountChange(Number(e.target.value))}
                          className="w-14 bg-transparent text-center text-white text-sm font-semibold focus:outline-none tabular-nums-en"
                        />
                        <button
                          type="button"
                          aria-label="زيادة العدد"
                          onClick={() => handleCountChange(flowerCount + 1)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 transition"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 pt-2 border-t border-white/15">
                    <h3 className="text-lg font-semibold text-white">3. لون الباقة</h3>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
                      {FLOWER_COLORS.map((color) => {
                        const active = selectedColor === color;
                        return (
                          <button
                            key={color}
                            type="button"
                            onClick={() => setSelectedColor(color)}
                            className={`py-2.5 px-3 rounded-xl text-sm font-medium border transition ${
                              active
                                ? 'bg-[#0E0A0C] text-white border-white'
                                : 'bg-[#461221] text-white/85 border-white/15 hover:border-white/40'
                            }`}
                          >
                            {color}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-3 pt-2 border-t border-white/15">
                    <h3 className="text-lg font-semibold text-white">4. شكل الباقة</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {BOUQUET_SHAPES.map((shape) => {
                        const active = selectedShape === shape;
                        return (
                          <button
                            key={shape}
                            type="button"
                            onClick={() => setSelectedShape(shape)}
                            className={`py-3 px-4 rounded-xl text-sm font-medium border text-right flex items-center justify-between transition ${
                              active
                                ? 'bg-[#0E0A0C] text-white border-white'
                                : 'bg-[#461221] text-white/85 border-white/15 hover:border-white/40'
                            }`}
                          >
                            <span>{shape}</span>
                            {active && <Check className="w-4 h-4 text-white" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* 5. Wrapping */}
                <div className="rounded-2xl bg-[#6E2438] border border-white/15 p-5 sm:p-6 space-y-4">
                  <h3 className="text-lg font-semibold text-white">5. التغليف</h3>
                  {wrappings.length === 0 ? (
                    <p className="text-sm text-white/75">سيتم استخدام التغليف القياسي للمتجر.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {wrappings.map((wrap) => {
                        const isSelected = selectedWrapping?.id === wrap.id;
                        return (
                          <button
                            key={wrap.id}
                            type="button"
                            onClick={() => setSelectedWrappingId(wrap.id)}
                            className={`p-4 rounded-xl border text-right flex items-center justify-between gap-3 transition ${
                              isSelected
                                ? 'bg-[#0E0A0C] text-white border-white'
                                : 'bg-[#461221] text-white/90 border-white/15 hover:border-white/40'
                            }`}
                          >
                            <div>
                              <div className="font-semibold text-sm">{wrap.name_ar}</div>
                              <div className="text-xs text-white/75 mt-1 tabular-nums-en">
                                {formatIqd(wrap.price_iqd)}
                              </div>
                            </div>
                            {isSelected && <Check className="w-4 h-4 text-white shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 6. Optional Gift */}
                <div className="rounded-2xl bg-[#6E2438] border border-white/15 p-5 sm:p-6 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold text-white">6. هدية اختيارية</h3>
                    <span className="text-xs text-white/75">اختياري</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedGiftId('')}
                      className={`p-4 rounded-xl border text-right flex items-center justify-between transition ${
                        selectedGiftId === ''
                          ? 'bg-[#0E0A0C] text-white border-white'
                          : 'bg-[#461221] text-white/90 border-white/15 hover:border-white/40'
                      }`}
                    >
                      <div>
                        <div className="font-semibold text-sm">بدون هدية إضافية</div>
                        <div className="text-xs text-white/75 mt-1 tabular-nums-en">0 د.ع</div>
                      </div>
                      {selectedGiftId === '' && <Check className="w-4 h-4 text-white" />}
                    </button>

                    {gifts.map((gift) => {
                      const isSelected = selectedGift?.id === gift.id;
                      const outOfStock = gift.stock_quantity <= 0;
                      return (
                        <button
                          key={gift.id}
                          type="button"
                          disabled={outOfStock}
                          onClick={() => setSelectedGiftId(gift.id)}
                          className={`p-4 rounded-xl border text-right flex items-center justify-between gap-3 transition ${
                            isSelected
                              ? 'bg-[#0E0A0C] text-white border-white'
                              : 'bg-[#461221] text-white/90 border-white/15 hover:border-white/40'
                          } ${outOfStock ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          <div className="flex items-center gap-3">
                            <Gift className="w-4 h-4 text-white/80 shrink-0" />
                            <div>
                              <div className="font-semibold text-sm">{gift.name_ar}</div>
                              <div className="text-xs text-white/75 mt-0.5 tabular-nums-en">
                                {outOfStock ? 'نفذت الكمية' : formatIqd(gift.price_iqd)}
                              </div>
                            </div>
                          </div>
                          {isSelected && <Check className="w-4 h-4 text-white shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Right 4 Columns: Live Summary & Customer Form (Cash on Delivery ONLY, No Email) */}
              <aside className="lg:col-span-4 lg:sticky lg:top-24 rounded-2xl bg-[#0E0A0C] border border-white/25 p-5 sm:p-6 space-y-5">
                <div className="space-y-3 border-b border-white/15 pb-4">
                  <h3 className="text-xl font-bold text-white">ملخص الباقة</h3>
                  <div className="space-y-2 text-sm text-white/85">
                    <div className="flex justify-between gap-2">
                      <span>
                        {selectedFlower ? `${selectedFlower.name_ar} (× ${flowerCount})` : 'الورد'}
                      </span>
                      <span className="tabular-nums-en text-white">
                        {formatIqd((selectedFlower?.price_iqd ?? 0) * flowerCount)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span>اللون والشكل</span>
                      <span className="text-white">
                        {selectedColor} • {selectedShape}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span>{selectedWrapping ? selectedWrapping.name_ar : 'التغليف'}</span>
                      <span className="tabular-nums-en text-white">
                        {formatIqd(selectedWrapping?.price_iqd ?? 0)}
                      </span>
                    </div>
                    {selectedGift && (
                      <div className="flex justify-between gap-2">
                        <span>{selectedGift.name_ar}</span>
                        <span className="tabular-nums-en text-white">
                          {formatIqd(selectedGift.price_iqd)}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="pt-3 border-t border-white/15 flex items-center justify-between">
                    <span className="text-base font-semibold text-white">السعر الإجمالي</span>
                    <span className="text-2xl font-bold text-white tabular-nums-en">
                      {formatIqd(totalPriceIqd)}
                    </span>
                  </div>
                </div>

                <form onSubmit={handleSubmitOrder} className="space-y-3.5">
                  <div>
                    <label htmlFor="customer-name" className="block text-xs font-medium text-white mb-1">
                      الاسم الكامل
                    </label>
                    <input
                      id="customer-name"
                      type="text"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="أدخل اسمك الكامل"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#461221] border border-white/20 text-white placeholder:text-white/50 text-sm focus:outline-none focus:border-white"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
                    <div>
                      <label htmlFor="customer-phone" className="block text-xs font-medium text-white mb-1">
                        رقم الهاتف
                      </label>
                      <input
                        id="customer-phone"
                        type="tel"
                        dir="ltr"
                        required
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="0776 000 0000"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[#461221] border border-white/20 text-white placeholder:text-white/50 text-sm text-right focus:outline-none focus:border-white tabular-nums-en"
                      />
                    </div>

                    <div>
                      <label htmlFor="customer-birthdate" className="block text-xs font-medium text-white mb-1">
                        تاريخ الميلاد
                      </label>
                      <input
                        id="customer-birthdate"
                        type="date"
                        value={customerBirthDate}
                        onChange={(e) => setCustomerBirthDate(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[#461221] border border-white/20 text-white text-sm focus:outline-none focus:border-white tabular-nums-en"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label htmlFor="customer-city" className="block text-xs text-white/85 mb-1">
                        المدينة / المنطقة
                      </label>
                      <input
                        id="customer-city"
                        type="text"
                        value={cityArea}
                        onChange={(e) => setCityArea(e.target.value)}
                        placeholder="كربلاء / حي الميلاد"
                        className="w-full px-3 py-2 rounded-xl bg-[#461221] border border-white/20 text-white placeholder:text-white/45 text-xs focus:outline-none focus:border-white"
                      />
                    </div>
                    <div>
                      <label htmlFor="customer-landmark" className="block text-xs text-white/85 mb-1">
                        أقرب نقطة دالة
                      </label>
                      <input
                        id="customer-landmark"
                        type="text"
                        value={nearestLandmark}
                        onChange={(e) => setNearestLandmark(e.target.value)}
                        placeholder="مثال: مجاور كوفي الدرة"
                        className="w-full px-3 py-2 rounded-xl bg-[#461221] border border-white/20 text-white placeholder:text-white/45 text-xs focus:outline-none focus:border-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="customer-address" className="block text-xs text-white/85 mb-1">
                      عنوان التوصيل
                    </label>
                    <input
                      id="customer-address"
                      type="text"
                      value={deliveryAddress}
                      onChange={(e) => setDeliveryAddress(e.target.value)}
                      placeholder="تفاصيل العنوان أو استلام من المتجر"
                      className="w-full px-3.5 py-2 rounded-xl bg-[#461221] border border-white/20 text-white placeholder:text-white/45 text-xs focus:outline-none focus:border-white"
                    />
                  </div>

                  <div>
                    <label htmlFor="customer-notes" className="block text-xs text-white/85 mb-1">
                      ملاحظات الطلب / عبارة الكارت
                    </label>
                    <input
                      id="customer-notes"
                      type="text"
                      value={orderNotes}
                      onChange={(e) => setOrderNotes(e.target.value)}
                      placeholder="اختياري..."
                      className="w-full px-3.5 py-2 rounded-xl bg-[#461221] border border-white/20 text-white placeholder:text-white/45 text-xs focus:outline-none focus:border-white"
                    />
                  </div>

                  {/* Cash on Delivery ONLY */}
                  <div className="p-3 rounded-xl bg-[#461221] border border-white/20 flex items-center gap-2.5 text-xs text-white">
                    <Banknote className="w-4 h-4 shrink-0" />
                    <span>طريقة الدفع: الدفع نقداً عند الاستلام فقط</span>
                  </div>

                  {orderError && (
                    <div className="p-3 rounded-xl bg-[#5E1D2F] border border-white/40 text-xs text-white leading-relaxed">
                      {orderError}
                    </div>
                  )}

                  {orderSuccess && (
                    <div className="p-4 rounded-xl bg-[#461221] border border-white/50 space-y-1.5 text-sm">
                      <div className="font-bold text-white flex items-center gap-2">
                        <PackageCheck className="w-4 h-4" />
                        <span>تم إرسال طلبك بنجاح!</span>
                      </div>
                      <p className="text-xs text-white/85 tabular-nums-en">
                        رقم المرجع: #{orderSuccess.id} • المجموع: {formatIqd(orderSuccess.total)}
                      </p>
                      <p className="text-xs text-white/75">{orderSuccess.summary}</p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submittingOrder || !selectedFlower}
                    className="w-full py-3.5 px-5 rounded-xl bg-[#5E1D2F] hover:bg-[#7C2C42] disabled:opacity-50 text-white font-semibold text-sm border border-white/30 transition cursor-pointer"
                  >
                    {submittingOrder ? 'جاري إرسال الطلب...' : 'إرسال الطلب'}
                  </button>
                </form>
              </aside>
            </div>
          )}
        </section>

        {/* Section 2: Loyalty Card (Subtle Pink Accent Preserved on Stamps) */}
        <section
          id="loyalty"
          className="scroll-mt-20 rounded-2xl bg-[#461221] border border-white/15 p-6 sm:p-8 space-y-6"
        >
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-2xl sm:text-3xl font-bold text-white">بطاقة الولاء</h2>
              <p className="text-sm text-white/80">
                ابحث برقم هاتفك لمعرفة عدد الأختام المتوفرة (من 10) وسجل طلباتك في SEDO
              </p>
            </div>

            <form
              onSubmit={handleLoyaltySearch}
              className="flex flex-col sm:flex-row gap-2.5 w-full md:w-auto md:min-w-[380px]"
            >
              <input
                type="tel"
                dir="ltr"
                value={loyaltyPhoneInput}
                onChange={(e) => setLoyaltyPhoneInput(e.target.value)}
                placeholder="أدخل رقم الهاتف (مثال: 07762963674)"
                className="flex-1 px-4 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/25 text-white placeholder:text-white/50 text-sm text-right focus:outline-none focus:border-white tabular-nums-en"
              />
              <button
                type="submit"
                disabled={loyaltyLoading}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#0E0A0C] text-white text-sm font-semibold border border-white/30 hover:bg-black transition cursor-pointer shrink-0"
              >
                <Search className="w-4 h-4" />
                <span>{loyaltyLoading ? 'جاري البحث...' : 'بحث'}</span>
              </button>
            </form>
          </div>

          {loyaltyError && (
            <div className="p-3.5 rounded-xl bg-[#0E0A0C] border border-white/30 text-sm text-white">
              {loyaltyError}
            </div>
          )}

          {loyaltySearched && !loyaltyLoading && !loyaltyError && (
            <div className="space-y-6 pt-2 border-t border-white/15">
              {loyaltyCustomer ? (
                <div className="rounded-2xl bg-[#0E0A0C] border border-[#F48FB1]/40 p-5 sm:p-6 space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="text-lg font-bold text-white">
                        {loyaltyCustomer.full_name}
                      </div>
                      <div className="text-sm text-white/75 tabular-nums-en mt-0.5">
                        {loyaltyCustomer.phone}
                      </div>
                    </div>
                    <div className="text-left sm:text-right">
                      <div className="text-xs text-white/70">عدد الأختام</div>
                      <div className="text-2xl font-bold text-[#F48FB1] tabular-nums-en">
                        {Math.min(10, Math.max(0, loyaltyCustomer.stamps_count ?? 0))} / 10
                      </div>
                    </div>
                  </div>

                  {/* 10 Stamp Grid with Pink Loyalty Stamp Accent */}
                  <div className="grid grid-cols-5 sm:grid-cols-10 gap-2.5">
                    {Array.from({ length: 10 }, (_, idx) => {
                      const filled = idx < (loyaltyCustomer.stamps_count ?? 0);
                      const isTenthReward = idx === 9;
                      return (
                        <div
                          key={idx}
                          className={`aspect-square rounded-xl border flex flex-col items-center justify-center gap-1 transition ${
                            filled
                              ? 'bg-[#5E1D2F] border-[#F48FB1] text-[#F8BBD0]'
                              : isTenthReward
                              ? 'bg-[#461221]/60 border-[#F48FB1]/35 text-[#F48FB1]/70'
                              : 'bg-[#461221]/40 border-white/15 text-white/40'
                          }`}
                        >
                          {isTenthReward ? (
                            <Gift className="w-4 h-4" />
                          ) : (
                            <Flower2 className="w-4 h-4" />
                          )}
                          <span className="text-[11px] tabular-nums-en">{idx + 1}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl bg-[#0E0A0C] border border-white/15 p-4 text-sm text-white/80">
                  لم يتم العثور على بطاقة ولاء مسجلة لهذا الرقم حتى الآن.
                </div>
              )}

              <div className="space-y-3">
                <h3 className="text-base font-semibold text-white">سجل الطلبات</h3>
                {loyaltyOrders.length === 0 ? (
                  <p className="text-sm text-white/75">لا توجد طلبات مسجلة لهذا الرقم.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {loyaltyOrders.map((ord) => (
                      <div
                        key={ord.id}
                        className="rounded-xl bg-[#5E1D2F] border border-white/15 p-4 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2 text-xs text-white/75 tabular-nums-en">
                          <span>#{ord.id.slice(0, 8)}</span>
                          <span>{formatDateTimeEn(ord.created_at)}</span>
                        </div>
                        <p className="text-sm text-white leading-relaxed">
                          {formatOrderDetailsText(ord.order_details)}
                        </p>
                        <div className="flex items-center justify-between pt-2 border-t border-white/10 text-sm">
                          <span className="font-semibold text-white tabular-nums-en">
                            {formatIqd(ord.total_price_iqd)}
                          </span>
                          <span className="px-2.5 py-1 rounded-lg bg-[#0E0A0C] border border-white/20 text-xs text-white">
                            {ADMIN_STATUS_LABELS[ord.status] ?? ord.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Footer: Store Info, Official Phones, WhatsApp, Instagram, Map, and Discreet "دخول الإدارة" */}
      <footer id="location" className="bg-[#0E0A0C] border-t border-white/15 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 space-y-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-5 space-y-5">
              <div>
                <h2 className="text-2xl font-bold text-white">{settings.shop_name}</h2>
                <p className="text-sm text-white/75 mt-1">
                  زورونا أو تواصلوا معنا عبر الهاتف والواتساب والإنستغرام
                </p>
              </div>

              <div className="space-y-3.5 text-sm text-white/90">
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-white shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs text-white/60">العنوان</div>
                    <div className="mt-0.5 leading-relaxed">{settings.address}</div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Clock className="w-5 h-5 text-white shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs text-white/60">ساعات العمل</div>
                    <div className="mt-0.5 leading-relaxed">{settings.working_hours}</div>
                  </div>
                </div>

                {/* Official Phone Call & WhatsApp Buttons */}
                <div className="space-y-2.5 pt-1">
                  <div className="text-xs text-white/60">أرقام التواصل والواتساب</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {phoneNumbers.map((num) => (
                      <a
                        key={`tel-${num}`}
                        href={`tel:${num}`}
                        className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-[#461221] border border-white/20 text-white text-xs font-medium hover:bg-[#5E1D2F] transition tabular-nums-en"
                      >
                        <Phone className="w-4 h-4 shrink-0" />
                        <span dir="ltr">{num}</span>
                      </a>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {whatsappNumbers.map((num) => (
                      <a
                        key={`wa-${num}`}
                        href={formatWhatsAppUrl(num)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-[#5E1D2F] border border-white/25 text-white text-xs font-medium hover:bg-[#6E2438] transition tabular-nums-en"
                      >
                        <MessageCircle className="w-4 h-4 shrink-0" />
                        <span>واتساب</span>
                        <span dir="ltr">{num}</span>
                      </a>
                    ))}
                  </div>
                </div>

                <div className="pt-1 flex flex-wrap gap-2.5">
                  <a
                    href={instagramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#461221] border border-white/20 text-white text-xs font-medium hover:bg-[#5E1D2F] transition"
                  >
                    <Instagram className="w-4 h-4" />
                    <span>إنستغرام SEDO</span>
                  </a>
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#5E1D2F] border border-white/25 text-white text-xs font-medium hover:bg-[#6E2438] transition"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>فتح في خرائط Google</span>
                  </a>
                </div>
              </div>
            </div>

            <div className="lg:col-span-7">
              <StoreLocationMap
                shopName={settings.shop_name}
                address={settings.address}
                mapsUrl={mapsUrl}
              />
            </div>
          </div>

          {/* Discreet Admin Entry Link at the Very Bottom of the Footer */}
          <div className="pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-white/60">
            <span>© {new Date().getFullYear()} {settings.shop_name} — جميع الحقوق محفوظة</span>
            <button
              type="button"
              onClick={onOpenAdmin}
              className="text-xs text-white/65 hover:text-white transition cursor-pointer underline-offset-4 hover:underline"
            >
              دخول الإدارة
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
