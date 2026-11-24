import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
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
  Check,
  Clock,
  ExternalLink,
  Flower2,
  Gift,
  Instagram,
  LogOut,
  MapPin,
  Minus,
  PackageCheck,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { supabase } from '../supabaseclient.tsx';
import {
  calculateBouquetTotal,
  clampFlowerCount,
  extractCoordsFromMapsUrl,
  formatIqd,
  formatOrderDetailsText,
  nextStampCount,
  normalizePhone,
  type BouquetOrderDetails,
} from './pricing.ts';
import bouquetRedImg from './assets/images/bouquet_red_velvet_1795361896339.jpg';
import bouquetWhiteImg from './assets/images/bouquet_ivory_blush_1795361894392.jpg';
import bouquetMixedImg from './assets/images/bouquet_golden_sun_1795361894089.jpg';
import heroBouquetImg from './assets/images/hero_sedo_bouquet_1795361895118.jpg';
import giftCollectionImg from './assets/images/gift_luxury_collection_1795361894946.jpg';
import boutiqueImg from './assets/images/store_sedo_boutique_1795361894413.jpg';

type RoutePath = 'home' | 'admin';
type OrderStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled';

interface ProductRow {
  id: string;
  name_ar: string;
  category: 'flower' | 'wrapping' | 'gift' | string;
  price_iqd: number;
  image_url: string | null;
  stock_quantity: number;
  low_stock_threshold: number;
  is_active: boolean;
  created_at?: string;
}

interface CustomerRow {
  id: string;
  created_at?: string;
  full_name: string;
  phone: string;
  birth_date: string | null;
  stamps_count: number;
  total_orders: number;
}

interface OrderRow {
  id: string;
  created_at: string;
  status: OrderStatus | string;
  total_price_iqd: number;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  customer_birth_date: string | null;
  order_details: BouquetOrderDetails | Record<string, unknown> | string | null;
}

interface StoreSettingsRow {
  id: number;
  shop_name: string;
  address: string;
  working_hours: string;
  phone_numbers: string | null;
  instagram_url: string | null;
  google_maps_url: string | null;
}

interface ProductDraft {
  price_iqd: string;
  stock_quantity: string;
  is_active: boolean;
}

const FLOWER_COLORS = ['أحمر', 'أبيض', 'وردي', 'مشكّل', 'أصفر', 'بنفسجي'] as const;
const BOUQUET_SHAPES = [
  'كلاسيكية دائرية',
  'طولية فاخرة',
  'بوكس هدايا',
  'باقة يدوية ناعمة',
] as const;
const QUICK_COUNTS = [5, 7, 11, 15, 21, 31] as const;

const STATUS_LABELS: Record<string, string> = {
  pending: 'قيد الانتظار',
  confirmed: 'مؤكد',
  completed: 'مكتمل',
  cancelled: 'ملغي',
};

const CATEGORY_LABELS: Record<string, string> = {
  flower: 'ورد',
  wrapping: 'تغليف',
  gift: 'هدية',
};

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
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function translateAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('invalid login credentials')) {
    return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
  }
  if (lower.includes('email not confirmed')) {
    return 'الحساب بانتظار تأكيد البريد الإلكتروني في Supabase.';
  }
  return message;
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
    <APIProvider
      apiKey={MAPS_API_KEY}
      language="ar"
      region="IQ"
      libraries={['marker']}
    >
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
    return <AdminPage onBackHome={() => navigateTo('home')} />;
  }

  return <HomePage onOpenAdmin={() => navigateTo('admin')} />;
}

function HomePage({ onOpenAdmin }: { onOpenAdmin: () => void }) {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [settings, setSettings] = useState<StoreSettingsRow>({
    id: 1,
    shop_name: 'SEDO للهدايا والزهور',
    address: 'كربلاء - حي الميلاد - شارع الدرة',
    working_hours: 'يومياً من 9:00 صباحاً إلى 1:00 بعد منتصف الليل',
    phone_numbers: null,
    instagram_url: null,
    google_maps_url: 'https://maps.google.com/?q=32.6027,44.0197',
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

  // Customer form state (ONLY name, phone, birth_date — NO email)
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerBirthDate, setCustomerBirthDate] = useState('');
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
        const list = (productsRes.data ?? []) as ProductRow[];
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
      {/* Header */}
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
              العنوان وساعات العمل
            </a>
          </nav>

          <button
            type="button"
            onClick={onOpenAdmin}
            className="px-4 py-2 rounded-xl bg-[#0E0A0C] text-white text-xs sm:text-sm font-medium border border-white/20 hover:bg-black transition shrink-0"
          >
            لوحة الإدارة
          </button>
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
              المناسبة، واحصل على السعر الإجمالي مباشرة وأرسل طلبك خلال ثوانٍ.
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
                <Award className="w-4 h-4" />
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
              {/* Left 8 Columns: Options */}
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
                            <div className="w-full aspect-[16/10] bg-[#0E0A0C] overflow-hidden">
                              <img
                                src={imgSrc}
                                alt={flower.name_ar}
                                onError={(ev) => {
                                  ev.currentTarget.src = getFallbackProductImage(flower);
                                }}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="p-4 flex items-center justify-between gap-2 w-full">
                              <div>
                                <div className="font-semibold text-white text-base">
                                  {flower.name_ar}
                                </div>
                                <div className="text-xs text-white/75 mt-1 tabular-nums-en">
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
                  {/* Quantity */}
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

                  {/* Color */}
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

                  {/* Shape */}
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

              {/* Right 4 Columns: Live Summary & Customer Form */}
              <aside className="lg:col-span-4 lg:sticky lg:top-24 rounded-2xl bg-[#0E0A0C] border border-white/25 p-5 sm:p-6 space-y-6">
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

                {/* Customer Form: Name, Phone, Birth Date ONLY */}
                <form onSubmit={handleSubmitOrder} className="space-y-4">
                  <div>
                    <label htmlFor="customer-name" className="block text-sm font-medium text-white mb-1.5">
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

                  <div>
                    <label htmlFor="customer-phone" className="block text-sm font-medium text-white mb-1.5">
                      رقم الهاتف
                    </label>
                    <input
                      id="customer-phone"
                      type="tel"
                      dir="ltr"
                      required
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="0770 000 0000"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#461221] border border-white/20 text-white placeholder:text-white/50 text-sm text-right focus:outline-none focus:border-white tabular-nums-en"
                    />
                  </div>

                  <div>
                    <label htmlFor="customer-birthdate" className="block text-sm font-medium text-white mb-1.5">
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

        {/* Section 2: Loyalty Card */}
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
                placeholder="أدخل رقم الهاتف (مثال: 07701234567)"
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
                <div className="rounded-2xl bg-[#0E0A0C] border border-white/20 p-5 sm:p-6 space-y-5">
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
                      <div className="text-2xl font-bold text-white tabular-nums-en">
                        {Math.min(10, Math.max(0, loyaltyCustomer.stamps_count ?? 0))} / 10
                      </div>
                    </div>
                  </div>

                  {/* 10 Stamp Grid */}
                  <div className="grid grid-cols-5 sm:grid-cols-10 gap-2.5">
                    {Array.from({ length: 10 }, (_, idx) => {
                      const filled = idx < (loyaltyCustomer.stamps_count ?? 0);
                      return (
                        <div
                          key={idx}
                          className={`aspect-square rounded-xl border flex flex-col items-center justify-center gap-1 transition ${
                            filled
                              ? 'bg-[#5E1D2F] border-white text-white'
                              : 'bg-[#461221]/40 border-white/15 text-white/40'
                          }`}
                        >
                          <Flower2 className="w-4 h-4" />
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

              {/* Customer Order History */}
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
                            {STATUS_LABELS[ord.status] ?? ord.status}
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

      {/* Footer: Address, Working Hours & Google Map */}
      <footer id="location" className="bg-[#0E0A0C] border-t border-white/15 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-5 space-y-5">
            <div>
              <h2 className="text-2xl font-bold text-white">{settings.shop_name}</h2>
              <p className="text-sm text-white/75 mt-1">
                زورونا لاختيار أرقى باقات الورد والهدايا الفاخرة
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

              {settings.phone_numbers && (
                <div className="flex items-start gap-3">
                  <Phone className="w-5 h-5 text-white shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs text-white/60">الهاتف</div>
                    <div className="mt-0.5 tabular-nums-en" dir="ltr">
                      {settings.phone_numbers}
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-2 flex flex-wrap gap-2.5">
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#5E1D2F] border border-white/25 text-white text-xs font-medium hover:bg-[#6E2438] transition"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>فتح في خرائط Google</span>
                </a>
                {settings.instagram_url && (
                  <a
                    href={settings.instagram_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#461221] border border-white/20 text-white text-xs font-medium hover:bg-[#5E1D2F] transition"
                  >
                    <Instagram className="w-4 h-4" />
                    <span>حساب الانستغرام</span>
                  </a>
                )}
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
      </footer>
    </div>
  );
}

function AdminPage({ onBackHome }: { onBackHome: () => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  // Email + Password login only
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Admin data
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [productDrafts, setProductDrafts] = useState<Record<string, ProductDraft>>({});
  const [loadingData, setLoadingData] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [busyProductId, setBusyProductId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session ?? null);
      setAuthReady(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const loadAdminData = useCallback(async () => {
    setLoadingData(true);
    setActionError(null);
    const [ordersRes, productsRes] = await Promise.all([
      supabase.from('orders').select('*').order('created_at', { ascending: false }),
      supabase.from('products').select('*').order('created_at', { ascending: true }),
    ]);

    if (ordersRes.error) {
      setActionError(`تعذّر جلب الطلبات: ${ordersRes.error.message}`);
    } else {
      setOrders((ordersRes.data ?? []) as OrderRow[]);
    }

    if (productsRes.error) {
      setActionError(`تعذّر جلب المنتجات: ${productsRes.error.message}`);
    } else {
      const list = (productsRes.data ?? []) as ProductRow[];
      setProducts(list);
      const drafts: Record<string, ProductDraft> = {};
      for (const item of list) {
        drafts[item.id] = {
          price_iqd: String(item.price_iqd),
          stock_quantity: String(item.stock_quantity),
          is_active: item.is_active,
        };
      }
      setProductDrafts(drafts);
    }

    setLoadingData(false);
  }, []);

  useEffect(() => {
    if (session) {
      loadAdminData();
    }
  }, [session, loadAdminData]);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      setAuthError(translateAuthError(error.message));
    }
    setAuthLoading(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setOrders([]);
    setProducts([]);
  };

  const handleOrderStatus = async (orderId: string, status: OrderStatus) => {
    setBusyOrderId(orderId);
    setActionError(null);
    setActionMessage(null);
    const { error } = await supabase.from('orders').update({ status }).eq('id', orderId);
    if (error) {
      setActionError(`فشل تحديث حالة الطلب: ${error.message}`);
    } else {
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status } : o)));
      setActionMessage(`تم تحديث حالة الطلب إلى: ${STATUS_LABELS[status]}`);
    }
    setBusyOrderId(null);
  };

  const handleAddStamp = async (order: OrderRow) => {
    setBusyOrderId(order.id);
    setActionError(null);
    setActionMessage(null);

    try {
      const normalized = normalizePhone(order.customer_phone);
      let customer: CustomerRow | null = null;

      if (order.customer_id) {
        const res = await supabase
          .from('customers')
          .select('*')
          .eq('id', order.customer_id)
          .maybeSingle();
        customer = (res.data as CustomerRow | null) ?? null;
      }

      if (!customer && normalized) {
        const res = await supabase
          .from('customers')
          .select('*')
          .eq('phone', normalized)
          .maybeSingle();
        customer = (res.data as CustomerRow | null) ?? null;
      }

      if (!customer) {
        const created = await supabase
          .from('customers')
          .insert({
            full_name: order.customer_name,
            phone: normalized || order.customer_phone,
            birth_date: order.customer_birth_date ?? null,
            stamps_count: 0,
            total_orders: 1,
          })
          .select('*')
          .single();

        if (created.error) {
          setActionError(`تعذّر إنشاء سجل الزبون للختم: ${created.error.message}`);
          setBusyOrderId(null);
          return;
        }
        customer = created.data as CustomerRow;
      }

      const currentStamps = customer.stamps_count ?? 0;
      if (currentStamps >= 10) {
        setActionMessage(`الزبون ${customer.full_name} مكتمل الأختام بالفعل (10 / 10).`);
        setBusyOrderId(null);
        return;
      }

      const nextStamps = nextStampCount(currentStamps, 10);

      const updateRes = await supabase
        .from('customers')
        .update({ stamps_count: nextStamps })
        .eq('id', customer.id);

      if (updateRes.error) {
        setActionError(`فشل تحديث عداد الأختام: ${updateRes.error.message}`);
        setBusyOrderId(null);
        return;
      }

      const logRes = await supabase.from('loyalty_logs').insert({
        customer_id: customer.id,
        order_id: order.id,
        action: 'add_stamp',
        notes: `إضافة ختم ولاء (${currentStamps} -> ${nextStamps})`,
      });

      if (logRes.error) {
        setActionError(
          `تمت زيادة الأختام إلى ${nextStamps}/10 ولكن تعذّر تسجيل loyalty_logs: ${logRes.error.message}`
        );
      } else {
        setActionMessage(
          `تمت إضافة ختم للزبون ${customer.full_name} (الأختام الآن: ${nextStamps} / 10).`
        );
      }
    } finally {
      setBusyOrderId(null);
    }
  };

  const updateDraft = (productId: string, patch: Partial<ProductDraft>) => {
    setProductDrafts((prev) => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        ...patch,
      },
    }));
  };

  const handleSaveProduct = async (productId: string) => {
    const draft = productDrafts[productId];
    if (!draft) return;

    const price = Math.max(0, Math.round(Number(draft.price_iqd) || 0));
    const stock = Math.max(0, Math.round(Number(draft.stock_quantity) || 0));

    setBusyProductId(productId);
    setActionError(null);
    setActionMessage(null);

    const { error } = await supabase
      .from('products')
      .update({
        price_iqd: price,
        stock_quantity: stock,
        is_active: draft.is_active,
      })
      .eq('id', productId);

    if (error) {
      setActionError(`تعذّر حفظ المنتج: ${error.message}`);
    } else {
      setProducts((prev) =>
        prev.map((p) =>
          p.id === productId
            ? { ...p, price_iqd: price, stock_quantity: stock, is_active: draft.is_active }
            : p
        )
      );
      setActionMessage('تم حفظ تعديلات المنتج في قاعدة البيانات.');
    }
    setBusyProductId(null);
  };

  if (!authReady) {
    return (
      <div
        dir="rtl"
        className="min-h-screen bg-[#5E1D2F] text-white flex items-center justify-center p-6"
      >
        <div className="text-sm text-white/80">جاري التحقق من الجلسة...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div
        dir="rtl"
        className="min-h-screen bg-[#5E1D2F] text-white flex items-center justify-center p-4"
      >
        <div className="w-full max-w-md rounded-2xl bg-[#461221] border border-white/20 p-6 sm:p-8 space-y-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#0E0A0C] border border-white/20 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">إدارة SEDO</h1>
                <p className="text-xs text-white/75">تسجيل الدخول عبر Supabase Auth</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onBackHome}
              className="text-xs text-white/80 hover:text-white underline cursor-pointer"
            >
              المتجر
            </button>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="admin-email" className="block text-sm font-medium text-white mb-1.5">
                البريد الإلكتروني
              </label>
              <input
                id="admin-email"
                type="email"
                dir="ltr"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@sedoflowers.com"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/25 text-white placeholder:text-white/45 text-sm text-left focus:outline-none focus:border-white"
              />
            </div>

            <div>
              <label htmlFor="admin-password" className="block text-sm font-medium text-white mb-1.5">
                كلمة المرور
              </label>
              <input
                id="admin-password"
                type="password"
                dir="ltr"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/25 text-white placeholder:text-white/45 text-sm text-left focus:outline-none focus:border-white"
              />
            </div>

            {authError && (
              <div className="p-3 rounded-xl bg-[#0E0A0C] border border-white/40 text-xs text-white">
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-3 rounded-xl bg-[#0E0A0C] hover:bg-black disabled:opacity-50 text-white font-semibold text-sm border border-white/25 transition cursor-pointer"
            >
              {authLoading ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-[#5E1D2F] text-white">
      <header className="bg-[#461221] border-b border-white/15">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white">لوحة إدارة SEDO</h1>
            <p className="text-xs text-white/75 mt-0.5" dir="ltr">
              {session.user.email}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={loadAdminData}
              disabled={loadingData}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-xs font-medium text-white hover:bg-black transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingData ? 'animate-spin' : ''}`} />
              <span>تحديث</span>
            </button>
            <button
              type="button"
              onClick={onBackHome}
              className="px-3.5 py-2 rounded-xl bg-[#6E2438] border border-white/20 text-xs font-medium text-white hover:bg-[#7C2C42] transition cursor-pointer"
            >
              عرض المتجر
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-xs font-medium text-white hover:bg-black transition cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>خروج</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-10">
        {actionError && (
          <div className="rounded-xl bg-[#0E0A0C] border border-white/40 p-4 text-sm text-white">
            {actionError}
          </div>
        )}
        {actionMessage && (
          <div className="rounded-xl bg-[#461221] border border-white/40 p-4 text-sm text-white">
            {actionMessage}
          </div>
        )}

        {/* Orders Table */}
        <section className="rounded-2xl bg-[#461221] border border-white/15 p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl font-bold text-white">الطلبات ({orders.length})</h2>
          </div>

          {orders.length === 0 ? (
            <p className="text-sm text-white/75 py-4">لا توجد طلبات مسجلة حالياً.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm border-collapse min-w-[820px]">
                <thead>
                  <tr className="border-b border-white/15 text-xs text-white/75">
                    <th className="py-3 px-3 font-medium">الطلب / التاريخ</th>
                    <th className="py-3 px-3 font-medium">الزبون</th>
                    <th className="py-3 px-3 font-medium">تفاصيل الباقة</th>
                    <th className="py-3 px-3 font-medium">الإجمالي</th>
                    <th className="py-3 px-3 font-medium">الحالة</th>
                    <th className="py-3 px-3 font-medium">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {orders.map((order) => {
                    const isBusy = busyOrderId === order.id;
                    return (
                      <tr key={order.id} className="align-top">
                        <td className="py-3.5 px-3 tabular-nums-en">
                          <div className="font-semibold text-white">#{order.id.slice(0, 8)}</div>
                          <div className="text-xs text-white/65 mt-0.5">
                            {formatDateTimeEn(order.created_at)}
                          </div>
                        </td>
                        <td className="py-3.5 px-3">
                          <div className="font-medium text-white">{order.customer_name}</div>
                          <div className="text-xs text-white/75 tabular-nums-en mt-0.5" dir="ltr">
                            {order.customer_phone}
                          </div>
                          {order.customer_birth_date && (
                            <div className="text-xs text-white/60 tabular-nums-en mt-0.5">
                              الميلاد: {order.customer_birth_date}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-3 text-xs text-white/85 max-w-xs leading-relaxed">
                          {formatOrderDetailsText(order.order_details)}
                        </td>
                        <td className="py-3.5 px-3 font-semibold text-white tabular-nums-en whitespace-nowrap">
                          {formatIqd(order.total_price_iqd)}
                        </td>
                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <span className="inline-block px-2.5 py-1 rounded-lg bg-[#0E0A0C] border border-white/20 text-xs text-white">
                            {STATUS_LABELS[order.status] ?? order.status}
                          </span>
                        </td>
                        <td className="py-3.5 px-3">
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleOrderStatus(order.id, 'confirmed')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#0E0A0C] border border-white/20 text-xs text-white hover:bg-black disabled:opacity-50 cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>تأكيد</span>
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleOrderStatus(order.id, 'completed')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#5E1D2F] border border-white/25 text-xs text-white hover:bg-[#6E2438] disabled:opacity-50 cursor-pointer"
                            >
                              <PackageCheck className="w-3.5 h-3.5" />
                              <span>إكمال</span>
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleOrderStatus(order.id, 'cancelled')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#0E0A0C] border border-white/20 text-xs text-white/85 hover:bg-black disabled:opacity-50 cursor-pointer"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              <span>إلغاء</span>
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleAddStamp(order)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#0E0A0C] border border-white/40 text-xs font-semibold text-white hover:bg-black disabled:opacity-50 cursor-pointer"
                            >
                              <Award className="w-3.5 h-3.5" />
                              <span>إضافة ختم</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Simple Products Table */}
        <section className="rounded-2xl bg-[#461221] border border-white/15 p-5 sm:p-6 space-y-4">
          <h2 className="text-xl font-bold text-white">المنتجات ({products.length})</h2>
          {products.length === 0 ? (
            <p className="text-sm text-white/75 py-4">لا توجد منتجات في قاعدة البيانات.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm border-collapse min-w-[700px]">
                <thead>
                  <tr className="border-b border-white/15 text-xs text-white/75">
                    <th className="py-3 px-3 font-medium">المنتج</th>
                    <th className="py-3 px-3 font-medium">التصنيف</th>
                    <th className="py-3 px-3 font-medium">السعر (د.ع)</th>
                    <th className="py-3 px-3 font-medium">الكمية</th>
                    <th className="py-3 px-3 font-medium">التفعيل</th>
                    <th className="py-3 px-3 font-medium">حفظ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {products.map((product) => {
                    const draft = productDrafts[product.id] ?? {
                      price_iqd: String(product.price_iqd),
                      stock_quantity: String(product.stock_quantity),
                      is_active: product.is_active,
                    };
                    const isSaving = busyProductId === product.id;

                    return (
                      <tr key={product.id}>
                        <td className="py-3 px-3 font-medium text-white">{product.name_ar}</td>
                        <td className="py-3 px-3 text-xs text-white/75">
                          {CATEGORY_LABELS[product.category] ?? product.category}
                        </td>
                        <td className="py-3 px-3">
                          <input
                            type="number"
                            min={0}
                            step={250}
                            value={draft.price_iqd}
                            onChange={(e) =>
                              updateDraft(product.id, { price_iqd: e.target.value })
                            }
                            className="w-28 px-2.5 py-1.5 rounded-lg bg-[#0E0A0C] border border-white/20 text-white text-sm tabular-nums-en focus:outline-none focus:border-white"
                          />
                        </td>
                        <td className="py-3 px-3">
                          <input
                            type="number"
                            min={0}
                            value={draft.stock_quantity}
                            onChange={(e) =>
                              updateDraft(product.id, { stock_quantity: e.target.value })
                            }
                            className="w-24 px-2.5 py-1.5 rounded-lg bg-[#0E0A0C] border border-white/20 text-white text-sm tabular-nums-en focus:outline-none focus:border-white"
                          />
                        </td>
                        <td className="py-3 px-3">
                          <button
                            type="button"
                            onClick={() =>
                              updateDraft(product.id, { is_active: !draft.is_active })
                            }
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition cursor-pointer ${
                              draft.is_active
                                ? 'bg-[#5E1D2F] border-white/40 text-white'
                                : 'bg-[#0E0A0C] border-white/20 text-white/60'
                            }`}
                          >
                            {draft.is_active ? 'مفعّل' : 'متوقف'}
                          </button>
                        </td>
                        <td className="py-3 px-3">
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => handleSaveProduct(product.id)}
                            className="px-3.5 py-1.5 rounded-lg bg-[#0E0A0C] border border-white/25 text-xs font-semibold text-white hover:bg-black disabled:opacity-50 cursor-pointer"
                          >
                            {isSaving ? 'جاري الحفظ...' : 'حفظ'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
