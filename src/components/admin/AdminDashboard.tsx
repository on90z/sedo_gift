import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award,
  Bell,
  Cake,
  Globe,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Package,
  Settings,
  Shield,
  ShoppingBag,
  Users,
} from 'lucide-react';
import type {
  AdminNotification,
  AdminPermission,
  AuditLogEntry,
  BirthdayCampaign,
  CustomerRecord,
  Language,
  LoyaltyCardRecord,
  LoyaltyTransaction,
  OptionItem,
  OrderRecord,
  OrderStatus,
  Product,
  StoreSettings,
} from '../../shared/types.ts';
import { apiUrl } from '../../lib/api.ts';
import { formatIqd } from '../../shared/pricing.ts';
import { STATUS_LABELS } from '../../i18n/translations.ts';
import { AdminAuthGate } from './AdminAuthGate.tsx';
import { AdminProductsPanel } from './AdminProductsPanel.tsx';
import { AdminSecurityPanel } from './AdminSecurityPanel.tsx';
import {
  AdminAuditLogsPanel,
  AdminCustomersAndBirthdaysPanel,
  AdminLoyaltyPanel,
  AdminNotificationsAndProximityPanel,
  AdminStoreAndMapsPanel,
} from './AdminOperationsPanels.tsx';

type AdminTab =
  | 'overview'
  | 'orders'
  | 'products'
  | 'loyalty'
  | 'customers'
  | 'notifications'
  | 'settings'
  | 'security'
  | 'audit';

interface AdminDashboardPayload {
  adminRole?: 'owner' | 'manager';
  permissions?: AdminPermission[];
  kpis: {
    totalOrders: number;
    todayOrders: number;
    totalSalesIqd: number;
    monthlySalesIqd: number;
    totalCustomers: number;
    activeLoyaltyCards: number;
    completedRewards: number;
    pendingOrders: number;
  };
  orders: OrderRecord[];
  products: Product[];
  options: OptionItem[];
  customers: CustomerRecord[];
  loyaltyCards: LoyaltyCardRecord[];
  loyaltyTransactions: LoyaltyTransaction[];
  notifications: AdminNotification[];
  birthdayCampaigns: BirthdayCampaign[];
  birthdayMatches: CustomerRecord[];
  auditLogs: AuditLogEntry[];
  settings: StoreSettings;
}

interface AdminDashboardProps {
  lang: Language;
  onToggleLang?: () => void;
  onCatalogUpdated: () => Promise<void>;
  onBackToStore: () => void;
}

const ORDER_STATUSES: OrderStatus[] = [
  'New',
  'Confirmed',
  'Preparing',
  'Ready',
  'Completed',
  'Cancelled',
];

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  lang,
  onToggleLang,
  onCatalogUpdated,
  onBackToStore,
}) => {
  // Keep admin Bearer token strictly in React memory (never localStorage)
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [adminUsername, setAdminUsername] = useState<string>('');
  const [adminRole, setAdminRole] = useState<'owner' | 'manager'>('owner');
  const [adminPermissions, setAdminPermissions] = useState<AdminPermission[]>([
    'orders',
    'products',
    'loyalty',
    'customers',
    'notifications',
  ]);
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [data, setData] = useState<AdminDashboardPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [liveAlert, setLiveAlert] = useState<AdminNotification | null>(null);

  const isAdminSubdomain =
    typeof window !== 'undefined' && window.location.hostname.toLowerCase().startsWith('admin.');

  // Order filters
  const [orderSearch, setOrderSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState('');

  const fetchDashboard = useCallback(async () => {
    if (!adminToken) return;
    setLoading(true);
    try {
      const resp = await fetch(apiUrl('/api/admin/dashboard'), {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (resp.status === 401 || resp.status === 403) {
        setAdminToken(null);
        setData(null);
        return;
      }
      if (resp.ok) {
        const json = (await resp.json()) as AdminDashboardPayload;
        setData(json);
        if (json.adminRole) {
          setAdminRole(json.adminRole);
        }
        if (Array.isArray(json.permissions)) {
          setAdminPermissions(json.permissions);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [adminToken]);

  const handleFullRefresh = useCallback(async () => {
    await fetchDashboard();
    await onCatalogUpdated();
  }, [fetchDashboard, onCatalogUpdated]);

  useEffect(() => {
    if (adminToken) {
      void fetchDashboard();
    }
  }, [adminToken, fetchDashboard]);

  // SSE Real-time new order stream
  useEffect(() => {
    if (!adminToken) return;
    const es = new EventSource(
      apiUrl(`/api/admin/events?token=${encodeURIComponent(adminToken)}`)
    );
    es.addEventListener('new_order', (evt) => {
      try {
        const parsed = JSON.parse((evt as MessageEvent).data) as {
          order: OrderRecord;
          notification: AdminNotification;
        };
        setLiveAlert(parsed.notification);
        setData((prev) =>
          prev
            ? {
                ...prev,
                orders: [parsed.order, ...prev.orders.filter((o) => o.id !== parsed.order.id)],
                notifications: [parsed.notification, ...prev.notifications],
                kpis: {
                  ...prev.kpis,
                  totalOrders: prev.kpis.totalOrders + 1,
                  todayOrders: prev.kpis.todayOrders + 1,
                  pendingOrders: prev.kpis.pendingOrders + 1,
                },
              }
            : prev
        );
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification(parsed.notification.titleEn, {
            body: parsed.notification.messageEn,
          });
        }
      } catch {
        // ignore malformed event
      }
    });
    return () => es.close();
  }, [adminToken]);

  const filteredOrders = useMemo(() => {
    if (!data) return [];
    const q = orderSearch.trim().toLowerCase();
    return data.orders.filter((o) => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      if (!q) return true;
      return (
        o.orderNumber.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        o.customerPhone.includes(q)
      );
    });
  }, [data, orderSearch, statusFilter]);

  const handleSignOut = useCallback(async () => {
    const tokenToRevoke = adminToken;
    setAdminToken(null);
    setData(null);
    setExpiresAt('');
    if (tokenToRevoke) {
      try {
        await fetch(apiUrl('/api/admin/logout'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenToRevoke}` },
        });
      } catch {
        // ignore network errors on sign out
      }
    }
  }, [adminToken]);

  // Automatic 30-minute idle session timeout
  useEffect(() => {
    if (!adminToken) return;
    let timer = window.setTimeout(() => {
      void handleSignOut();
    }, IDLE_TIMEOUT_MS);

    const resetTimer = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void handleSignOut();
      }, IDLE_TIMEOUT_MS);
    };

    window.addEventListener('mousemove', resetTimer);
    window.addEventListener('keydown', resetTimer);
    window.addEventListener('click', resetTimer);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('keydown', resetTimer);
      window.removeEventListener('click', resetTimer);
    };
  }, [adminToken, handleSignOut]);

  if (!adminToken) {
    return (
      <div className="relative">
        {onToggleLang && (
          <div className="fixed top-4 end-4 z-50">
            <button
              type="button"
              onClick={onToggleLang}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-[#461221] border border-[#944A5E] hover:border-white transition-colors"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{lang === 'ar' ? 'EN' : 'عربي'}</span>
            </button>
          </div>
        )}
        <AdminAuthGate
          lang={lang}
          showReturnToStore={!isAdminSubdomain}
          onAuthenticated={(token, username, role, exp, perms) => {
            setAdminToken(token);
            setAdminUsername(username);
            setAdminRole(role || 'owner');
            setAdminPermissions(
              perms || ['orders', 'products', 'loyalty', 'customers', 'notifications']
            );
            setExpiresAt(exp || '');
            setActiveTab('overview');
          }}
          onBackToStore={onBackToStore}
        />
      </div>
    );
  }

  const unreadCount = data?.notifications.filter((n) => !n.isRead).length ?? 0;

  const handleChangeOrderStatus = async (orderId: string, status: OrderStatus) => {
    setActionMsg('');
    const resp = await fetch(apiUrl(`/api/admin/orders/${orderId}/status`), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status }),
    });
    if (resp.ok) {
      await fetchDashboard();
      setActionMsg(lang === 'ar' ? 'تم تحديث حالة الطلب.' : 'Order status updated.');
    }
  };

  const handleQuickAwardStamp = async (orderId: string) => {
    setActionMsg('');
    const resp = await fetch(apiUrl('/api/admin/loyalty/award-stamp'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ orderId }),
    });
    const json = await resp.json();
    if (!resp.ok) {
      setActionMsg(json.error || 'Could not approve stamp');
      return;
    }
    await fetchDashboard();
    setActionMsg(
      lang === 'ar'
        ? `تم اعتماد ختم جديد للعميل (${json.card.stampsCount}/10)`
        : `Approved +1 stamp (${json.card.stampsCount}/10)`
    );
  };

  const hasPerm = (perm: AdminPermission) =>
    adminRole === 'owner' || adminPermissions.includes(perm);

  const allTabs: Array<{
    id: AdminTab;
    labelAr: string;
    labelEn: string;
    icon: React.ReactNode;
    ownerOnly?: boolean;
    requiredPermission?: AdminPermission;
  }> = [
    { id: 'overview', labelAr: 'نظرة عامة', labelEn: 'Overview', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'orders', labelAr: 'الطلبات', labelEn: 'Orders', icon: <ShoppingBag className="w-4 h-4" />, requiredPermission: 'orders' },
    { id: 'products', labelAr: 'المنتجات والأسعار', labelEn: 'Products & Prices', icon: <Package className="w-4 h-4" />, requiredPermission: 'products' },
    { id: 'loyalty', labelAr: 'الولاء والأختام', labelEn: 'Loyalty', icon: <Award className="w-4 h-4" />, requiredPermission: 'loyalty' },
    { id: 'customers', labelAr: 'العملاء والميلاد', labelEn: 'Customers & Birthdays', icon: <Users className="w-4 h-4" />, requiredPermission: 'customers' },
    { id: 'notifications', labelAr: 'الإشعارات والقرب', labelEn: 'Notifications', icon: <Bell className="w-4 h-4" />, requiredPermission: 'notifications' },
    { id: 'settings', labelAr: 'المتجر والخريطة و QR', labelEn: 'Store, Maps & QR', icon: <Settings className="w-4 h-4" />, ownerOnly: true },
    { id: 'security', labelAr: 'الأمان والصلاحيات', labelEn: 'Security & Access', icon: <KeyRound className="w-4 h-4" /> },
    { id: 'audit', labelAr: 'سجل التدقيق', labelEn: 'Audit Logs', icon: <Shield className="w-4 h-4" />, ownerOnly: true },
  ];
  const tabs = allTabs.filter(
    (t) =>
      (!t.ownerOnly || adminRole === 'owner') &&
      (!t.requiredPermission || hasPerm(t.requiredPermission))
  );

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 text-white">
      {/* Top Admin Header */}
      <div className="border-b border-[#944A5E] pb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-white/75">
            {lang === 'ar' ? 'لوحة إدارة متجر سيدو الخاصة' : 'SEDO Private Store Administration'}
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">
            {lang === 'ar' ? 'إدارة المتجر والطلبات' : 'Store & Order Operations'}
          </h1>
          <div className="text-xs text-white/70 mt-1 flex flex-wrap items-center gap-2" dir="ltr">
            <span>
              Signed in as: {adminUsername} ({adminRole.toUpperCase()})
            </span>
            {expiresAt && (
              <span className="text-white/55 tabular-nums-en">
                · Session expires {new Date(expiresAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {onToggleLang && (
            <button
              type="button"
              onClick={onToggleLang}
              className="inline-flex items-center gap-1.5 px-3 py-2 border border-[#944A5E] bg-[#6E2438] text-white text-xs font-medium hover:border-white transition-colors"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{lang === 'ar' ? 'EN' : 'عربي'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveTab('notifications')}
            className="inline-flex items-center gap-2 px-4 py-2 border border-[#944A5E] bg-[#6E2438] text-white text-xs font-medium hover:border-white transition-colors"
          >
            <Bell className="w-4 h-4 text-white" />
            <span>{lang === 'ar' ? 'الإشعارات' : 'Alerts'}</span>
            <span className="tabular-nums-en font-bold text-white">{unreadCount}</span>
          </button>

          {!isAdminSubdomain && (
            <button
              type="button"
              onClick={onBackToStore}
              className="px-4 py-2 border border-[#944A5E] bg-[#6E2438] text-white text-xs font-medium hover:border-white transition-colors"
            >
              {lang === 'ar' ? 'عرض المتجر العام' : 'Public Storefront'}
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0E0A0C] border border-[#944A5E] text-white text-xs font-medium hover:bg-[#1E1418] transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{lang === 'ar' ? 'خروج آمن' : 'Sign Out'}</span>
          </button>
        </div>
      </div>

      {/* Real-time Incoming Order Banner (triggered only by genuine SSE event) */}
      {liveAlert && (
        <div className="border border-white bg-[#0E0A0C] p-4 flex flex-wrap items-center justify-between gap-3 text-xs text-white">
          <div>
            <strong className="text-white">
              {lang === 'ar' ? liveAlert.titleAr : liveAlert.titleEn}
            </strong>
            <div className="text-white/80 mt-0.5">
              {lang === 'ar' ? liveAlert.messageAr : liveAlert.messageEn}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {liveAlert.orderId && (
              <button
                type="button"
                onClick={() => {
                  setSelectedOrderId(liveAlert.orderId || null);
                  setActiveTab('orders');
                  setLiveAlert(null);
                }}
                className="px-3.5 py-1.5 bg-[#5E1D2F] border border-[#944A5E] text-white font-medium hover:bg-[#6E2438]"
              >
                {lang === 'ar' ? 'فتح الطلب' : 'Inspect Order'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setLiveAlert(null)}
              className="px-3 py-1.5 border border-[#944A5E] bg-[#461221] text-white hover:border-white"
            >
              {lang === 'ar' ? 'إغلاق' : 'Dismiss'}
            </button>
          </div>
        </div>
      )}

      {/* Horizontal Tab Bar */}
      <nav aria-label="Admin sections" className="flex flex-wrap gap-2 border-b border-[#944A5E] pb-4">
        {tabs.map((t) => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-[#0E0A0C] text-white border-white'
                  : 'bg-[#6E2438] text-white border-[#944A5E] hover:border-white'
              }`}
            >
              {t.icon}
              <span>{lang === 'ar' ? t.labelAr : t.labelEn}</span>
            </button>
          );
        })}
      </nav>

      {actionMsg && (
        <div className="border border-[#944A5E] bg-[#0E0A0C] px-4 py-3 text-xs text-white">
          {actionMsg}
        </div>
      )}

      {loading && !data ? (
        <div className="py-12 text-center text-sm text-white/75">
          {lang === 'ar' ? 'جاري تحميل بيانات لوحة التحكم...' : 'Loading store dashboard...'}
        </div>
      ) : data ? (
        <div>
          {activeTab === 'overview' && (
            <div className="space-y-8">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  {
                    labelAr: 'إجمالي الطلبات',
                    labelEn: 'Total Orders',
                    value: String(data.kpis.totalOrders),
                  },
                  {
                    labelAr: 'طلبات اليوم',
                    labelEn: "Today's Orders",
                    value: String(data.kpis.todayOrders),
                  },
                  {
                    labelAr: 'إجمالي المبيعات',
                    labelEn: 'Total Sales',
                    value: formatIqd(data.kpis.totalSalesIqd, lang),
                  },
                  {
                    labelAr: 'مبيعات الشهر',
                    labelEn: 'Monthly Sales',
                    value: formatIqd(data.kpis.monthlySalesIqd, lang),
                  },
                  {
                    labelAr: 'العملاء المسجلون',
                    labelEn: 'Registered Customers',
                    value: String(data.kpis.totalCustomers),
                  },
                  {
                    labelAr: 'بطاقات الولاء النشطة',
                    labelEn: 'Active Loyalty Cards',
                    value: String(data.kpis.activeLoyaltyCards),
                  },
                  {
                    labelAr: 'مكافآت الـ 10 أختام المكتملة',
                    labelEn: 'Completed 10-Stamp Rewards',
                    value: String(data.kpis.completedRewards),
                  },
                  {
                    labelAr: 'طلبات قيد التنفيذ',
                    labelEn: 'Pending Orders',
                    value: String(data.kpis.pendingOrders),
                  },
                ].map((kpi) => (
                  <div key={kpi.labelEn} className="border border-[#944A5E] bg-[#6E2438] p-5 space-y-1.5">
                    <div className="text-xs text-white/75">
                      {lang === 'ar' ? kpi.labelAr : kpi.labelEn}
                    </div>
                    <div className="text-xl font-bold text-white tabular-nums-en">
                      {kpi.value}
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="border border-[#944A5E] bg-[#6E2438] p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-white">
                      {lang === 'ar' ? 'أحدث الطلبات' : 'Latest Orders'}
                    </h2>
                    <button
                      type="button"
                      onClick={() => setActiveTab('orders')}
                      className="text-xs text-white/80 hover:text-white hover:underline"
                    >
                      {lang === 'ar' ? 'عرض الكل' : 'View All'}
                    </button>
                  </div>
                  {data.orders.length === 0 ? (
                    <p className="text-xs text-white/70">
                      {lang === 'ar' ? 'لا توجد طلبات واردة بعد.' : 'No orders received yet.'}
                    </p>
                  ) : (
                    <div className="divide-y divide-[#944A5E]">
                      {data.orders.slice(0, 5).map((ord) => (
                        <button
                          key={ord.id}
                          type="button"
                          onClick={() => {
                            setSelectedOrderId(ord.id);
                            setActiveTab('orders');
                          }}
                          className="w-full py-2.5 px-1 text-start flex items-center justify-between gap-2 text-xs hover:bg-[#7C2C42] transition-colors"
                        >
                          <div>
                            <span className="font-bold text-white tabular-nums-en" dir="ltr">
                              {ord.orderNumber}
                            </span>{' '}
                            · <span className="text-white/90">{ord.customerName}</span>
                          </div>
                          <div className="tabular-nums-en font-semibold text-white">
                            {formatIqd(ord.totalIqd, lang)} · {STATUS_LABELS[ord.status][lang]}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border border-[#944A5E] bg-[#6E2438] p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-white flex items-center gap-2">
                      <Cake className="w-4 h-4 text-white/85" />
                      <span>{lang === 'ar' ? 'تنبيهات وأعياد ميلاد' : 'Notifications & Birthdays'}</span>
                    </h2>
                    <button
                      type="button"
                      onClick={() => setActiveTab('customers')}
                      className="text-xs text-white/80 hover:text-white hover:underline"
                    >
                      {lang === 'ar' ? 'إدارة' : 'Manage'}
                    </button>
                  </div>
                  <p className="text-xs text-white/80">
                    {lang === 'ar'
                      ? `أعياد ميلاد اليوم: ${data.birthdayMatches.length} · إشعارات غير مقروءة: ${unreadCount}`
                      : `Today's birthdays: ${data.birthdayMatches.length} · Unread notifications: ${unreadCount}`}
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'orders' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <input
                  type="search"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  placeholder={lang === 'ar' ? 'بحث برقم الطلب أو الاسم أو الهاتف...' : 'Search order #, name, or phone...'}
                  className="px-3.5 py-2 border border-[#944A5E] text-xs w-72 bg-[#461221] text-white placeholder:text-white/45 focus:outline-none focus:border-white"
                />
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setStatusFilter('all')}
                    className={`px-3 py-1.5 text-xs border transition-colors ${
                      statusFilter === 'all'
                        ? 'bg-[#0E0A0C] text-white border-white'
                        : 'bg-[#6E2438] text-white border-[#944A5E] hover:border-white'
                    }`}
                  >
                    {lang === 'ar' ? 'الكل' : 'All'}
                  </button>
                  {ORDER_STATUSES.map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStatusFilter(st)}
                      className={`px-3 py-1.5 text-xs border transition-colors ${
                        statusFilter === st
                          ? 'bg-[#0E0A0C] text-white border-white'
                          : 'bg-[#6E2438] text-white border-[#944A5E] hover:border-white'
                      }`}
                    >
                      {STATUS_LABELS[st][lang]}
                    </button>
                  ))}
                </div>
              </div>

              {filteredOrders.length === 0 ? (
                <div className="border border-[#944A5E] bg-[#6E2438] p-8 text-center text-xs text-white/75">
                  {lang === 'ar' ? 'لا توجد طلبات مطابقة.' : 'No matching orders found.'}
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredOrders.map((ord) => {
                    const isFocused = selectedOrderId === ord.id;
                    return (
                      <div
                        key={ord.id}
                        className={`border bg-[#6E2438] p-5 space-y-4 ${
                          isFocused ? 'border-white ring-1 ring-white' : 'border-[#944A5E]'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#944A5E] pb-3">
                          <div className="space-y-1">
                            <div className="text-base font-bold text-white tabular-nums-en" dir="ltr">
                              {ord.orderNumber}
                            </div>
                            <div className="text-xs text-white">
                              <strong>{ord.customerName}</strong> ·{' '}
                              <span className="tabular-nums-en" dir="ltr">
                                {ord.customerPhone}
                              </span>{' '}
                              · DOB:{' '}
                              <span className="tabular-nums-en" dir="ltr">
                                {ord.customerBirthDate}
                              </span>
                            </div>
                            <div className="text-xs text-white/75">
                              {ord.deliveryType === 'delivery'
                                ? `${lang === 'ar' ? 'توصيل:' : 'Delivery:'} ${ord.deliveryAddress}`
                                : lang === 'ar'
                                  ? 'استلام من متجر كربلاء'
                                  : 'Store Pickup (Karbala)'}
                              {ord.notes ? ` · ${ord.notes}` : ''}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <div className="text-base font-bold text-white tabular-nums-en me-2">
                              {formatIqd(ord.totalIqd, lang)}
                            </div>
                            <select
                              value={ord.status}
                              onChange={(e) =>
                                handleChangeOrderStatus(ord.id, e.target.value as OrderStatus)
                              }
                              aria-label={`Status for ${ord.orderNumber}`}
                              className="px-3 py-1.5 border border-[#944A5E] bg-[#461221] text-white font-medium"
                            >
                              {ORDER_STATUSES.map((st) => (
                                <option key={st} value={st}>
                                  {STATUS_LABELS[st][lang]}
                                </option>
                              ))}
                            </select>

                            {hasPerm('loyalty') && !ord.stampAwarded && ord.status === 'Completed' ? (
                              <button
                                type="button"
                                onClick={() => handleQuickAwardStamp(ord.id)}
                                className="px-3.5 py-1.5 bg-[#0E0A0C] border border-[#944A5E] text-white font-medium hover:bg-[#1E1418] transition-colors"
                              >
                                {lang === 'ar' ? 'منح ختم الولاء (+1)' : 'Approve +1 Stamp'}
                              </button>
                            ) : hasPerm('loyalty') && !ord.stampAwarded && ord.status !== 'Cancelled' ? (
                              <span className="text-white/65">
                                {lang === 'ar' ? 'أكمل الطلب لمنح الختم' : 'Complete order to award stamp'}
                              </span>
                            ) : ord.stampAwarded ? (
                              <span className="text-[#F8BBD0] font-semibold">
                                {lang === 'ar' ? '✓ تم منح الختم' : '✓ Stamp Awarded'}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        {/* Detailed Line Items (including Custom Bouquet Selections) */}
                        <div className="space-y-2 text-xs">
                          {ord.items.map((item) => (
                            <div key={item.id} className="bg-[#461221] p-3 border border-[#944A5E]/80 space-y-1">
                              <div className="flex justify-between font-semibold text-white">
                                <span>
                                  {lang === 'ar' ? item.titleAr : item.titleEn} × {item.quantity}
                                </span>
                                <span className="tabular-nums-en">{formatIqd(item.lineTotalIqd, lang)}</span>
                              </div>
                              {item.type === 'custom_bouquet' && (
                                <div className="text-white/80 space-y-0.5">
                                  <div>
                                    {item.details.roseQuantity} {lang === 'ar' ? 'وردة' : 'Roses'} ·{' '}
                                    {lang === 'ar'
                                      ? item.details.flowerTypeNameAr
                                      : item.details.flowerTypeNameEn}{' '}
                                    ·{' '}
                                    {(lang === 'ar'
                                      ? item.details.colorNamesAr
                                      : item.details.colorNamesEn
                                    )?.join(', ')}
                                  </div>
                                  <div>
                                    {lang === 'ar'
                                      ? item.details.wrappingNameAr
                                      : item.details.wrappingNameEn}{' '}
                                    ·{' '}
                                    {lang === 'ar'
                                      ? item.details.arrangementNameAr
                                      : item.details.arrangementNameEn}
                                  </div>
                                  {item.details.giftNamesEn && item.details.giftNamesEn.length > 0 && (
                                    <div>
                                      {lang === 'ar' ? 'هدايا:' : 'Gifts:'}{' '}
                                      {(lang === 'ar'
                                        ? item.details.giftNamesAr
                                        : item.details.giftNamesEn
                                      )?.join(', ')}
                                    </div>
                                  )}
                                  {item.details.cardMessage && (
                                    <div className="text-white">
                                      {lang === 'ar' ? 'رسالة البطاقة:' : 'Card:'} "{item.details.cardMessage}"
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'products' && (
            <AdminProductsPanel
              lang={lang}
              adminToken={adminToken}
              products={data.products}
              options={data.options}
              settings={data.settings}
              onRefresh={handleFullRefresh}
            />
          )}

          {activeTab === 'loyalty' && (
            <AdminLoyaltyPanel
              lang={lang}
              adminToken={adminToken}
              loyaltyCards={data.loyaltyCards}
              loyaltyTransactions={data.loyaltyTransactions}
              orders={data.orders}
              settings={data.settings}
              onRefresh={handleFullRefresh}
            />
          )}

          {activeTab === 'customers' && (
            <AdminCustomersAndBirthdaysPanel
              lang={lang}
              adminToken={adminToken}
              customers={data.customers}
              birthdayMatches={data.birthdayMatches}
              campaigns={data.birthdayCampaigns}
              onRefresh={handleFullRefresh}
            />
          )}

          {activeTab === 'notifications' && (
            <AdminNotificationsAndProximityPanel
              lang={lang}
              adminToken={adminToken}
              notifications={data.notifications}
              settings={data.settings}
              onRefresh={handleFullRefresh}
              onJumpToOrder={(orderId) => {
                setSelectedOrderId(orderId);
                setActiveTab('orders');
              }}
            />
          )}

          {activeTab === 'settings' && adminRole === 'owner' && (
            <AdminStoreAndMapsPanel
              lang={lang}
              adminToken={adminToken}
              settings={data.settings}
              products={data.products}
              options={data.options}
              onRefresh={handleFullRefresh}
            />
          )}

          {activeTab === 'security' && (
            <AdminSecurityPanel
              lang={lang}
              adminToken={adminToken}
              onTokenRotated={(tok, exp) => {
                setAdminToken(tok);
                if (exp) setExpiresAt(exp);
              }}
              onSignedOutAll={() => {
                setAdminToken(null);
                setData(null);
                setExpiresAt('');
              }}
            />
          )}

          {activeTab === 'audit' && adminRole === 'owner' && (
            <AdminAuditLogsPanel lang={lang} auditLogs={data.auditLogs} />
          )}
        </div>
      ) : null}
    </section>
  );
};
