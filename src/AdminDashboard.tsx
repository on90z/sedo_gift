import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  AlertTriangle,
  Award,
  BarChart3,
  Calendar,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock,
  Edit3,
  Eye,
  FileText,
  Flower2,
  FolderKanban,
  Gift,
  Instagram,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  MessageCircle,
  Package,
  PackageCheck,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Star,
  Store,
  Trash2,
  Truck,
  Upload,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { supabase } from '../supabaseclient.tsx';
import {
  computeCustomerSummaries,
  computeDailyOrderStats,
  extractOrderMeta,
  formatIqd,
  formatOrderDetailsText,
  formatWhatsAppUrl,
  getBaghdadDateKey,
  getBaghdadTimeFormatted,
  getLoyaltyProgress,
  hasOrderStamp,
  isQualifyingCompletedStatus,
  normalizePhone,
  parseStorePhoneList,
  resolveInstagramUrl,
  validateProductImageFile,
  type BouquetOrderDetails,
  type CustomerSummary,
} from './pricing.ts';
import type {
  AdminTab,
  AuditLogRow,
  CategoryRow,
  CustomerRow,
  LoyaltyLogRow,
  OrderRow,
  OrderStatus,
  OrderStatusHistoryRow,
  ProductRow,
  StoreSettingsRow,
} from './types.ts';

const STATUS_OPTIONS: { value: OrderStatus; label: string }[] = [
  { value: 'pending', label: 'قيد الانتظار' },
  { value: 'confirmed', label: 'مؤكد' },
  { value: 'preparing', label: 'قيد التجهيز' },
  { value: 'out_for_delivery', label: 'قيد التوصيل' },
  { value: 'delivered', label: 'تم التوصيل' },
  { value: 'cancelled', label: 'ملغي' },
];

export const ADMIN_STATUS_LABELS: Record<string, string> = {
  pending: 'قيد الانتظار',
  confirmed: 'مؤكد',
  preparing: 'قيد التجهيز',
  out_for_delivery: 'قيد التوصيل',
  delivered: 'تم التوصيل',
  completed: 'مكتمل (تم التوصيل)',
  cancelled: 'ملغي',
};

const NAV_ITEMS: { id: AdminTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'الرئيسية', icon: LayoutDashboard },
  { id: 'orders', label: 'الطلبات', icon: ClipboardList },
  { id: 'today_orders', label: 'طلبات اليوم', icon: Clock },
  { id: 'products', label: 'المنتجات', icon: Package },
  { id: 'add_product', label: 'إضافة منتج', icon: Plus },
  { id: 'categories', label: 'التصنيفات', icon: FolderKanban },
  { id: 'customers', label: 'الزبائن', icon: Users },
  { id: 'loyalty', label: 'بطاقة الولاء', icon: Award },
  { id: 'reports', label: 'التقارير', icon: BarChart3 },
  { id: 'settings', label: 'إعدادات المتجر', icon: Settings },
  { id: 'contact', label: 'معلومات التواصل', icon: Phone },
];

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

function formatBaghdadDateTime(iso: string | null | undefined): string {
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

function isMissingSchemaError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return (
    err.code === '42703' ||
    err.code === '42P01' ||
    err.code === 'PGRST204' ||
    err.code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find')
  );
}

export function AdminDashboard({
  onBackHome,
  getFallbackImage,
}: {
  onBackHome: () => void;
  getFallbackImage: (p: Pick<ProductRow, 'name_ar' | 'category'>) => string;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  // Auth form
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Navigation & UI
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [migrationNeeded, setMigrationNeeded] = useState(false);

  // Core Supabase state
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loyaltyLogs, setLoyaltyLogs] = useState<LoyaltyLogRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [orderHistory, setOrderHistory] = useState<OrderStatusHistoryRow[]>([]);
  const [settings, setSettings] = useState<StoreSettingsRow>({
    id: 1,
    shop_name: 'SEDO للهدايا والزهور',
    address: 'كربلاء - حي الميلاد - شارع الدرة - مجاور كوفي الدرة',
    working_hours: 'يومياً من الساعة 9:00 صباحاً إلى 1:00 بعد منتصف الليل',
    phone_numbers: '07762963674, 07733484176',
    whatsapp_numbers: '07762963674, 07733484176',
    instagram_url: 'https://www.instagram.com/sedo.gift/',
    google_maps_url: 'https://maps.google.com/?q=32.6027,44.0197',
    loyalty_required_purchases: 9,
    loyalty_reward_type: 'gift',
    loyalty_reward_value: 'باقة أو هدية مجانية على الطلب العاشر',
    cash_only: true,
  });

  // Orders & Today's Orders Filters
  const todayBaghdad = useMemo(() => getBaghdadDateKey(new Date()), []);
  const [selectedOrderModal, setSelectedOrderModal] = useState<OrderRow | null>(null);
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('all');
  const [orderDateFilter, setOrderDateFilter] = useState<string>('');
  const [todayDateFilter, setTodayDateFilter] = useState<string>(todayBaghdad);
  const [todayStatusFilter, setTodayStatusFilter] = useState<string>('all');
  const [orderSearchQuery, setOrderSearchQuery] = useState<string>('');
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);

  // Product Management State
  const [productCategoryFilter, setProductCategoryFilter] = useState<string>('all');
  const [productSearch, setProductSearch] = useState<string>('');
  const [editingProduct, setEditingProduct] = useState<ProductRow | null>(null);
  const [editProdForm, setEditProdForm] = useState({
    name_ar: '',
    description_ar: '',
    category: 'flower',
    price_iqd: '0',
    stock_quantity: '0',
    low_stock_threshold: '10',
    sort_order: '0',
    is_active: true,
    is_featured: false,
    image_url: '' as string | null,
  });
  const [editProdPendingFile, setEditProdPendingFile] = useState<File | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<ProductRow | null>(null);
  const [savingProduct, setSavingProduct] = useState(false);

  // Add Product Form State
  const [newProdForm, setNewProdForm] = useState({
    name_ar: '',
    description_ar: '',
    category: 'flower',
    price_iqd: '3000',
    stock_quantity: '50',
    low_stock_threshold: '10',
    sort_order: '0',
    is_active: true,
    is_featured: false,
  });
  const [newProdFile, setNewProdFile] = useState<File | null>(null);
  const [newProdPreview, setNewProdPreview] = useState<string | null>(null);
  const [creatingProduct, setCreatingProduct] = useState(false);

  // Categories State
  const [newCatForm, setNewCatForm] = useState({
    slug: '',
    name_ar: '',
    description_ar: '',
    sort_order: '4',
  });
  const [busyCategory, setBusyCategory] = useState(false);

  // Customers & Loyalty State
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomerSummary, setSelectedCustomerSummary] =
    useState<CustomerSummary | null>(null);
  const [loyaltySearch, setLoyaltySearch] = useState('');
  const [adjustModalCustomer, setAdjustModalCustomer] = useState<CustomerSummary | null>(null);
  const [adjustDelta, setAdjustDelta] = useState<'1' | '-1'>('1');
  const [adjustReason, setAdjustReason] = useState('');
  const [busyLoyaltyId, setBusyLoyaltyId] = useState<string | null>(null);

  // Store & Contact Settings Drafts
  const [settingsDraft, setSettingsDraft] = useState<StoreSettingsRow>(settings);
  const [savingSettings, setSavingSettings] = useState(false);

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

  const writeAuditLog = useCallback(
    async (
      action: string,
      entityType: string,
      entityId: string | null,
      details: Record<string, unknown>
    ) => {
      const actor = session?.user?.email || 'admin';
      const { error } = await supabase.from('audit_logs').insert({
        actor_email: actor,
        action,
        entity_type: entityType,
        entity_id: entityId,
        details,
      });
      if (!error) {
        setAuditLogs((prev) => [
          {
            id: crypto.randomUUID(),
            actor_email: actor,
            action,
            entity_type: entityType,
            entity_id: entityId,
            details,
            created_at: new Date().toISOString(),
          },
          ...prev,
        ]);
      }
    },
    [session]
  );

  const loadAllAdminData = useCallback(async () => {
    setLoadingData(true);
    setActionError(null);

    const [
      productsRes,
      ordersRes,
      customersRes,
      loyaltyRes,
      settingsRes,
      catsRes,
      auditRes,
      histRes,
    ] = await Promise.all([
      supabase.from('products').select('*').order('created_at', { ascending: true }),
      supabase.from('orders').select('*').order('created_at', { ascending: false }),
      supabase.from('customers').select('*').order('created_at', { ascending: false }),
      supabase.from('loyalty_logs').select('*').order('created_at', { ascending: false }),
      supabase.from('store_settings').select('*').limit(1).maybeSingle(),
      supabase.from('categories').select('*').order('sort_order', { ascending: true }),
      supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('order_status_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    let needsMigration = false;

    if (productsRes.error) {
      setActionError(`تعذّر جلب المنتجات: ${productsRes.error.message}`);
    } else {
      const list = ((productsRes.data ?? []) as ProductRow[]).sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
      );
      setProducts(list);
      if (list.length > 0 && !('is_featured' in list[0])) {
        needsMigration = true;
      }
    }

    if (ordersRes.error) {
      setActionError((prev) => prev || `تعذّر جلب الطلبات: ${ordersRes.error.message}`);
    } else {
      setOrders((ordersRes.data ?? []) as OrderRow[]);
    }

    if (!customersRes.error) {
      setCustomers((customersRes.data ?? []) as CustomerRow[]);
    }

    if (!loyaltyRes.error) {
      setLoyaltyLogs((loyaltyRes.data ?? []) as LoyaltyLogRow[]);
    }

    if (settingsRes.data) {
      const s = settingsRes.data as StoreSettingsRow;
      const merged: StoreSettingsRow = {
        ...s,
        phone_numbers: parseStorePhoneList(s.phone_numbers).join(', '),
        whatsapp_numbers: parseStorePhoneList(s.whatsapp_numbers || s.phone_numbers).join(', '),
        instagram_url: resolveInstagramUrl(s.instagram_url),
        loyalty_required_purchases: s.loyalty_required_purchases ?? 9,
        loyalty_reward_type: s.loyalty_reward_type ?? 'gift',
        loyalty_reward_value:
          s.loyalty_reward_value ?? 'باقة أو هدية مجانية على الطلب العاشر',
        cash_only: true,
      };
      setSettings(merged);
      setSettingsDraft(merged);
    }

    if (catsRes.error && isMissingSchemaError(catsRes.error)) {
      needsMigration = true;
      setCategories([
        { id: 'flower', slug: 'flower', name_ar: 'الزهور والورد الطبيعي', sort_order: 1, is_active: true },
        { id: 'wrapping', slug: 'wrapping', name_ar: 'التغليف الفاخر', sort_order: 2, is_active: true },
        { id: 'gift', slug: 'gift', name_ar: 'الهدايا الإضافية', sort_order: 3, is_active: true },
      ]);
    } else if (catsRes.data) {
      setCategories(catsRes.data as CategoryRow[]);
    }

    if (auditRes.error && isMissingSchemaError(auditRes.error)) {
      needsMigration = true;
    } else if (auditRes.data) {
      setAuditLogs(auditRes.data as AuditLogRow[]);
    }

    if (!histRes.error && histRes.data) {
      setOrderHistory(histRes.data as OrderStatusHistoryRow[]);
    }

    setMigrationNeeded(needsMigration);
    setLoadingData(false);
  }, []);

  useEffect(() => {
    if (session) {
      loadAllAdminData();
    }
  }, [session, loadAllAdminData]);

  const requiredPurchases = settings.loyalty_required_purchases ?? 9;

  const customerSummaries = useMemo(
    () => computeCustomerSummaries(customers, orders, loyaltyLogs, requiredPurchases),
    [customers, orders, loyaltyLogs, requiredPurchases]
  );

  const todayStats = useMemo(
    () => computeDailyOrderStats(orders, todayBaghdad),
    [orders, todayBaghdad]
  );

  const selectedDayStats = useMemo(
    () => computeDailyOrderStats(orders, todayDateFilter || todayBaghdad),
    [orders, todayDateFilter, todayBaghdad]
  );

  const filteredAllOrders = useMemo(() => {
    const q = orderSearchQuery.trim().toLowerCase();
    const normQ = normalizePhone(q);
    return orders.filter((o) => {
      if (orderStatusFilter !== 'all') {
        if (orderStatusFilter === 'delivered') {
          if (!isQualifyingCompletedStatus(o.status)) return false;
        } else if (o.status !== orderStatusFilter) {
          return false;
        }
      }
      if (orderDateFilter && getBaghdadDateKey(o.created_at) !== orderDateFilter) {
        return false;
      }
      if (q) {
        const matchId = o.id.toLowerCase().includes(q) || (o.order_number || '').toLowerCase().includes(q);
        const matchName = o.customer_name.toLowerCase().includes(q);
        const matchPhone = normQ.length >= 3 && normalizePhone(o.customer_phone).includes(normQ);
        if (!matchId && !matchName && !matchPhone) return false;
      }
      return true;
    });
  }, [orders, orderStatusFilter, orderDateFilter, orderSearchQuery]);

  const filteredTodayOrders = useMemo(() => {
    const q = orderSearchQuery.trim().toLowerCase();
    const normQ = normalizePhone(q);
    const targetDay = todayDateFilter || todayBaghdad;
    return orders.filter((o) => {
      if (getBaghdadDateKey(o.created_at) !== targetDay) return false;
      if (todayStatusFilter !== 'all') {
        if (todayStatusFilter === 'delivered') {
          if (!isQualifyingCompletedStatus(o.status)) return false;
        } else if (o.status !== todayStatusFilter) {
          return false;
        }
      }
      if (q) {
        const matchId = o.id.toLowerCase().includes(q);
        const matchName = o.customer_name.toLowerCase().includes(q);
        const matchPhone = normQ.length >= 3 && normalizePhone(o.customer_phone).includes(normQ);
        if (!matchId && !matchName && !matchPhone) return false;
      }
      return true;
    });
  }, [orders, todayDateFilter, todayBaghdad, todayStatusFilter, orderSearchQuery]);

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return products.filter((p) => {
      if (productCategoryFilter !== 'all' && p.category !== productCategoryFilter) return false;
      if (q && !p.name_ar.toLowerCase().includes(q) && !(p.description_ar || '').toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [products, productCategoryFilter, productSearch]);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customerSummaries;
    const normQ = normalizePhone(q);
    return customerSummaries.filter((cs) => {
      const matchName = cs.customer.full_name.toLowerCase().includes(q);
      const matchPhone = normQ.length >= 3 && normalizePhone(cs.customer.phone).includes(normQ);
      const matchOrder = cs.orders.some((o) => o.id.toLowerCase().includes(q));
      return matchName || matchPhone || matchOrder;
    });
  }, [customerSummaries, customerSearch]);

  const filteredLoyaltyCustomers = useMemo(() => {
    const q = loyaltySearch.trim().toLowerCase();
    if (!q) return customerSummaries;
    const normQ = normalizePhone(q);
    return customerSummaries.filter(
      (cs) =>
        cs.customer.full_name.toLowerCase().includes(q) ||
        (normQ.length >= 3 && normalizePhone(cs.customer.phone).includes(normQ))
    );
  }, [customerSummaries, loyaltySearch]);

  // Helper: Upload image safely to Supabase Storage (preserves existing image if upload fails)
  const uploadProductImageToStorage = async (file: File): Promise<string> => {
    const check = validateProductImageFile(file);
    if (!check.valid) {
      throw new Error(check.error);
    }
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const filePath = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from('product-images')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type,
      });

    if (uploadError) {
      throw new Error(
        `فشل رفع الصورة إلى Supabase Storage (${uploadError.message}). تأكد من تشغيل supabase_migration.sql لإنشاء حاوية product-images.`
      );
    }

    const { data } = supabase.storage.from('product-images').getPublicUrl(filePath);
    return data.publicUrl;
  };

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
    setCustomers([]);
  };

  // Award stamp ONLY for qualifying completed/delivered orders & prevent duplicates
  const awardQualifyingStampForOrder = async (
    order: OrderRow,
    silentIfAlreadyStamped = false
  ): Promise<string | null> => {
    if (!isQualifyingCompletedStatus(order.status)) {
      setActionError('لا يمكن منح ختم إلا للطلبات المكتملة / التي تم توصيلها.');
      return null;
    }

    if (hasOrderStamp(order.id, loyaltyLogs)) {
      if (!silentIfAlreadyStamped) {
        setActionError('تم تسجيل ختم لهذا الطلب مسبقاً — يُمنع التكرار.');
      }
      return null;
    }

    const { data: existingOrderLog } = await supabase
      .from('loyalty_logs')
      .select('id')
      .eq('order_id', order.id)
      .in('action', ['add_stamp', 'qualifying_purchase_stamp'])
      .limit(1)
      .maybeSingle();

    if (existingOrderLog) {
      if (!silentIfAlreadyStamped) {
        setActionError('تم تسجيل ختم لهذا الطلب مسبقاً في قاعدة البيانات.');
      }
      return null;
    }

    const normPhone = normalizePhone(order.customer_phone);
    let customer =
      customers.find(
        (c) => c.id === order.customer_id || normalizePhone(c.phone) === normPhone
      ) ?? null;

    if (!customer) {
      const { data: created, error: createErr } = await supabase
        .from('customers')
        .insert({
          full_name: order.customer_name,
          phone: normPhone || order.customer_phone,
          birth_date: order.customer_birth_date ?? null,
          stamps_count: 0,
          total_orders: 1,
        })
        .select('*')
        .single();
      if (createErr || !created) {
        setActionError(`تعذّر إنشاء سجل الزبون: ${createErr?.message}`);
        return null;
      }
      customer = created as CustomerRow;
    }

    const currentStamps = customer.stamps_count ?? 0;
    const nextStamps = currentStamps + 1;

    const { error: logErr } = await supabase.from('loyalty_logs').insert({
      customer_id: customer.id,
      order_id: order.id,
      action: 'qualifying_purchase_stamp',
      notes: `ختم شراء مكتمل للطلب #${order.id.slice(0, 8)} (${currentStamps} -> ${nextStamps})`,
    });

    if (logErr) {
      if (logErr.code === '23505') {
        if (!silentIfAlreadyStamped) setActionError('تم منع تكرار الختم لنفس الطلب.');
      } else {
        setActionError(`فشل تسجيل سجل الولاء: ${logErr.message}`);
      }
      return null;
    }

    const { error: updErr } = await supabase
      .from('customers')
      .update({ stamps_count: nextStamps })
      .eq('id', customer.id);

    if (updErr) {
      setActionError(`فشل تحديث عداد الأختام: ${updErr.message}`);
      return null;
    }

    await writeAuditLog('qualifying_purchase_stamp', 'customer', customer.id, {
      order_id: order.id,
      previous_stamps: currentStamps,
      new_stamps: nextStamps,
    });

    return `تم منح ختم للزبون ${customer.full_name} (الرصيد الآن: ${nextStamps} / ${requiredPurchases}).`;
  };

  const handleUpdateOrderStatus = async (order: OrderRow, newStatus: OrderStatus) => {
    if (order.status === newStatus) return;
    setBusyOrderId(order.id);
    setActionError(null);
    setActionMessage(null);

    const { error } = await supabase
      .from('orders')
      .update({ status: newStatus })
      .eq('id', order.id);

    if (error) {
      setActionError(`فشل تحديث حالة الطلب: ${error.message}`);
      setBusyOrderId(null);
      return;
    }

    await supabase.from('order_status_history').insert({
      order_id: order.id,
      old_status: order.status,
      new_status: newStatus,
      changed_by: session?.user?.email || 'admin',
      note: `تغيير الحالة إلى ${ADMIN_STATUS_LABELS[newStatus] ?? newStatus}`,
    });

    await writeAuditLog('update_order_status', 'order', order.id, {
      old_status: order.status,
      new_status: newStatus,
    });

    const updatedOrder = { ...order, status: newStatus };
    setOrders((prev) => prev.map((o) => (o.id === order.id ? updatedOrder : o)));
    if (selectedOrderModal?.id === order.id) {
      setSelectedOrderModal(updatedOrder);
    }

    let msg = `تم تحديث حالة الطلب #${order.id.slice(0, 8)} إلى: ${ADMIN_STATUS_LABELS[newStatus]}`;
    if (isQualifyingCompletedStatus(newStatus)) {
      const stampMsg = await awardQualifyingStampForOrder(updatedOrder, true);
      if (stampMsg) msg = `${msg} — ${stampMsg}`;
    }

    setActionMessage(msg);
    await loadAllAdminData();
    setBusyOrderId(null);
  };

  // Product Edit / Add / Delete
  const openEditProduct = (product: ProductRow) => {
    setEditingProduct(product);
    setEditProdPendingFile(null);
    setEditProdForm({
      name_ar: product.name_ar,
      description_ar: product.description_ar ?? '',
      category: product.category,
      price_iqd: String(product.price_iqd),
      stock_quantity: String(product.stock_quantity),
      low_stock_threshold: String(product.low_stock_threshold ?? 10),
      sort_order: String(product.sort_order ?? 0),
      is_active: product.is_active,
      is_featured: Boolean(product.is_featured),
      image_url: product.image_url,
    });
  };

  const handleSaveEditedProduct = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    setSavingProduct(true);
    setActionError(null);
    setActionMessage(null);

    try {
      let nextImageUrl = editProdForm.image_url;
      if (editProdPendingFile) {
        // Upload new image FIRST — preserves original image_url if upload throws
        nextImageUrl = await uploadProductImageToStorage(editProdPendingFile);
      }

      const fullPayload = {
        name_ar: editProdForm.name_ar.trim(),
        description_ar: editProdForm.description_ar.trim(),
        category: editProdForm.category,
        price_iqd: Math.max(0, Math.round(Number(editProdForm.price_iqd) || 0)),
        stock_quantity: Math.max(0, Math.round(Number(editProdForm.stock_quantity) || 0)),
        low_stock_threshold: Math.max(
          0,
          Math.round(Number(editProdForm.low_stock_threshold) || 0)
        ),
        sort_order: Math.round(Number(editProdForm.sort_order) || 0),
        is_active: editProdForm.is_active,
        is_featured: editProdForm.is_featured,
        image_url: nextImageUrl,
      };

      let { error } = await supabase
        .from('products')
        .update(fullPayload)
        .eq('id', editingProduct.id);

      if (error && isMissingSchemaError(error)) {
        const fallbackRes = await supabase
          .from('products')
          .update({
            name_ar: fullPayload.name_ar,
            category: fullPayload.category,
            price_iqd: fullPayload.price_iqd,
            stock_quantity: fullPayload.stock_quantity,
            low_stock_threshold: fullPayload.low_stock_threshold,
            is_active: fullPayload.is_active,
            image_url: fullPayload.image_url,
          })
          .eq('id', editingProduct.id);
        error = fallbackRes.error;
        if (!error) {
          setMigrationNeeded(true);
        }
      }

      if (error) {
        setActionError(`تعذّر حفظ المنتج: ${error.message}`);
      } else {
        await writeAuditLog('update_product', 'product', editingProduct.id, {
          name_ar: fullPayload.name_ar,
          price_iqd: fullPayload.price_iqd,
          image_changed: nextImageUrl !== editingProduct.image_url,
        });
        setActionMessage(`تم حفظ تعديلات "${fullPayload.name_ar}" بنجاح.`);
        setEditingProduct(null);
        await loadAllAdminData();
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'فشل تعديل المنتج.');
    } finally {
      setSavingProduct(false);
    }
  };

  const handleCreateProduct = async (e: FormEvent) => {
    e.preventDefault();
    if (newProdForm.name_ar.trim().length < 2) {
      setActionError('يرجى إدخال اسم المنتج.');
      return;
    }
    setCreatingProduct(true);
    setActionError(null);
    setActionMessage(null);

    try {
      let imageUrl: string | null = null;
      if (newProdFile) {
        imageUrl = await uploadProductImageToStorage(newProdFile);
      }

      const fullPayload = {
        name_ar: newProdForm.name_ar.trim(),
        description_ar: newProdForm.description_ar.trim(),
        category: newProdForm.category,
        price_iqd: Math.max(0, Math.round(Number(newProdForm.price_iqd) || 0)),
        stock_quantity: Math.max(0, Math.round(Number(newProdForm.stock_quantity) || 0)),
        low_stock_threshold: Math.max(
          0,
          Math.round(Number(newProdForm.low_stock_threshold) || 0)
        ),
        sort_order: Math.round(Number(newProdForm.sort_order) || 0),
        is_active: newProdForm.is_active,
        is_featured: newProdForm.is_featured,
        image_url: imageUrl,
      };

      let res = await supabase.from('products').insert(fullPayload).select('id').single();

      if (res.error && isMissingSchemaError(res.error)) {
        res = await supabase
          .from('products')
          .insert({
            name_ar: fullPayload.name_ar,
            category: fullPayload.category,
            price_iqd: fullPayload.price_iqd,
            stock_quantity: fullPayload.stock_quantity,
            low_stock_threshold: fullPayload.low_stock_threshold,
            is_active: fullPayload.is_active,
            image_url: fullPayload.image_url,
          })
          .select('id')
          .single();
        if (!res.error) setMigrationNeeded(true);
      }

      if (res.error) {
        setActionError(`تعذّر إضافة المنتج: ${res.error.message}`);
      } else {
        await writeAuditLog('create_product', 'product', res.data?.id ?? null, {
          name_ar: fullPayload.name_ar,
          price_iqd: fullPayload.price_iqd,
        });
        setActionMessage(`تمت إضافة "${fullPayload.name_ar}" إلى المتجر بنجاح.`);
        setNewProdForm({
          name_ar: '',
          description_ar: '',
          category: 'flower',
          price_iqd: '3000',
          stock_quantity: '50',
          low_stock_threshold: '10',
          sort_order: '0',
          is_active: true,
          is_featured: false,
        });
        setNewProdFile(null);
        setNewProdPreview(null);
        setActiveTab('products');
        await loadAllAdminData();
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'فشل إضافة المنتج.');
    } finally {
      setCreatingProduct(false);
    }
  };

  const handleConfirmDeleteProduct = async () => {
    if (!deletingProduct) return;
    setSavingProduct(true);
    setActionError(null);
    const { error } = await supabase.from('products').delete().eq('id', deletingProduct.id);
    if (error) {
      setActionError(`تعذّر حذف المنتج: ${error.message}`);
    } else {
      await writeAuditLog('delete_product', 'product', deletingProduct.id, {
        name_ar: deletingProduct.name_ar,
      });
      setActionMessage(`تم حذف المنتج "${deletingProduct.name_ar}".`);
      setDeletingProduct(null);
      await loadAllAdminData();
    }
    setSavingProduct(false);
  };

  const handleToggleProductQuick = async (
    product: ProductRow,
    field: 'is_active' | 'is_featured'
  ) => {
    const nextVal = !Boolean(product[field]);
    const { error } = await supabase
      .from('products')
      .update({ [field]: nextVal })
      .eq('id', product.id);
    if (error) {
      setActionError(`تعذّر التحديث: ${error.message}`);
    } else {
      setProducts((prev) =>
        prev.map((p) => (p.id === product.id ? { ...p, [field]: nextVal } : p))
      );
      await writeAuditLog(`toggle_${field}`, 'product', product.id, { [field]: nextVal });
    }
  };

  // Categories CRUD
  const handleAddCategory = async (e: FormEvent) => {
    e.preventDefault();
    if (!newCatForm.name_ar.trim() || !newCatForm.slug.trim()) return;
    setBusyCategory(true);
    setActionError(null);
    const { error } = await supabase.from('categories').insert({
      slug: newCatForm.slug.trim().toLowerCase(),
      name_ar: newCatForm.name_ar.trim(),
      description_ar: newCatForm.description_ar.trim(),
      sort_order: Number(newCatForm.sort_order) || 0,
      is_active: true,
    });
    if (error) {
      setActionError(
        isMissingSchemaError(error)
          ? 'يرجى تشغيل ملف supabase_migration.sql لتفعيل جدول التصنيفات المخصصة.'
          : `فشل إضافة التصنيف: ${error.message}`
      );
    } else {
      await writeAuditLog('create_category', 'category', newCatForm.slug, {
        name_ar: newCatForm.name_ar,
      });
      setNewCatForm({ slug: '', name_ar: '', description_ar: '', sort_order: '4' });
      setActionMessage('تمت إضافة التصنيف بنجاح.');
      await loadAllAdminData();
    }
    setBusyCategory(false);
  };

  const handleToggleCategory = async (cat: CategoryRow) => {
    const { error } = await supabase
      .from('categories')
      .update({ is_active: !cat.is_active })
      .eq('id', cat.id);
    if (error) {
      setActionError(
        isMissingSchemaError(error)
          ? 'جدول التصنيفات يتطلب تشغيل supabase_migration.sql.'
          : error.message
      );
    } else {
      await writeAuditLog('toggle_category', 'category', cat.id, {
        is_active: !cat.is_active,
      });
      await loadAllAdminData();
    }
  };

  // Loyalty: Manual correction (reason required!) & Reward redemption
  const handleSubmitStampAdjustment = async (e: FormEvent) => {
    e.preventDefault();
    if (!adjustModalCustomer) return;
    const reason = adjustReason.trim();
    if (reason.length < 3) {
      setActionError('يجب كتابة سبب واضح ومعتمد لتعديل الختم.');
      return;
    }

    const cust = adjustModalCustomer.customer;
    const delta = adjustDelta === '1' ? 1 : -1;
    const nextStamps = Math.max(0, (cust.stamps_count ?? 0) + delta);

    setBusyLoyaltyId(cust.id);
    setActionError(null);

    const { error: updErr } = await supabase
      .from('customers')
      .update({ stamps_count: nextStamps })
      .eq('id', cust.id);

    if (updErr) {
      setActionError(`فشل تعديل الختم: ${updErr.message}`);
      setBusyLoyaltyId(null);
      return;
    }

    await supabase.from('loyalty_logs').insert({
      customer_id: cust.id,
      order_id: null,
      action: 'manual_adjustment',
      notes: `تصحيح إداري (${delta > 0 ? '+1' : '-1'}) — السبب: ${reason}`,
    });

    await writeAuditLog('loyalty_manual_adjustment', 'customer', cust.id, {
      delta,
      reason,
      new_stamps: nextStamps,
    });

    setActionMessage(`تم تصحيح أختام ${cust.full_name} مع توثيق السبب في السجل.`);
    setAdjustModalCustomer(null);
    setAdjustReason('');
    setBusyLoyaltyId(null);
    await loadAllAdminData();
  };

  const handleRedeemReward = async (summary: CustomerSummary) => {
    if (!summary.isRewardEligible) {
      setActionError(
        `الزبون ${summary.customer.full_name} لم يكمل ${requiredPurchases} عمليات شراء مؤهلة بعد.`
      );
      return;
    }
    const cust = summary.customer;
    setBusyLoyaltyId(cust.id);
    setActionError(null);

    const remaining = Math.max(0, (cust.stamps_count ?? 0) - requiredPurchases);
    const { error: updErr } = await supabase
      .from('customers')
      .update({ stamps_count: remaining })
      .eq('id', cust.id);

    if (updErr) {
      setActionError(`تعذّر تسجيل استلام المكافأة: ${updErr.message}`);
      setBusyLoyaltyId(null);
      return;
    }

    await supabase.from('loyalty_logs').insert({
      customer_id: cust.id,
      order_id: null,
      action: 'redeem_reward',
      notes: `استلام مكافأة الطلب العاشر (${settings.loyalty_reward_value || 'مكافأة SEDO'})`,
    });

    await writeAuditLog('loyalty_redeem_reward', 'customer', cust.id, {
      customer_name: cust.full_name,
      reward: settings.loyalty_reward_value,
    });

    setActionMessage(`تم تسجيل استلام مكافأة الطلب العاشر للزبون ${cust.full_name}.`);
    setBusyLoyaltyId(null);
    await loadAllAdminData();
  };

  // Save Store Settings & Contact Information
  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setActionError(null);
    setActionMessage(null);

    const fullUpdate = {
      shop_name: settingsDraft.shop_name.trim(),
      address: settingsDraft.address.trim(),
      working_hours: settingsDraft.working_hours.trim(),
      phone_numbers: settingsDraft.phone_numbers?.trim() || '07762963674, 07733484176',
      whatsapp_numbers:
        settingsDraft.whatsapp_numbers?.trim() ||
        settingsDraft.phone_numbers?.trim() ||
        '07762963674, 07733484176',
      instagram_url:
        settingsDraft.instagram_url?.trim() || 'https://www.instagram.com/sedo.gift/',
      google_maps_url: settingsDraft.google_maps_url?.trim() || null,
      loyalty_required_purchases: Math.max(
        1,
        Number(settingsDraft.loyalty_required_purchases) || 9
      ),
      loyalty_reward_type: settingsDraft.loyalty_reward_type || 'gift',
      loyalty_reward_value:
        settingsDraft.loyalty_reward_value?.trim() || 'باقة أو هدية مجانية على الطلب العاشر',
      cash_only: true,
    };

    let { error } = await supabase
      .from('store_settings')
      .update(fullUpdate)
      .eq('id', settings.id);

    if (error && isMissingSchemaError(error)) {
      const coreRes = await supabase
        .from('store_settings')
        .update({
          shop_name: fullUpdate.shop_name,
          address: fullUpdate.address,
          working_hours: fullUpdate.working_hours,
          phone_numbers: fullUpdate.phone_numbers,
          instagram_url: fullUpdate.instagram_url,
          google_maps_url: fullUpdate.google_maps_url,
        })
        .eq('id', settings.id);
      error = coreRes.error;
      if (!error) setMigrationNeeded(true);
    }

    if (error) {
      setActionError(`تعذّر حفظ الإعدادات: ${error.message}`);
    } else {
      await writeAuditLog('update_store_settings', 'store_settings', String(settings.id), {
        shop_name: fullUpdate.shop_name,
        phone_numbers: fullUpdate.phone_numbers,
      });
      setSettings({ ...settingsDraft, ...fullUpdate });
      setActionMessage('تم حفظ إعدادات المتجر ومعلومات التواصل في Supabase بنجاح.');
    }
    setSavingSettings(false);
  };

  if (!authReady) {
    return (
      <div
        dir="rtl"
        className="min-h-screen bg-[#5E1D2F] text-white flex items-center justify-center p-6"
      >
        <div className="text-sm text-white/80">جاري التحقق من الجلسة الآمنة...</div>
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
                <h1 className="text-xl font-bold text-white">دخول إدارة SEDO</h1>
                <p className="text-xs text-white/75">وصول محمي عبر Supabase Auth</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onBackHome}
              className="text-xs text-white/80 hover:text-white underline cursor-pointer"
            >
              العودة للمتجر
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
                placeholder="admin@sedo.iq"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/25 text-white placeholder:text-white/45 text-sm text-left focus:outline-none focus:border-white"
              />
            </div>

            <div>
              <label
                htmlFor="admin-password"
                className="block text-sm font-medium text-white mb-1.5"
              >
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
    <div dir="rtl" className="min-h-screen bg-[#5E1D2F] text-white flex flex-col lg:flex-row">
      {/* Sidebar Desktop / Drawer Mobile */}
      <aside
        className={`${
          mobileMenuOpen ? 'block' : 'hidden'
        } lg:block w-full lg:w-64 shrink-0 bg-[#461221] border-b lg:border-b-0 lg:border-l border-white/15 p-4 space-y-4`}
      >
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-white/15">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#0E0A0C] border border-white/20 flex items-center justify-center">
              <Flower2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-sm font-bold text-white">إدارة SEDO</div>
              <div className="text-[11px] text-white/70 truncate max-w-[140px]" dir="ltr">
                {session.user.email}
              </div>
            </div>
          </div>
        </div>

        <nav className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-1 gap-1.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-medium border transition cursor-pointer text-right ${
                  active
                    ? 'bg-[#0E0A0C] text-white border-white/40'
                    : 'bg-transparent text-white/80 border-transparent hover:bg-[#5E1D2F] hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="pt-3 border-t border-white/15 flex flex-col gap-2">
          <button
            type="button"
            onClick={onBackHome}
            className="w-full py-2 px-3 rounded-xl bg-[#5E1D2F] border border-white/20 text-xs font-medium text-white hover:bg-[#6E2438] transition cursor-pointer"
          >
            عرض الموقع العام
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-[#0E0A0C] border border-white/20 text-xs font-medium text-white hover:bg-black transition cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="bg-[#461221] border-b border-white/15 px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="lg:hidden p-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-white"
              aria-label="قائمة الإدارة"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-white">
                {NAV_ITEMS.find((i) => i.id === activeTab)?.label ?? 'لوحة الإدارة'}
              </h1>
              <p className="text-xs text-white/70 tabular-nums-en">
                توقيت بغداد: {todayBaghdad}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={loadAllAdminData}
            disabled={loadingData}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-xs font-medium text-white hover:bg-black transition cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingData ? 'animate-spin' : ''}`} />
            <span>تحديث البيانات</span>
          </button>
        </header>

        <main className="p-4 sm:p-6 space-y-6 flex-1">
          {migrationNeeded && (
            <div className="rounded-xl bg-[#0E0A0C] border border-white/35 p-4 text-xs sm:text-sm text-white flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-[#F48FB1]" />
              <div>
                بعض الحقول الإضافية (مثل وصف المنتج، التميز، التصنيفات المخصصة، وحاوية الصور{' '}
                <code className="px-1 bg-[#461221] rounded">product-images</code>) تتطلب تشغيل
                ملف <code className="px-1 bg-[#461221] rounded">supabase_migration.sql</code> في
                Supabase SQL Editor لتفعيلها بالكامل.
              </div>
            </div>
          )}

          {actionError && (
            <div className="rounded-xl bg-[#0E0A0C] border border-white/40 p-4 text-sm text-white flex items-center justify-between gap-2">
              <span>{actionError}</span>
              <button
                type="button"
                onClick={() => setActionError(null)}
                className="text-white/70 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {actionMessage && (
            <div className="rounded-xl bg-[#461221] border border-white/40 p-4 text-sm text-white flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{actionMessage}</span>
              </span>
              <button
                type="button"
                onClick={() => setActionMessage(null)}
                className="text-white/70 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* 1. DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="طلبات اليوم (بغداد)" value={String(todayStats.total)} />
                <StatCard
                  label="مبيعات اليوم المسلمة"
                  value={formatIqd(todayStats.deliveredSalesIqd)}
                />
                <StatCard label="إجمالي الزبائن" value={String(customers.length)} />
                <StatCard
                  label="المنتجات النشطة"
                  value={`${products.filter((p) => p.is_active).length} / ${products.length}`}
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-2xl bg-[#461221] border border-white/15 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-bold text-white">أحدث الطلبات</h2>
                    <button
                      type="button"
                      onClick={() => setActiveTab('orders')}
                      className="text-xs text-white/80 underline cursor-pointer"
                    >
                      عرض الكل
                    </button>
                  </div>
                  {orders.length === 0 ? (
                    <p className="text-sm text-white/75">لا توجد طلبات مسجلة بعد.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {orders.slice(0, 5).map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => setSelectedOrderModal(o)}
                          className="w-full text-right p-3.5 rounded-xl bg-[#0E0A0C] border border-white/15 hover:border-white/40 flex items-center justify-between gap-3 transition cursor-pointer"
                        >
                          <div>
                            <div className="text-sm font-semibold text-white">
                              {o.customer_name} • #{o.id.slice(0, 8)}
                            </div>
                            <div className="text-xs text-white/70 tabular-nums-en mt-0.5">
                              {formatBaghdadDateTime(o.created_at)}
                            </div>
                          </div>
                          <div className="text-left">
                            <div className="text-sm font-bold text-white tabular-nums-en">
                              {formatIqd(o.total_price_iqd)}
                            </div>
                            <div className="text-[11px] text-white/75 mt-0.5">
                              {ADMIN_STATUS_LABELS[o.status] ?? o.status}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl bg-[#461221] border border-white/15 p-5 space-y-4">
                  <h2 className="font-bold text-white">تنبيهات المخزون المنخفض</h2>
                  {products.filter((p) => p.stock_quantity <= (p.low_stock_threshold ?? 10))
                    .length === 0 ? (
                    <p className="text-sm text-white/80">جميع المنتجات متوفرة بمخزون جيد.</p>
                  ) : (
                    <div className="space-y-2">
                      {products
                        .filter((p) => p.stock_quantity <= (p.low_stock_threshold ?? 10))
                        .map((p) => (
                          <div
                            key={p.id}
                            className="p-3 rounded-xl bg-[#0E0A0C] border border-white/20 flex items-center justify-between text-sm"
                          >
                            <span>{p.name_ar}</span>
                            <span className="tabular-nums-en text-[#F48FB1]">
                              المتبقي: {p.stock_quantity}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 2. ALL ORDERS */}
          {activeTab === 'orders' && (
            <section className="rounded-2xl bg-[#461221] border border-white/15 p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <input
                  type="text"
                  value={orderSearchQuery}
                  onChange={(e) => setOrderSearchQuery(e.target.value)}
                  placeholder="بحث بالاسم، الهاتف، أو رقم الطلب..."
                  className="px-3.5 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/20 text-white placeholder:text-white/50 text-sm focus:outline-none focus:border-white"
                />
                <select
                  value={orderStatusFilter}
                  onChange={(e) => setOrderStatusFilter(e.target.value)}
                  className="px-3.5 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm focus:outline-none focus:border-white"
                >
                  <option value="all">كل الحالات</option>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={orderDateFilter}
                  onChange={(e) => setOrderDateFilter(e.target.value)}
                  className="px-3.5 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm tabular-nums-en focus:outline-none focus:border-white"
                />
                <button
                  type="button"
                  onClick={() => {
                    setOrderSearchQuery('');
                    setOrderStatusFilter('all');
                    setOrderDateFilter('');
                  }}
                  className="px-4 py-2.5 rounded-xl bg-[#5E1D2F] border border-white/20 text-sm text-white hover:bg-[#6E2438] cursor-pointer"
                >
                  إعادة ضبط الفلاتر
                </button>
              </div>

              <OrdersTable
                orders={filteredAllOrders}
                loyaltyLogs={loyaltyLogs}
                busyOrderId={busyOrderId}
                onOpenDetail={setSelectedOrderModal}
                onUpdateStatus={handleUpdateOrderStatus}
                onAwardStamp={(ord) => awardQualifyingStampForOrder(ord, false).then((msg) => {
                  if (msg) {
                    setActionMessage(msg);
                    loadAllAdminData();
                  }
                })}
              />
            </section>
          )}

          {/* 3. TODAY'S ORDERS (Asia/Baghdad) */}
          {activeTab === 'today_orders' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="إجمالي طلبات اليوم" value={String(selectedDayStats.total)} />
                <StatCard label="قيد الانتظار" value={String(selectedDayStats.pending)} />
                <StatCard label="مؤكدة" value={String(selectedDayStats.confirmed)} />
                <StatCard label="قيد التجهيز" value={String(selectedDayStats.preparing)} />
                <StatCard label="قيد التوصيل" value={String(selectedDayStats.outForDelivery)} />
                <StatCard label="تم التوصيل" value={String(selectedDayStats.delivered)} />
                <StatCard label="ملغاة" value={String(selectedDayStats.cancelled)} />
                <StatCard
                  label="مبيعات المسلمة اليوم"
                  value={formatIqd(selectedDayStats.deliveredSalesIqd)}
                />
              </div>

              <section className="rounded-2xl bg-[#461221] border border-white/15 p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <input
                    type="text"
                    value={orderSearchQuery}
                    onChange={(e) => setOrderSearchQuery(e.target.value)}
                    placeholder="بحث بالاسم، الهاتف، رقم الطلب..."
                    className="px-3.5 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/20 text-white placeholder:text-white/50 text-sm focus:outline-none focus:border-white"
                  />
                  <select
                    value={todayStatusFilter}
                    onChange={(e) => setTodayStatusFilter(e.target.value)}
                    className="px-3.5 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm focus:outline-none focus:border-white"
                  >
                    <option value="all">كل حالات اليوم</option>
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={todayDateFilter}
                    onChange={(e) => setTodayDateFilter(e.target.value)}
                    className="px-3.5 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm tabular-nums-en focus:outline-none focus:border-white"
                  />
                </div>

                <OrdersTable
                  orders={filteredTodayOrders}
                  loyaltyLogs={loyaltyLogs}
                  busyOrderId={busyOrderId}
                  onOpenDetail={setSelectedOrderModal}
                  onUpdateStatus={handleUpdateOrderStatus}
                  onAwardStamp={(ord) => awardQualifyingStampForOrder(ord, false).then((msg) => {
                    if (msg) {
                      setActionMessage(msg);
                      loadAllAdminData();
                    }
                  })}
                />
              </section>
            </div>
          )}

          {/* 4. PRODUCTS MANAGEMENT */}
          {activeTab === 'products' && (
            <section className="rounded-2xl bg-[#461221] border border-white/15 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2.5 flex-1">
                  <input
                    type="text"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="ابحث باسم المنتج أو الوصف..."
                    className="px-3.5 py-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-white placeholder:text-white/50 text-sm min-w-[220px] focus:outline-none focus:border-white"
                  />
                  <select
                    value={productCategoryFilter}
                    onChange={(e) => setProductCategoryFilter(e.target.value)}
                    className="px-3.5 py-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm focus:outline-none focus:border-white"
                  >
                    <option value="all">كل التصنيفات</option>
                    {categories.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name_ar}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('add_product')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0E0A0C] border border-white/30 text-sm font-semibold text-white hover:bg-black cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>إضافة منتج</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredProducts.map((product) => {
                  const imgSrc = product.image_url || getFallbackImage(product);
                  return (
                    <div
                      key={product.id}
                      className="rounded-2xl bg-[#0E0A0C] border border-white/15 overflow-hidden flex flex-col"
                    >
                      <div className="relative aspect-[16/10] bg-[#461221]">
                        <img
                          src={imgSrc}
                          alt={product.name_ar}
                          onError={(ev) => {
                            ev.currentTarget.src = getFallbackImage(product);
                          }}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute top-2.5 right-2.5 flex gap-1.5">
                          <span className="px-2 py-1 rounded-lg bg-[#0E0A0C]/90 border border-white/25 text-[11px] text-white">
                            {categories.find((c) => c.slug === product.category)?.name_ar ??
                              product.category}
                          </span>
                          {product.is_featured && (
                            <span className="px-2 py-1 rounded-lg bg-[#5E1D2F]/95 border border-white/30 text-[11px] text-[#F8BBD0]">
                              مميز
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="font-bold text-white text-base">{product.name_ar}</h3>
                            <span className="text-sm font-bold text-white tabular-nums-en shrink-0">
                              {formatIqd(product.price_iqd)}
                            </span>
                          </div>
                          {product.description_ar && (
                            <p className="text-xs text-white/75 mt-1 line-clamp-2">
                              {product.description_ar}
                            </p>
                          )}
                          <div className="text-xs text-white/70 mt-2 flex items-center justify-between tabular-nums-en">
                            <span>المتوفر: {product.stock_quantity}</span>
                            <span>الترتيب: {product.sort_order ?? 0}</span>
                          </div>
                        </div>

                        <div className="pt-3 border-t border-white/10 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openEditProduct(product)}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-[#461221] border border-white/25 text-xs font-medium text-white hover:bg-[#5E1D2F] cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>تعديل / صورة</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleProductQuick(product, 'is_active')}
                            className={`py-2 px-3 rounded-xl border text-xs font-medium cursor-pointer ${
                              product.is_active
                                ? 'bg-[#5E1D2F] border-white/30 text-white'
                                : 'bg-[#0E0A0C] border-white/20 text-white/60'
                            }`}
                          >
                            {product.is_active ? 'مفعّل' : 'موقوف'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingProduct(product)}
                            className="p-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-white/80 hover:text-white hover:border-white/40 cursor-pointer"
                            aria-label="حذف المنتج"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* 5. ADD PRODUCT */}
          {activeTab === 'add_product' && (
            <section className="max-w-2xl rounded-2xl bg-[#461221] border border-white/15 p-6 space-y-5">
              <h2 className="text-xl font-bold text-white">إضافة منتج جديد</h2>
              <form onSubmit={handleCreateProduct} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-white mb-1.5">اسم المنتج</label>
                    <input
                      type="text"
                      required
                      value={newProdForm.name_ar}
                      onChange={(e) =>
                        setNewProdForm((p) => ({ ...p, name_ar: e.target.value }))
                      }
                      placeholder="مثال: ورد هولندي فاخر"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-white mb-1.5">التصنيف</label>
                    <select
                      value={newProdForm.category}
                      onChange={(e) =>
                        setNewProdForm((p) => ({ ...p, category: e.target.value }))
                      }
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm"
                    >
                      {categories.map((c) => (
                        <option key={c.slug} value={c.slug}>
                          {c.name_ar}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-white mb-1.5">وصف المنتج</label>
                  <textarea
                    rows={2}
                    value={newProdForm.description_ar}
                    onChange={(e) =>
                      setNewProdForm((p) => ({ ...p, description_ar: e.target.value }))
                    }
                    placeholder="وصف مختصر يظهر للزبائن..."
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs text-white/85 mb-1">السعر (د.ع)</label>
                    <input
                      type="number"
                      min={0}
                      step={250}
                      required
                      value={newProdForm.price_iqd}
                      onChange={(e) =>
                        setNewProdForm((p) => ({ ...p, price_iqd: e.target.value }))
                      }
                      className="w-full px-3 py-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm tabular-nums-en"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-white/85 mb-1">المخزون</label>
                    <input
                      type="number"
                      min={0}
                      required
                      value={newProdForm.stock_quantity}
                      onChange={(e) =>
                        setNewProdForm((p) => ({ ...p, stock_quantity: e.target.value }))
                      }
                      className="w-full px-3 py-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm tabular-nums-en"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-white/85 mb-1">تنبيه النقص</label>
                    <input
                      type="number"
                      min={0}
                      value={newProdForm.low_stock_threshold}
                      onChange={(e) =>
                        setNewProdForm((p) => ({ ...p, low_stock_threshold: e.target.value }))
                      }
                      className="w-full px-3 py-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm tabular-nums-en"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-white/85 mb-1">ترتيب العرض</label>
                    <input
                      type="number"
                      value={newProdForm.sort_order}
                      onChange={(e) =>
                        setNewProdForm((p) => ({ ...p, sort_order: e.target.value }))
                      }
                      className="w-full px-3 py-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm tabular-nums-en"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm text-white">صورة المنتج (JPG/PNG/WEBP حتى 5MB)</label>
                  <label className="flex items-center justify-center gap-2 p-4 rounded-xl bg-[#0E0A0C] border border-dashed border-white/30 hover:border-white cursor-pointer text-sm">
                    <Upload className="w-4 h-4" />
                    <span>{newProdFile ? newProdFile.name : 'اختر صورة من جهازك'}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      onChange={(e: ChangeEvent<HTMLInputElement>) => {
                        const file = e.target.files?.[0] ?? null;
                        if (!file) return;
                        const check = validateProductImageFile(file);
                        if (!check.valid) {
                          setActionError(check.error || 'ملف غير صالح');
                          return;
                        }
                        setNewProdFile(file);
                        setNewProdPreview(URL.createObjectURL(file));
                      }}
                    />
                  </label>
                  {newProdPreview && (
                    <img
                      src={newProdPreview}
                      alt="معاينة الصورة"
                      className="w-40 h-28 object-cover rounded-xl border border-white/20"
                    />
                  )}
                </div>

                <div className="flex flex-wrap gap-4 pt-1">
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newProdForm.is_active}
                      onChange={(e) =>
                        setNewProdForm((p) => ({ ...p, is_active: e.target.checked }))
                      }
                    />
                    <span>مفعّل في المتجر</span>
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newProdForm.is_featured}
                      onChange={(e) =>
                        setNewProdForm((p) => ({ ...p, is_featured: e.target.checked }))
                      }
                    />
                    <span>منتج مميز</span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={creatingProduct}
                  className="px-6 py-3 rounded-xl bg-[#0E0A0C] hover:bg-black border border-white/30 text-sm font-semibold text-white cursor-pointer"
                >
                  {creatingProduct ? 'جاري الحفظ...' : 'إضافة المنتج وحفظه في Supabase'}
                </button>
              </form>
            </section>
          )}

          {/* 6. CATEGORIES */}
          {activeTab === 'categories' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 rounded-2xl bg-[#461221] border border-white/15 p-5 space-y-3">
                <h2 className="text-lg font-bold text-white">التصنيفات المتوفرة</h2>
                {categories.map((cat) => {
                  const count = products.filter((p) => p.category === cat.slug).length;
                  return (
                    <div
                      key={cat.id}
                      className="p-4 rounded-xl bg-[#0E0A0C] border border-white/15 flex items-center justify-between gap-3"
                    >
                      <div>
                        <div className="font-semibold text-white">{cat.name_ar}</div>
                        <div className="text-xs text-white/65 mt-0.5 tabular-nums-en">
                          المعرف: {cat.slug} • عدد المنتجات: {count}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleToggleCategory(cat)}
                        className={`px-3 py-1.5 rounded-lg border text-xs cursor-pointer ${
                          cat.is_active
                            ? 'bg-[#5E1D2F] border-white/30 text-white'
                            : 'bg-[#0E0A0C] border-white/20 text-white/60'
                        }`}
                      >
                        {cat.is_active ? 'نشط' : 'مخفي'}
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="lg:col-span-5 rounded-2xl bg-[#461221] border border-white/15 p-5 space-y-4">
                <h2 className="text-lg font-bold text-white">إضافة تصنيف جديد</h2>
                <form onSubmit={handleAddCategory} className="space-y-3">
                  <div>
                    <label className="block text-xs text-white/85 mb-1">اسم التصنيف بالعربي</label>
                    <input
                      type="text"
                      required
                      value={newCatForm.name_ar}
                      onChange={(e) =>
                        setNewCatForm((c) => ({ ...c, name_ar: e.target.value }))
                      }
                      placeholder="مثال: باقات جاهزة"
                      className="w-full px-3.5 py-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-white/85 mb-1">المعرّف البرمجي (Slug بالإنجليزي)</label>
                    <input
                      type="text"
                      dir="ltr"
                      required
                      value={newCatForm.slug}
                      onChange={(e) =>
                        setNewCatForm((c) => ({ ...c, slug: e.target.value }))
                      }
                      placeholder="ready_bouquet"
                      className="w-full px-3.5 py-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-white/85 mb-1">الترتيب</label>
                    <input
                      type="number"
                      value={newCatForm.sort_order}
                      onChange={(e) =>
                        setNewCatForm((c) => ({ ...c, sort_order: e.target.value }))
                      }
                      className="w-full px-3.5 py-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm tabular-nums-en"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={busyCategory}
                    className="w-full py-2.5 rounded-xl bg-[#0E0A0C] border border-white/30 text-sm font-semibold text-white hover:bg-black cursor-pointer"
                  >
                    {busyCategory ? 'جاري الإضافة...' : 'حفظ التصنيف'}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* 7. CUSTOMERS */}
          {activeTab === 'customers' && (
            <section className="rounded-2xl bg-[#461221] border border-white/15 p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-white">
                  سجل الزبائن ({filteredCustomers.length})
                </h2>
                <input
                  type="text"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="بحث باسم الزبون، رقم الهاتف، أو رقم الطلب..."
                  className="px-4 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/20 text-white placeholder:text-white/50 text-sm sm:min-w-[320px] focus:outline-none focus:border-white"
                />
              </div>

              {filteredCustomers.length === 0 ? (
                <p className="text-sm text-white/75 py-4">لا توجد سجلات زبائن مطابقة.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-sm border-collapse min-w-[920px]">
                    <thead>
                      <tr className="border-b border-white/15 text-xs text-white/75">
                        <th className="py-3 px-3">الزبون</th>
                        <th className="py-3 px-3">الهاتف والواتساب</th>
                        <th className="py-3 px-3">العنوان وأقرب نقطة</th>
                        <th className="py-3 px-3">الطلبات (الكل / مكتمل / ملغي)</th>
                        <th className="py-3 px-3">إجمالي الإنفاق</th>
                        <th className="py-3 px-3">الولاء</th>
                        <th className="py-3 px-3">التفاصيل</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {filteredCustomers.map((cs) => (
                        <tr key={cs.customer.id}>
                          <td className="py-3 px-3">
                            <div className="font-semibold text-white">{cs.customer.full_name}</div>
                            <div className="text-xs text-white/65 tabular-nums-en">
                              أول تسجيل: {formatBaghdadDateTime(cs.firstOrderAt)}
                            </div>
                          </td>
                          <td className="py-3 px-3 tabular-nums-en">
                            <a
                              href={`tel:${normalizePhone(cs.customer.phone)}`}
                              className="text-white hover:underline block"
                              dir="ltr"
                            >
                              {cs.customer.phone}
                            </a>
                            <a
                              href={formatWhatsAppUrl(
                                cs.customer.whatsapp || cs.customer.phone
                              )}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-[#F8BBD0] hover:underline mt-0.5"
                            >
                              <MessageCircle className="w-3 h-3" />
                              <span>واتساب</span>
                            </a>
                          </td>
                          <td className="py-3 px-3 text-xs text-white/85">
                            <div>{cs.city || '—'} • {cs.deliveryAddress || '—'}</div>
                            {cs.nearestLandmark && (
                              <div className="text-white/65">قرب: {cs.nearestLandmark}</div>
                            )}
                          </td>
                          <td className="py-3 px-3 tabular-nums-en">
                            {cs.totalOrdersCount} / {cs.completedCount} / {cs.cancelledCount}
                          </td>
                          <td className="py-3 px-3 font-semibold tabular-nums-en">
                            {formatIqd(cs.totalSpendingIqd)}
                          </td>
                          <td className="py-3 px-3 tabular-nums-en">
                            <span className="text-[#F48FB1] font-semibold">
                              {cs.customer.stamps_count} / {requiredPurchases}
                            </span>
                          </td>
                          <td className="py-3 px-3">
                            <button
                              type="button"
                              onClick={() => setSelectedCustomerSummary(cs)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#0E0A0C] border border-white/25 text-xs text-white hover:bg-black cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>السجل الكامل</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* 8. LOYALTY CARDS MANAGEMENT */}
          {activeTab === 'loyalty' && (
            <div className="space-y-6">
              <div className="rounded-2xl bg-[#461221] border border-white/15 p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-white">نظام الولاء الرسمي — SEDO</h2>
                    <p className="text-xs text-white/80 mt-0.5">
                      ختم واحد لكل طلب شراء مكتمل/مسلّم فقط • بعد {requiredPurchases} مشتريات
                      مكتملة يتأهل الزبون لمكافأة الطلب العاشر: {settings.loyalty_reward_value}
                    </p>
                  </div>
                  <input
                    type="text"
                    value={loyaltySearch}
                    onChange={(e) => setLoyaltySearch(e.target.value)}
                    placeholder="ابحث باسم الزبون أو رقم الهاتف..."
                    className="px-3.5 py-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-white placeholder:text-white/50 text-sm sm:min-w-[280px]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {filteredLoyaltyCustomers.map((cs) => {
                  const cust = cs.customer;
                  const busy = busyLoyaltyId === cust.id;
                  return (
                    <div
                      key={cust.id}
                      className="rounded-2xl bg-[#0E0A0C] border border-white/20 p-5 space-y-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-bold text-white text-base">{cust.full_name}</div>
                          <div className="text-xs text-white/75 tabular-nums-en" dir="ltr">
                            {cust.phone}
                          </div>
                          <div className="text-xs text-white/70 mt-1 tabular-nums-en">
                            المشتريات المكتملة: {cs.completedCount} • المتبقي للمكافأة:{' '}
                            {cs.remainingToReward}
                          </div>
                        </div>
                        <div className="text-left">
                          <div className="text-xl font-bold text-[#F48FB1] tabular-nums-en">
                            {cust.stamps_count} / {requiredPurchases}
                          </div>
                          <div className="text-[11px] text-white/80 mt-0.5">
                            {cs.isRewardEligible ? 'مؤهل للمكافأة ✓' : 'قيد التجميع'}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {cs.isRewardEligible && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleRedeemReward(cs)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#5E1D2F] border border-[#F48FB1] text-xs font-semibold text-white hover:bg-[#7C2C42] cursor-pointer"
                          >
                            <Gift className="w-3.5 h-3.5 text-[#F48FB1]" />
                            <span>تسجيل استلام المكافأة (الطلب العاشر)</span>
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setAdjustModalCustomer(cs);
                            setAdjustReason('');
                          }}
                          className="px-3.5 py-2 rounded-xl bg-[#461221] border border-white/25 text-xs font-medium text-white hover:bg-[#5E1D2F] cursor-pointer"
                        >
                          تصحيح ختم (بسبب موثّق)
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedCustomerSummary(cs)}
                          className="px-3.5 py-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-xs text-white/85 hover:text-white cursor-pointer"
                        >
                          سجل الحركات ({cs.loyaltyLogs.length})
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 9. REPORTS */}
          {activeTab === 'reports' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatCard
                  label="إجمالي مبيعات المسلمة (الكل)"
                  value={formatIqd(
                    orders
                      .filter((o) => isQualifyingCompletedStatus(o.status))
                      .reduce((s, o) => s + (Number(o.total_price_iqd) || 0), 0)
                  )}
                />
                <StatCard
                  label="الطلبات المكتملة"
                  value={String(orders.filter((o) => isQualifyingCompletedStatus(o.status)).length)}
                />
                <StatCard
                  label="الطلبات الملغاة"
                  value={String(orders.filter((o) => o.status === 'cancelled').length)}
                />
              </div>

              <div className="rounded-2xl bg-[#461221] border border-white/15 p-5 space-y-3">
                <h2 className="text-lg font-bold text-white">تقرير حالات الطلبات</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {STATUS_OPTIONS.map((st) => {
                    const count = orders.filter((o) =>
                      st.value === 'delivered'
                        ? isQualifyingCompletedStatus(o.status)
                        : o.status === st.value
                    ).length;
                    return (
                      <div
                        key={st.value}
                        className="p-3.5 rounded-xl bg-[#0E0A0C] border border-white/15 text-center"
                      >
                        <div className="text-xs text-white/75">{st.label}</div>
                        <div className="text-xl font-bold text-white tabular-nums-en mt-1">
                          {count}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* 10. STORE SETTINGS & AUDIT LOGS */}
          {activeTab === 'settings' && (
            <div className="space-y-6">
              <section className="rounded-2xl bg-[#461221] border border-white/15 p-6 space-y-4">
                <h2 className="text-lg font-bold text-white">إعدادات المتجر والمكافآت والدفع</h2>
                <form onSubmit={handleSaveSettings} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-white/85 mb-1">اسم المتجر</label>
                      <input
                        type="text"
                        required
                        value={settingsDraft.shop_name}
                        onChange={(e) =>
                          setSettingsDraft((s) => ({ ...s, shop_name: e.target.value }))
                        }
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-white/85 mb-1">ساعات العمل</label>
                      <input
                        type="text"
                        required
                        value={settingsDraft.working_hours}
                        onChange={(e) =>
                          setSettingsDraft((s) => ({ ...s, working_hours: e.target.value }))
                        }
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-white/85 mb-1">العنوان</label>
                    <input
                      type="text"
                      required
                      value={settingsDraft.address}
                      onChange={(e) =>
                        setSettingsDraft((s) => ({ ...s, address: e.target.value }))
                      }
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-white/15">
                    <div>
                      <label className="block text-xs text-white/85 mb-1">
                        عدد المشتريات المؤهلة للمكافأة
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={settingsDraft.loyalty_required_purchases ?? 9}
                        onChange={(e) =>
                          setSettingsDraft((s) => ({
                            ...s,
                            loyalty_required_purchases: Number(e.target.value) || 9,
                          }))
                        }
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm tabular-nums-en"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-white/85 mb-1">نوع المكافأة</label>
                      <select
                        value={settingsDraft.loyalty_reward_type || 'gift'}
                        onChange={(e) =>
                          setSettingsDraft((s) => ({ ...s, loyalty_reward_type: e.target.value }))
                        }
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm"
                      >
                        <option value="gift">هدية مجانية</option>
                        <option value="discount">خصم خاص</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-white/85 mb-1">وصف المكافأة</label>
                      <input
                        type="text"
                        value={settingsDraft.loyalty_reward_value ?? ''}
                        onChange={(e) =>
                          setSettingsDraft((s) => ({
                            ...s,
                            loyalty_reward_value: e.target.value,
                          }))
                        }
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm"
                      />
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#0E0A0C] border border-white/20 text-xs text-white/85">
                    <strong>طريقة الدفع المعتمدة:</strong> الدفع عند الاستلام فقط (Cash on
                    Delivery) — تم إخفاء زين كاش وفيزا وماستركارد حسب إعدادات المتجر.
                  </div>

                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="px-6 py-2.5 rounded-xl bg-[#0E0A0C] hover:bg-black border border-white/30 text-sm font-semibold text-white cursor-pointer"
                  >
                    {savingSettings ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
                  </button>
                </form>
              </section>

              <section className="rounded-2xl bg-[#461221] border border-white/15 p-6 space-y-3">
                <h2 className="text-lg font-bold text-white">سجل التدقيق الأمني للإدارة</h2>
                {auditLogs.length === 0 ? (
                  <p className="text-xs text-white/75">لا توجد حركات مسجلة في سجل التدقيق بعد.</p>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {auditLogs.map((log) => (
                      <div
                        key={log.id}
                        className="p-3 rounded-xl bg-[#0E0A0C] border border-white/15 text-xs flex flex-wrap justify-between gap-2"
                      >
                        <span>
                          <strong>{log.action}</strong> ({log.entity_type}) —{' '}
                          <span dir="ltr">{log.actor_email}</span>
                        </span>
                        <span className="text-white/65 tabular-nums-en">
                          {formatBaghdadDateTime(log.created_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* 11. CONTACT INFORMATION */}
          {activeTab === 'contact' && (
            <section className="max-w-2xl rounded-2xl bg-[#461221] border border-white/15 p-6 space-y-5">
              <h2 className="text-xl font-bold text-white">إدارة معلومات التواصل والواتساب</h2>
              <form onSubmit={handleSaveSettings} className="space-y-4">
                <div>
                  <label className="block text-sm text-white mb-1.5">
                    أرقام الهاتف الرسمية (مفصولة بفاصلة)
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    required
                    value={settingsDraft.phone_numbers ?? ''}
                    onChange={(e) =>
                      setSettingsDraft((s) => ({ ...s, phone_numbers: e.target.value }))
                    }
                    placeholder="07762963674, 07733484176"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm tabular-nums-en"
                  />
                </div>

                <div>
                  <label className="block text-sm text-white mb-1.5">
                    أرقام الواتساب (مفصولة بفاصلة)
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={settingsDraft.whatsapp_numbers ?? ''}
                    onChange={(e) =>
                      setSettingsDraft((s) => ({ ...s, whatsapp_numbers: e.target.value }))
                    }
                    placeholder="07762963674, 07733484176"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm tabular-nums-en"
                  />
                </div>

                <div>
                  <label className="block text-sm text-white mb-1.5">رابط إنستغرام الرسمي</label>
                  <input
                    type="url"
                    dir="ltr"
                    value={settingsDraft.instagram_url ?? ''}
                    onChange={(e) =>
                      setSettingsDraft((s) => ({ ...s, instagram_url: e.target.value }))
                    }
                    placeholder="https://www.instagram.com/sedo.gift/"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm text-white mb-1.5">رابط خرائط Google</label>
                  <input
                    type="url"
                    dir="ltr"
                    value={settingsDraft.google_maps_url ?? ''}
                    onChange={(e) =>
                      setSettingsDraft((s) => ({ ...s, google_maps_url: e.target.value }))
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm"
                  />
                </div>

                <button
                  type="submit"
                  disabled={savingSettings}
                  className="px-6 py-2.5 rounded-xl bg-[#0E0A0C] hover:bg-black border border-white/30 text-sm font-semibold text-white cursor-pointer"
                >
                  {savingSettings ? 'جاري الحفظ...' : 'حفظ معلومات التواصل'}
                </button>
              </form>
            </section>
          )}
        </main>
      </div>

      {/* ORDER DETAIL MODAL */}
      {selectedOrderModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#461221] border border-white/25 p-6 space-y-5">
            <div className="flex items-center justify-between gap-2 border-b border-white/15 pb-3">
              <div>
                <h3 className="text-lg font-bold text-white tabular-nums-en">
                  تفاصيل الطلب #{selectedOrderModal.id.slice(0, 8)}
                </h3>
                <p className="text-xs text-white/75 tabular-nums-en">
                  {formatBaghdadDateTime(selectedOrderModal.created_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrderModal(null)}
                className="p-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {(() => {
              const meta = extractOrderMeta(selectedOrderModal);
              const d =
                selectedOrderModal.order_details &&
                typeof selectedOrderModal.order_details === 'object'
                  ? (selectedOrderModal.order_details as Partial<BouquetOrderDetails>)
                  : null;
              const stamped = hasOrderStamp(selectedOrderModal.id, loyaltyLogs);
              const historyForOrder = orderHistory.filter(
                (h) => h.order_id === selectedOrderModal.id
              );

              return (
                <div className="space-y-4 text-sm">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl bg-[#0E0A0C] border border-white/15 p-4">
                    <div>
                      <div className="text-xs text-white/60">الزبون</div>
                      <div className="font-semibold text-white">
                        {selectedOrderModal.customer_name}
                      </div>
                      <div className="text-xs text-white/80 tabular-nums-en mt-1" dir="ltr">
                        {selectedOrderModal.customer_phone}
                      </div>
                      <div className="flex gap-2 mt-2">
                        <a
                          href={`tel:${normalizePhone(selectedOrderModal.customer_phone)}`}
                          className="px-2.5 py-1 rounded-lg bg-[#461221] border border-white/20 text-xs text-white"
                        >
                          اتصال
                        </a>
                        <a
                          href={formatWhatsAppUrl(selectedOrderModal.customer_phone)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1 rounded-lg bg-[#5E1D2F] border border-white/20 text-xs text-white"
                        >
                          واتساب
                        </a>
                      </div>
                    </div>
                    <div className="space-y-1 text-xs text-white/85">
                      <div>العنوان: {meta.deliveryAddress || '—'}</div>
                      <div>المدينة/المنطقة: {meta.city || '—'}</div>
                      <div>أقرب نقطة دالة: {meta.nearestLandmark || '—'}</div>
                      <div>ملاحظات: {meta.notes || '—'}</div>
                      <div>طريقة الدفع: {meta.paymentMethod}</div>
                    </div>
                  </div>

                  <div className="rounded-xl bg-[#0E0A0C] border border-white/15 p-4 space-y-2">
                    <div className="font-semibold text-white">المنتجات والتفاصيل</div>
                    {d ? (
                      <ul className="space-y-1.5 text-xs text-white/85">
                        <li>
                          • {d.flower_name} — العدد: {d.flower_count} ×{' '}
                          {formatIqd(d.flower_unit_price_iqd ?? 0)} ({d.flower_color} /{' '}
                          {d.bouquet_shape})
                        </li>
                        <li>
                          • التغليف: {d.wrapping_name} ({formatIqd(d.wrapping_price_iqd ?? 0)})
                        </li>
                        {d.gift_name && (
                          <li>
                            • الهدية: {d.gift_name} ({formatIqd(d.gift_price_iqd ?? 0)})
                          </li>
                        )}
                      </ul>
                    ) : (
                      <p className="text-xs text-white/80">
                        {formatOrderDetailsText(selectedOrderModal.order_details)}
                      </p>
                    )}
                    <div className="pt-2 border-t border-white/15 flex justify-between font-bold text-white tabular-nums-en">
                      <span>الإجمالي</span>
                      <span>{formatIqd(selectedOrderModal.total_price_iqd)}</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs text-white/75">تحديث حالة الطلب:</div>
                    <div className="flex flex-wrap gap-2">
                      {STATUS_OPTIONS.map((st) => (
                        <button
                          key={st.value}
                          type="button"
                          disabled={busyOrderId === selectedOrderModal.id}
                          onClick={() => handleUpdateOrderStatus(selectedOrderModal, st.value)}
                          className={`px-3 py-1.5 rounded-xl border text-xs font-medium cursor-pointer ${
                            selectedOrderModal.status === st.value
                              ? 'bg-[#0E0A0C] border-white text-white'
                              : 'bg-[#5E1D2F] border-white/20 text-white/85 hover:border-white/50'
                          }`}
                        >
                          {st.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-white/15">
                    <span className="text-xs text-white/80">
                      حالة الختم: {stamped ? 'تم منح الختم ✓' : 'لم يُمنح ختم بعد'}
                    </span>
                    {isQualifyingCompletedStatus(selectedOrderModal.status) && !stamped && (
                      <button
                        type="button"
                        onClick={() =>
                          awardQualifyingStampForOrder(selectedOrderModal, false).then((msg) => {
                            if (msg) {
                              setActionMessage(msg);
                              loadAllAdminData();
                            }
                          })
                        }
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0E0A0C] border border-[#F48FB1] text-xs font-semibold text-white cursor-pointer"
                      >
                        <Award className="w-3.5 h-3.5 text-[#F48FB1]" />
                        <span>منح ختم الولاء</span>
                      </button>
                    )}
                  </div>

                  {historyForOrder.length > 0 && (
                    <div className="space-y-1.5 pt-2 border-t border-white/15">
                      <div className="text-xs text-white/75">سجل تغييرات الحالة:</div>
                      {historyForOrder.map((h) => (
                        <div key={h.id} className="text-xs text-white/80 tabular-nums-en">
                          {formatBaghdadDateTime(h.created_at)} —{' '}
                          {ADMIN_STATUS_LABELS[h.new_status] ?? h.new_status}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* EDIT PRODUCT MODAL */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#461221] border border-white/25 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-white/15 pb-3">
              <h3 className="text-lg font-bold text-white">تعديل المنتج</h3>
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                className="p-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditedProduct} className="space-y-4">
              <div>
                <label className="block text-xs text-white/85 mb-1">اسم المنتج</label>
                <input
                  type="text"
                  required
                  value={editProdForm.name_ar}
                  onChange={(e) =>
                    setEditProdForm((f) => ({ ...f, name_ar: e.target.value }))
                  }
                  className="w-full px-3.5 py-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm"
                />
              </div>

              <div>
                <label className="block text-xs text-white/85 mb-1">الوصف</label>
                <textarea
                  rows={2}
                  value={editProdForm.description_ar}
                  onChange={(e) =>
                    setEditProdForm((f) => ({ ...f, description_ar: e.target.value }))
                  }
                  className="w-full px-3.5 py-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-white/85 mb-1">التصنيف</label>
                  <select
                    value={editProdForm.category}
                    onChange={(e) =>
                      setEditProdForm((f) => ({ ...f, category: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm"
                  >
                    {categories.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name_ar}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-white/85 mb-1">السعر (د.ع)</label>
                  <input
                    type="number"
                    min={0}
                    step={250}
                    value={editProdForm.price_iqd}
                    onChange={(e) =>
                      setEditProdForm((f) => ({ ...f, price_iqd: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm tabular-nums-en"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/85 mb-1">الكمية</label>
                  <input
                    type="number"
                    min={0}
                    value={editProdForm.stock_quantity}
                    onChange={(e) =>
                      setEditProdForm((f) => ({ ...f, stock_quantity: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm tabular-nums-en"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-white/85 mb-1">ترتيب العرض</label>
                  <input
                    type="number"
                    value={editProdForm.sort_order}
                    onChange={(e) =>
                      setEditProdForm((f) => ({ ...f, sort_order: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm tabular-nums-en"
                  />
                </div>
                <div className="flex flex-col justify-end gap-2">
                  <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editProdForm.is_active}
                      onChange={(e) =>
                        setEditProdForm((f) => ({ ...f, is_active: e.target.checked }))
                      }
                    />
                    <span>متوفر / مفعّل</span>
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editProdForm.is_featured}
                      onChange={(e) =>
                        setEditProdForm((f) => ({ ...f, is_featured: e.target.checked }))
                      }
                    />
                    <span>منتج مميز</span>
                  </label>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-white/15">
                <div className="text-xs text-white/85">إدارة صورة المنتج</div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#0E0A0C] border border-white/25 text-xs text-white cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    <span>
                      {editProdPendingFile ? editProdPendingFile.name : 'رفع / استبدال الصورة'}
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      onChange={(e: ChangeEvent<HTMLInputElement>) => {
                        const file = e.target.files?.[0] ?? null;
                        if (!file) return;
                        const check = validateProductImageFile(file);
                        if (!check.valid) {
                          setActionError(check.error || 'ملف غير صالح');
                          return;
                        }
                        setEditProdPendingFile(file);
                      }}
                    />
                  </label>
                  {editProdForm.image_url && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditProdForm((f) => ({ ...f, image_url: null }));
                        setEditProdPendingFile(null);
                      }}
                      className="px-3 py-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-xs text-white/80 hover:text-white cursor-pointer"
                    >
                      إزالة الصورة
                    </button>
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={savingProduct}
                className="w-full py-3 rounded-xl bg-[#0E0A0C] hover:bg-black border border-white/30 text-sm font-semibold text-white cursor-pointer"
              >
                {savingProduct ? 'جاري الحفظ...' : 'حفظ التعديلات'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* DELETE PRODUCT CONFIRMATION MODAL */}
      {deletingProduct && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#461221] border border-white/25 p-6 space-y-4">
            <h3 className="text-lg font-bold text-white">تأكيد حذف المنتج</h3>
            <p className="text-sm text-white/85">
              هل أنت متأكد من حذف المنتج <strong>{deletingProduct.name_ar}</strong> نهائياً؟
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                disabled={savingProduct}
                onClick={handleConfirmDeleteProduct}
                className="flex-1 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/40 text-sm font-semibold text-white cursor-pointer"
              >
                نعم، حذف المنتج
              </button>
              <button
                type="button"
                onClick={() => setDeletingProduct(null)}
                className="flex-1 py-2.5 rounded-xl bg-[#5E1D2F] border border-white/20 text-sm text-white cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOMER FULL PROFILE MODAL */}
      {selectedCustomerSummary && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#461221] border border-white/25 p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-white/15 pb-3">
              <div>
                <h3 className="text-lg font-bold text-white">
                  ملف الزبون: {selectedCustomerSummary.customer.full_name}
                </h3>
                <p className="text-xs text-white/75 tabular-nums-en" dir="ltr">
                  {selectedCustomerSummary.customer.phone}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCustomerSummary(null)}
                className="p-2 rounded-xl bg-[#0E0A0C] border border-white/20 text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-[#0E0A0C] border border-white/15">
                <div className="text-white/65">إجمالي الطلبات</div>
                <div className="text-base font-bold tabular-nums-en mt-1">
                  {selectedCustomerSummary.totalOrdersCount}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[#0E0A0C] border border-white/15">
                <div className="text-white/65">مشتريات مكتملة</div>
                <div className="text-base font-bold tabular-nums-en mt-1">
                  {selectedCustomerSummary.completedCount}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[#0E0A0C] border border-white/15">
                <div className="text-white/65">الإنفاق الكلي</div>
                <div className="text-base font-bold tabular-nums-en mt-1">
                  {formatIqd(selectedCustomerSummary.totalSpendingIqd)}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[#0E0A0C] border border-white/15">
                <div className="text-white/65">الأختام</div>
                <div className="text-base font-bold text-[#F48FB1] tabular-nums-en mt-1">
                  {selectedCustomerSummary.customer.stamps_count} / {requiredPurchases}
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-[#0E0A0C] border border-white/15 p-4 text-xs text-white/85 space-y-1.5">
              <div>المدينة / المنطقة: {selectedCustomerSummary.city || '—'}</div>
              <div>العنوان: {selectedCustomerSummary.deliveryAddress || '—'}</div>
              <div>أقرب نقطة دالة: {selectedCustomerSummary.nearestLandmark || '—'}</div>
              <div>الملاحظات: {selectedCustomerSummary.latestNotes || '—'}</div>
              <div>
                آخر طلب: {formatBaghdadDateTime(selectedCustomerSummary.lastOrderAt)}
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="font-semibold text-sm text-white">سجل الطلبات الكامل</h4>
              {selectedCustomerSummary.orders.map((ord) => (
                <div
                  key={ord.id}
                  className="p-3 rounded-xl bg-[#0E0A0C] border border-white/15 text-xs flex justify-between gap-2"
                >
                  <div>
                    <div className="font-semibold tabular-nums-en">
                      #{ord.id.slice(0, 8)} • {formatBaghdadDateTime(ord.created_at)}
                    </div>
                    <div className="text-white/75 mt-1">
                      {formatOrderDetailsText(ord.order_details)}
                    </div>
                  </div>
                  <div className="text-left shrink-0">
                    <div className="font-bold tabular-nums-en">
                      {formatIqd(ord.total_price_iqd)}
                    </div>
                    <div className="text-white/75 mt-1">
                      {ADMIN_STATUS_LABELS[ord.status] ?? ord.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {selectedCustomerSummary.loyaltyLogs.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-semibold text-sm text-white">سجل حركات الولاء والمكافآت</h4>
                {selectedCustomerSummary.loyaltyLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-2.5 rounded-xl bg-[#0E0A0C] border border-white/15 text-xs flex justify-between gap-2"
                  >
                    <span>{log.notes || log.action}</span>
                    <span className="text-white/65 tabular-nums-en">
                      {formatBaghdadDateTime(log.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MANUAL STAMP ADJUSTMENT MODAL (REQUIRES REASON) */}
      {adjustModalCustomer && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#461221] border border-white/25 p-6 space-y-4">
            <h3 className="text-lg font-bold text-white">
              تصحيح ختم: {adjustModalCustomer.customer.full_name}
            </h3>
            <form onSubmit={handleSubmitStampAdjustment} className="space-y-4">
              <div>
                <label className="block text-xs text-white/85 mb-1">نوع التعديل</label>
                <select
                  value={adjustDelta}
                  onChange={(e) => setAdjustDelta(e.target.value as '1' | '-1')}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm"
                >
                  <option value="1">إضافة ختم (+1)</option>
                  <option value="-1">خصم ختم (-1)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-white/85 mb-1">
                  السبب المعتمد للتدقيق (إلزامي)
                </label>
                <textarea
                  rows={2}
                  required
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="مثال: تعويض طلب سابق تم تسليمه باليد..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/20 text-white text-sm"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-[#0E0A0C] border border-white/30 text-sm font-semibold text-white cursor-pointer"
                >
                  تأكيد التصحيح
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustModalCustomer(null)}
                  className="flex-1 py-2.5 rounded-xl bg-[#5E1D2F] border border-white/20 text-sm text-white cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[#461221] border border-white/15 p-4 space-y-1">
      <div className="text-xs text-white/75">{label}</div>
      <div className="text-xl sm:text-2xl font-bold text-white tabular-nums-en">{value}</div>
    </div>
  );
}

function OrdersTable({
  orders,
  loyaltyLogs,
  busyOrderId,
  onOpenDetail,
  onUpdateStatus,
  onAwardStamp,
}: {
  orders: OrderRow[];
  loyaltyLogs: LoyaltyLogRow[];
  busyOrderId: string | null;
  onOpenDetail: (o: OrderRow) => void;
  onUpdateStatus: (o: OrderRow, s: OrderStatus) => void;
  onAwardStamp: (o: OrderRow) => void;
}) {
  if (orders.length === 0) {
    return <p className="text-sm text-white/75 py-4">لا توجد طلبات مطابقة.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-right text-sm border-collapse min-w-[920px]">
        <thead>
          <tr className="border-b border-white/15 text-xs text-white/75">
            <th className="py-3 px-3">رقم الطلب / الوقت</th>
            <th className="py-3 px-3">الزبون</th>
            <th className="py-3 px-3">المنتجات والكميات</th>
            <th className="py-3 px-3">التوصيل والدفع</th>
            <th className="py-3 px-3">المجموع</th>
            <th className="py-3 px-3">الحالة</th>
            <th className="py-3 px-3">إجراءات</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {orders.map((order) => {
            const meta = extractOrderMeta(order);
            const stamped = hasOrderStamp(order.id, loyaltyLogs);
            const isBusy = busyOrderId === order.id;

            return (
              <tr key={order.id} className="align-top">
                <td className="py-3 px-3 tabular-nums-en">
                  <div className="font-semibold text-white">#{order.id.slice(0, 8)}</div>
                  <div className="text-xs text-white/70">
                    {getBaghdadDateKey(order.created_at)} • {getBaghdadTimeFormatted(order.created_at)}
                  </div>
                </td>
                <td className="py-3 px-3">
                  <div className="font-medium text-white">{order.customer_name}</div>
                  <div className="text-xs text-white/75 tabular-nums-en" dir="ltr">
                    {order.customer_phone}
                  </div>
                </td>
                <td className="py-3 px-3 text-xs text-white/85 max-w-xs">
                  {formatOrderDetailsText(order.order_details)}
                </td>
                <td className="py-3 px-3 text-xs text-white/75">
                  <div>{meta.deliveryAddress || '—'}</div>
                  <div>{meta.paymentMethod}</div>
                </td>
                <td className="py-3 px-3 font-bold text-white tabular-nums-en whitespace-nowrap">
                  {formatIqd(order.total_price_iqd)}
                </td>
                <td className="py-3 px-3 whitespace-nowrap">
                  <select
                    value={order.status === 'completed' ? 'delivered' : order.status}
                    disabled={isBusy}
                    onChange={(e) => onUpdateStatus(order, e.target.value as OrderStatus)}
                    className="px-2.5 py-1.5 rounded-lg bg-[#0E0A0C] border border-white/25 text-xs text-white"
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-3 px-3">
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => onOpenDetail(order)}
                      className="px-2.5 py-1.5 rounded-lg bg-[#0E0A0C] border border-white/25 text-xs text-white hover:bg-black cursor-pointer"
                    >
                      عرض
                    </button>
                    {isQualifyingCompletedStatus(order.status) && !stamped && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onAwardStamp(order)}
                        className="px-2.5 py-1.5 rounded-lg bg-[#5E1D2F] border border-[#F48FB1] text-xs text-white cursor-pointer"
                      >
                        + ختم
                      </button>
                    )}
                    {stamped && (
                      <span className="px-2 py-1.5 text-[11px] text-[#F48FB1]">مختوم ✓</span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
