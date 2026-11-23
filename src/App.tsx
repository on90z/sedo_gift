import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { AlertTriangle, Instagram, MapPin, MessageCircle, Phone, ShieldCheck, ShoppingBag } from 'lucide-react';
import { auth, testFirestoreConnection } from './lib/firebase.ts';
import { fetchPublicCatalogFromFirestore } from './lib/firestoreCatalogSync.ts';
import type {
  CustomBouquetSelection,
  CustomerRecord,
  Language,
  LoyaltyCardRecord,
  LoyaltyTransaction,
  OptionItem,
  OrderRecord,
  Product,
  StoreSettings,
} from './shared/types.ts';
import {
  calculateCustomBouquetPrice,
  formatIqd,
  getEffectiveProductPrice,
  toTelHref,
  toWhatsAppUrl,
} from './shared/pricing.ts';
import { evaluateProximityAlert } from './shared/geo.ts';
import { SEED_OPTIONS, SEED_PRODUCTS, SEED_SETTINGS } from './shared/seedCatalog.ts';
import { UI_COPY } from './i18n/translations.ts';
import { Header, type ActiveRoute } from './components/Header.tsx';
import { HomeSection } from './components/HomeSection.tsx';
import { CatalogSection } from './components/CatalogSection.tsx';
import { CustomBouquetBuilder } from './components/CustomBouquetBuilder.tsx';
import {
  CartDrawerAndCheckout,
  type LocalCartItem,
} from './components/CartDrawerAndCheckout.tsx';
import { LoyaltyAndHistoryView } from './components/LoyaltyAndHistoryView.tsx';
import { ContactAndAboutView } from './components/ContactAndAboutView.tsx';
import { AdminDashboard } from './components/admin/AdminDashboard.tsx';

function resolveInitialRoute(): ActiveRoute {
  if (typeof window === 'undefined') return 'home';
  const host = window.location.hostname.toLowerCase();
  const path = window.location.pathname.toLowerCase();
  if (host.startsWith('admin.') || path.startsWith('/admin')) return 'admin';
  const hash = window.location.hash.replace('#', '').toLowerCase();
  const valid: ActiveRoute[] = [
    'home',
    'bouquets',
    'builder',
    'gifts',
    'loyalty',
    'contact',
    'admin',
  ];
  return valid.includes(hash as ActiveRoute) ? (hash as ActiveRoute) : 'home';
}

function loadSavedCart(): LocalCartItem[] {
  try {
    const raw = localStorage.getItem('sedo_cart_v1');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [lang, setLang] = useState<Language>('ar');
  const [langTouchedByUser, setLangTouchedByUser] = useState(false);
  const [activeRoute, setActiveRoute] = useState<ActiveRoute>(resolveInitialRoute);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Authoritative catalog synced from backend
  const [products, setProducts] = useState<Product[]>(SEED_PRODUCTS);
  const [options, setOptions] = useState<OptionItem[]>(SEED_OPTIONS);
  const [settings, setSettings] = useState<StoreSettings>(SEED_SETTINGS);
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  );
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);

  // Cart & Toast state
  const [cartItems, setCartItems] = useState<LocalCartItem[]>(loadSavedCart);
  const [cartOpen, setCartOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Firebase Auth UID + Customer Verified Session (tokens in React memory only)
  const [firebaseUid, setFirebaseUid] = useState<string | null>(null);
  const [customerToken, setCustomerToken] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  const [loyaltyCard, setLoyaltyCard] = useState<LoyaltyCardRecord | null>(null);
  const [customerOrders, setCustomerOrders] = useState<OrderRecord[]>([]);
  const [loyaltyTransactions, setLoyaltyTransactions] = useState<LoyaltyTransaction[]>([]);

  const t = UI_COPY[lang];

  // Sync HTML lang/dir attributes
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  // Persist cart items locally
  useEffect(() => {
    try {
      localStorage.setItem('sedo_cart_v1', JSON.stringify(cartItems));
    } catch {
      // ignore storage errors
    }
  }, [cartItems]);

  // Google Maps quota listener
  useEffect(() => {
    const onQuota = () => setMapsQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, []);

  // Firebase connection probe & auth state
  useEffect(() => {
    void testFirestoreConnection();
    const unsub = onAuthStateChanged(auth, (u) => {
      setFirebaseUid(u?.uid ?? null);
    });
    return () => unsub();
  }, []);

  const refreshCatalog = useCallback(async () => {
    try {
      const [catResp, cfgResp, cloudData] = await Promise.all([
        fetch('/api/catalog'),
        fetch('/api/public-config'),
        fetchPublicCatalogFromFirestore(),
      ]);
      let nextProducts = products;
      let nextOptions = options;
      let nextSettings = settings;

      if (catResp.ok) {
        const data = await catResp.json();
        if (Array.isArray(data.products)) nextProducts = data.products;
        if (Array.isArray(data.options)) nextOptions = data.options;
        if (data.settings) nextSettings = { ...SEED_SETTINGS, ...data.settings };
      }

      // If Firestore has a strictly newer updatedAt timestamp, prefer live cloud data
      const serverTs = Date.parse(nextSettings.updatedAt || '') || 0;
      const cloudTs = Date.parse(String(cloudData.settings?.updatedAt || '')) || 0;
      if (cloudData.settings && cloudTs > serverTs) {
        nextSettings = {
          ...nextSettings,
          ...cloudData.settings,
          loyaltyReward: {
            ...nextSettings.loyaltyReward,
            ...(cloudData.settings.loyaltyReward || {}),
          },
        };
        if (cloudData.products && cloudData.products.length > 0) {
          nextProducts = cloudData.products;
        }
        if (cloudData.options && cloudData.options.length > 0) {
          nextOptions = cloudData.options;
        }
      }

      setProducts(nextProducts);
      setOptions(nextOptions);
      setSettings(nextSettings);
      if (!langTouchedByUser && (nextSettings.defaultLanguage === 'ar' || nextSettings.defaultLanguage === 'en')) {
        setLang(nextSettings.defaultLanguage);
      }

      if (cfgResp.ok) {
        const cfg = await cfgResp.json();
        if (cfg.googleMapsApiKey) setMapsApiKey(cfg.googleMapsApiKey);
      }
    } catch {
      // Fallback gracefully to seed catalog if network temporarily blips
    }
  }, [langTouchedByUser]);

  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  // Optional active browser-session proximity check (strictly opt-in, no background tracking)
  useEffect(() => {
    if (!customer?.locationConsent || !settings.proximityEnabled) return;
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (typeof settings.latitude !== 'number' || typeof settings.longitude !== 'number') return;

    const lastRaw = localStorage.getItem('sedo_prox_last_ts');
    const lastMs = lastRaw ? Number(lastRaw) : null;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const res = evaluateProximityAlert({
          userCoords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          storeCoords: { lat: settings.latitude!, lng: settings.longitude! },
          radiusMeters: settings.proximityRadiusMeters,
          proximityEnabled: settings.proximityEnabled,
          locationConsent: true,
          notificationConsent: true,
          lastTriggeredAtMs: Number.isFinite(lastMs) ? lastMs : null,
          cooldownHours: settings.proximityCooldownHours,
        });
        if (res.shouldTrigger) {
          localStorage.setItem('sedo_prox_last_ts', String(Date.now()));
          new Notification(lang === 'ar' ? settings.storeNameAr : settings.storeNameEn, {
            body: lang === 'ar' ? settings.proximityMessageAr : settings.proximityMessageEn,
          });
        }
      },
      () => {
        // Silently ignore denied/unavailable position
      },
      { timeout: 6000, maximumAge: 60_000 }
    );
  }, [
    customer?.locationConsent,
    settings.proximityEnabled,
    settings.latitude,
    settings.longitude,
    settings.proximityRadiusMeters,
    settings.proximityCooldownHours,
    settings.storeNameAr,
    settings.storeNameEn,
    settings.proximityMessageAr,
    settings.proximityMessageEn,
    lang,
  ]);

  const handleNavigate = (route: ActiveRoute) => {
    setActiveRoute(route);
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (route === 'admin') {
      window.history.replaceState(null, '', '/admin');
    } else {
      const target = route === 'home' ? '/' : `/#${route}`;
      window.history.replaceState(null, '', target);
    }
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3200);
  };

  const handleAddReadyMade = (product: Product) => {
    const unitPrice = getEffectiveProductPrice(product);
    setCartItems((prev) => {
      const existing = prev.find(
        (i) => i.input.type === 'ready_made' && i.input.productId === product.id
      );
      if (existing) {
        return prev.map((i) =>
          i.id === existing.id
            ? { ...i, input: { ...i.input, quantity: i.input.quantity + 1 } }
            : i
        );
      }
      return [
        ...prev,
        {
          id: `cart_${product.id}_${Date.now()}`,
          input: { type: 'ready_made', productId: product.id, quantity: 1 },
          titleAr: product.nameAr,
          titleEn: product.nameEn,
          unitPriceIqd: unitPrice,
          imageUrl: product.imageUrl,
          summaryAr: product.categoryAr,
          summaryEn: product.category,
        },
      ];
    });
    showToast(
      lang === 'ar'
        ? `تمت إضافة "${product.nameAr}" إلى السلة`
        : `Added "${product.nameEn}" to bag`
    );
  };

  const handleAddCustomBouquet = (selection: CustomBouquetSelection) => {
    const breakdown = calculateCustomBouquetPrice(
      selection,
      options,
      settings.roseUnitPriceIqd,
      settings.maxCustomRoses
    );
    const ft = options.find((o) => o.id === selection.flowerTypeId);
    const wrap = options.find((o) => o.id === selection.wrappingId);
    const arr = options.find((o) => o.id === selection.arrangementId);
    const colors = options.filter((o) => selection.colorIds.includes(o.id));
    const gifts = options.filter((o) => selection.giftIds.includes(o.id));

    const summaryAr = [
      ft?.nameAr,
      colors.map((c) => c.nameAr).join('، '),
      wrap?.nameAr,
      arr?.nameAr,
      gifts.length ? `+ ${gifts.map((g) => g.nameAr).join('، ')}` : '',
    ]
      .filter(Boolean)
      .join(' · ');

    const summaryEn = [
      ft?.nameEn,
      colors.map((c) => c.nameEn).join(', '),
      wrap?.nameEn,
      arr?.nameEn,
      gifts.length ? `+ ${gifts.map((g) => g.nameEn).join(', ')}` : '',
    ]
      .filter(Boolean)
      .join(' · ');

    setCartItems((prev) => [
      ...prev,
      {
        id: `cart_custom_${Date.now()}`,
        input: { type: 'custom_bouquet', quantity: 1, customSelection: selection },
        titleAr: `باقة SEDO المخصصة (${selection.roseQuantity} وردة)`,
        titleEn: `Custom SEDO Bouquet (${selection.roseQuantity} Roses)`,
        unitPriceIqd: breakdown.totalIqd,
        imageUrl: wrap?.imageUrl || ft?.imageUrl || settings.heroBannerUrl,
        summaryAr,
        summaryEn,
      },
    ]);
    showToast(
      lang === 'ar'
        ? `تمت إضافة باقتك المخصصة (${formatIqd(breakdown.totalIqd, 'ar')})`
        : `Custom bouquet added (${formatIqd(breakdown.totalIqd, 'en')})`
    );
  };

  const handleUpdateCartQty = (id: string, delta: number) => {
    setCartItems((prev) =>
      prev
        .map((item) =>
          item.id === id
            ? { ...item, input: { ...item.input, quantity: item.input.quantity + delta } }
            : item
        )
        .filter((item) => item.input.quantity > 0)
    );
  };

  const handleRemoveCartItem = (id: string) => {
    setCartItems((prev) => prev.filter((item) => item.id !== id));
  };

  const totalCartCount = cartItems.reduce((sum, item) => sum + item.input.quantity, 0);

  return (
    <div className="min-h-screen flex flex-col bg-[#5E1D2F] text-white">
      {mapsQuotaExceeded && (
        <div
          role="alert"
          className="bg-[#0E0A0C] border-b border-[#944A5E] text-white text-xs px-4 py-2.5 flex items-center justify-center gap-2 text-center"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            {lang === 'ar'
              ? 'تم تجاوز الحصة التجريبية لخرائط Google مؤقتاً؛ يمكنك فتح الاتجاهات عبر رابط خرائط Google أدناه.'
              : 'Google Maps demo quota temporarily exceeded; interactive preview is paused, while direct Google Maps directions remain available.'}
          </span>
        </div>
      )}

      <Header
        activeRoute={activeRoute}
        onNavigate={handleNavigate}
        lang={lang}
        onToggleLang={() => {
          setLangTouchedByUser(true);
          setLang((l) => (l === 'ar' ? 'en' : 'ar'));
        }}
        cartCount={totalCartCount}
        onOpenCart={() => setCartOpen(true)}
        settings={settings}
      />

      {toastMsg && (
        <div className="fixed bottom-5 end-5 z-50 bg-[#0E0A0C] text-white px-5 py-3.5 border border-[#944A5E] flex items-center gap-4 text-xs sm:text-sm shadow-lg">
          <span>{toastMsg}</span>
          <button
            type="button"
            onClick={() => {
              setToastMsg(null);
              setCartOpen(true);
            }}
            className="inline-flex items-center gap-1.5 text-white/85 hover:text-white font-semibold underline"
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>{t.cart}</span>
          </button>
        </div>
      )}

      <main className="flex-1">
        {activeRoute === 'home' && (
          <HomeSection
            lang={lang}
            settings={settings}
            products={products}
            onNavigate={handleNavigate}
            onAddReadyMade={handleAddReadyMade}
            onSelectCategory={(cat) => setSelectedCategory(cat)}
          />
        )}

        {activeRoute === 'bouquets' && (
          <CatalogSection
            lang={lang}
            products={products}
            settings={settings}
            mode="bouquet"
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
            onAddToCart={handleAddReadyMade}
            onOpenBuilder={() => handleNavigate('builder')}
          />
        )}

        {activeRoute === 'gifts' && (
          <CatalogSection
            lang={lang}
            products={products}
            settings={settings}
            mode="gift"
            selectedCategory={selectedCategory === 'red_roses' || selectedCategory === 'luxury_bouquets' ? 'all' : selectedCategory}
            onSelectCategory={setSelectedCategory}
            onAddToCart={handleAddReadyMade}
            onOpenBuilder={() => handleNavigate('builder')}
          />
        )}

        {activeRoute === 'builder' && (
          <CustomBouquetBuilder
            lang={lang}
            options={options}
            settings={settings}
            onAddCustomBouquet={handleAddCustomBouquet}
          />
        )}

        {activeRoute === 'loyalty' && (
          <LoyaltyAndHistoryView
            lang={lang}
            settings={settings}
            customerToken={customerToken}
            customer={customer}
            loyaltyCard={loyaltyCard}
            orders={customerOrders}
            transactions={loyaltyTransactions}
            onAuthenticated={(payload) => {
              setCustomerToken(payload.customerToken);
              setCustomer(payload.customer);
              setLoyaltyCard(payload.loyaltyCard);
              setCustomerOrders(payload.orders);
              setLoyaltyTransactions(payload.transactions);
            }}
            onConsentUpdated={(updated) => setCustomer(updated)}
          />
        )}

        {activeRoute === 'contact' && (
          <ContactAndAboutView
            lang={lang}
            settings={settings}
            mapsApiKey={mapsApiKey}
          />
        )}

        {activeRoute === 'admin' && (
          <AdminDashboard
            lang={lang}
            onCatalogUpdated={refreshCatalog}
            onBackToStore={() => handleNavigate('home')}
          />
        )}
      </main>

      <CartDrawerAndCheckout
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        lang={lang}
        items={cartItems}
        products={products}
        options={options}
        settings={settings}
        userUid={firebaseUid}
        onUpdateQty={handleUpdateCartQty}
        onRemoveItem={handleRemoveCartItem}
        onClearCart={() => setCartItems([])}
        onOrderConfirmed={({ order, loyaltyCard: card, customerToken: tok }) => {
          if (tok) setCustomerToken(tok);
          if (card) setLoyaltyCard(card);
          setCustomerOrders((prev) => [order, ...prev]);
          setCustomer((prev) =>
            prev
              ? {
                  ...prev,
                  totalOrders: prev.totalOrders + 1,
                  totalSpentIqd: prev.totalSpentIqd + order.totalIqd,
                }
              : {
                  id: order.customerId,
                  userId: order.userId,
                  fullName: order.customerName,
                  phone: order.customerPhone,
                  birthDate: order.customerBirthDate,
                  marketingConsent: true,
                  locationConsent: false,
                  totalOrders: 1,
                  totalSpentIqd: order.totalIqd,
                  createdAt: order.createdAt,
                  updatedAt: order.updatedAt,
                }
          );
          void refreshCatalog();
        }}
        onOpenLoyalty={() => handleNavigate('loyalty')}
      />

      {/* Refined Architectural Footer */}
      <footer className="border-t border-[#944A5E] bg-[#0E0A0C] text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 grid grid-cols-1 md:grid-cols-4 gap-8 text-sm">
          <div className="space-y-2 md:col-span-2">
            <div className="font-display text-2xl font-bold text-white tracking-wider">
              SEDO
            </div>
            <p className="text-xs text-white/80 max-w-md leading-relaxed">
              {(lang === 'ar' ? settings.footerTextAr : settings.footerTextEn) || t.aboutText}
            </p>
            <div className="pt-2 flex flex-wrap items-center gap-4 text-xs text-white/80">
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-white/90" />
                <span>{lang === 'ar' ? settings.addressAr : settings.addressEn}</span>
              </span>
            </div>
          </div>

          <div className="space-y-2 text-xs">
            <div className="font-bold text-white">
              {lang === 'ar' ? 'روابط سريعة' : 'Quick Links'}
            </div>
            <ul className="space-y-1.5 text-white/75">
              <li>
                <button type="button" onClick={() => handleNavigate('bouquets')} className="hover:text-white transition-colors">
                  {t.navBouquets}
                </button>
              </li>
              <li>
                <button type="button" onClick={() => handleNavigate('builder')} className="hover:text-white transition-colors">
                  {t.navBuilder}
                </button>
              </li>
              <li>
                <button type="button" onClick={() => handleNavigate('gifts')} className="hover:text-white transition-colors">
                  {t.navGifts}
                </button>
              </li>
              <li>
                <button type="button" onClick={() => handleNavigate('loyalty')} className="hover:text-white transition-colors">
                  {t.navLoyalty}
                </button>
              </li>
            </ul>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="font-semibold text-white">
              {lang === 'ar' ? 'التواصل والإدارة' : 'Connect & Store'}
            </div>
            <div className="text-white/75">
              {lang === 'ar' ? settings.workingHoursAr : settings.workingHoursEn}
            </div>
            {[settings.phone, settings.secondaryPhone]
              .filter((num): num is string => Boolean(num && num.trim()))
              .map((num, idx) => (
                <div key={`${num}-${idx}`} className="flex flex-wrap items-center gap-2.5">
                  <a
                    href={toTelHref(num)}
                    className="inline-flex items-center gap-1.5 text-white/90 hover:text-white tabular-nums-en font-medium"
                    dir="ltr"
                  >
                    <Phone className="w-3.5 h-3.5 text-white/80" />
                    <span>{num}</span>
                  </a>
                  <a
                    href={toWhatsAppUrl(num)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-0.5 border border-[#944A5E] bg-[#5E1D2F] text-white hover:bg-[#6E2438] font-medium transition-colors"
                    aria-label={`${lang === 'ar' ? 'واتساب' : 'WhatsApp'} ${num}`}
                  >
                    <MessageCircle className="w-3 h-3 text-white" />
                    <span>{lang === 'ar' ? 'واتساب' : 'WhatsApp'}</span>
                  </a>
                </div>
              ))}
            <div className="pt-1 flex flex-col items-start gap-1.5">
              <a
                href={settings.instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-white font-medium hover:underline"
              >
                <Instagram className="w-3.5 h-3.5" />
                <span dir="ltr">{settings.instagramHandle}</span>
              </a>
              <button
                type="button"
                onClick={() => handleNavigate('admin')}
                className="inline-flex items-center gap-1.5 text-white/80 hover:text-white font-medium hover:underline"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>{t.footerAdmin}</span>
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-[#944A5E]/60 py-4 px-4 text-center text-xs text-white/70 tabular-nums-en">
          © {new Date().getFullYear()} SEDO Flowers & Gifts · Karbala, Iraq
        </div>
      </footer>
    </div>
  );
}
