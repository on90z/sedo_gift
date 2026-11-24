import type { CustomerRow, LoyaltyLogRow, OrderRow } from './types.ts';

export interface BouquetPriceInput {
  flowerPriceIqd: number;
  flowerCount: number;
  wrappingPriceIqd: number;
  giftPriceIqd: number;
}

export interface BouquetOrderDetails {
  flower_id: string | null;
  flower_name: string;
  flower_unit_price_iqd: number;
  flower_count: number;
  flower_color: string;
  bouquet_shape: string;
  wrapping_id: string | null;
  wrapping_name: string;
  wrapping_price_iqd: number;
  gift_id: string | null;
  gift_name: string | null;
  gift_price_iqd: number;
  delivery_address?: string | null;
  city?: string | null;
  nearest_landmark?: string | null;
  notes?: string | null;
  payment_method?: 'cash_on_delivery';
}

export interface DailyOrderStats {
  total: number;
  pending: number;
  confirmed: number;
  preparing: number;
  outForDelivery: number;
  delivered: number;
  cancelled: number;
  deliveredSalesIqd: number;
}

export interface CustomerSummary {
  customer: CustomerRow;
  orders: OrderRow[];
  loyaltyLogs: LoyaltyLogRow[];
  totalOrdersCount: number;
  completedCount: number;
  cancelledCount: number;
  totalSpendingIqd: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  deliveryAddress: string | null;
  city: string | null;
  nearestLandmark: string | null;
  latestNotes: string | null;
  remainingToReward: number;
  isRewardEligible: boolean;
}

export const OFFICIAL_PHONE_PRIMARY = '07762963674';
export const OFFICIAL_PHONE_SECONDARY = '07733484176';
export const OFFICIAL_INSTAGRAM_URL = 'https://www.instagram.com/sedo.gift/';

const ARABIC_INDIC_MAP: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};

export function toEnglishDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (ch) => ARABIC_INDIC_MAP[ch] ?? ch);
}

export function normalizePhone(rawPhone: string): string {
  const english = toEnglishDigits(rawPhone).trim();
  const digits = english.replace(/[^\d+]/g, '');
  if (digits.startsWith('+964')) {
    return `0${digits.slice(4)}`;
  }
  if (digits.startsWith('00964')) {
    return `0${digits.slice(5)}`;
  }
  if (digits.startsWith('964') && digits.length >= 12) {
    return `0${digits.slice(3)}`;
  }
  return digits.replace(/\+/g, '');
}

export function formatWhatsAppUrl(rawPhone: string): string {
  const normalized = normalizePhone(rawPhone);
  if (normalized.startsWith('0') && normalized.length >= 10) {
    return `https://wa.me/964${normalized.slice(1)}`;
  }
  if (normalized.startsWith('964')) {
    return `https://wa.me/${normalized}`;
  }
  return `https://wa.me/964${normalized}`;
}

export function parseStorePhoneList(
  raw: string | null | undefined,
  fallback: string[] = [OFFICIAL_PHONE_PRIMARY, OFFICIAL_PHONE_SECONDARY]
): string[] {
  if (!raw) return fallback;
  const cleaned = raw
    .split(/[,،/\n]+/)
    .map((p) => normalizePhone(p))
    .filter((p) => p.length >= 9 && p !== '07700000000');
  return cleaned.length > 0 ? Array.from(new Set(cleaned)) : fallback;
}

export function resolveInstagramUrl(raw: string | null | undefined): string {
  if (!raw || raw.trim() === 'https://instagram.com' || raw.trim() === 'https://instagram.com/') {
    return OFFICIAL_INSTAGRAM_URL;
  }
  return raw.trim();
}

export function clampFlowerCount(count: number, maxStock?: number | null): number {
  if (!Number.isFinite(count)) return 1;
  const floored = Math.floor(count);
  const minClamped = Math.max(1, floored);
  const upperBound =
    typeof maxStock === 'number' && maxStock > 0 ? Math.min(100, maxStock) : 100;
  return Math.min(minClamped, upperBound);
}

export function calculateBouquetTotal(input: BouquetPriceInput): number {
  const unitPrice = Math.max(0, Number(input.flowerPriceIqd) || 0);
  const count = clampFlowerCount(input.flowerCount);
  const wrapping = Math.max(0, Number(input.wrappingPriceIqd) || 0);
  const gift = Math.max(0, Number(input.giftPriceIqd) || 0);
  return Math.round(unitPrice * count + wrapping + gift);
}

export function formatIqd(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `${new Intl.NumberFormat('en-US').format(safe)} د.ع`;
}

export function nextStampCount(currentStamps: number, maxStamps = 10): number {
  const safe = Math.max(0, Math.floor(Number(currentStamps) || 0));
  if (safe >= maxStamps) return maxStamps;
  return safe + 1;
}

export function isQualifyingCompletedStatus(status: string | null | undefined): boolean {
  return status === 'delivered' || status === 'completed';
}

export function getLoyaltyProgress(
  stampsCount: number,
  requiredPurchases = 9
): {
  currentStamps: number;
  requiredPurchases: number;
  remainingUntilReward: number;
  isRewardEligible: boolean;
} {
  const currentStamps = Math.max(0, Math.floor(Number(stampsCount) || 0));
  const req = Math.max(1, Math.floor(Number(requiredPurchases) || 9));
  const remainingUntilReward = Math.max(0, req - currentStamps);
  return {
    currentStamps,
    requiredPurchases: req,
    remainingUntilReward,
    isRewardEligible: currentStamps >= req,
  };
}

export function hasOrderStamp(
  orderId: string,
  logs: Pick<LoyaltyLogRow, 'order_id' | 'action'>[]
): boolean {
  return logs.some(
    (log) =>
      log.order_id === orderId &&
      (log.action === 'add_stamp' || log.action === 'qualifying_purchase_stamp')
  );
}

export function getBaghdadDateKey(input: string | Date = new Date()): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function getBaghdadTimeFormatted(input: string | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Baghdad',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function computeDailyOrderStats(
  orders: OrderRow[],
  baghdadDateKey: string
): DailyOrderStats {
  const stats: DailyOrderStats = {
    total: 0,
    pending: 0,
    confirmed: 0,
    preparing: 0,
    outForDelivery: 0,
    delivered: 0,
    cancelled: 0,
    deliveredSalesIqd: 0,
  };

  for (const order of orders) {
    if (getBaghdadDateKey(order.created_at) !== baghdadDateKey) continue;
    stats.total += 1;
    switch (order.status) {
      case 'pending':
        stats.pending += 1;
        break;
      case 'confirmed':
        stats.confirmed += 1;
        break;
      case 'preparing':
        stats.preparing += 1;
        break;
      case 'out_for_delivery':
        stats.outForDelivery += 1;
        break;
      case 'delivered':
      case 'completed':
        stats.delivered += 1;
        stats.deliveredSalesIqd += Number(order.total_price_iqd) || 0;
        break;
      case 'cancelled':
        stats.cancelled += 1;
        break;
    }
  }

  return stats;
}

export function extractOrderMeta(order: OrderRow): {
  deliveryAddress: string | null;
  city: string | null;
  nearestLandmark: string | null;
  notes: string | null;
  paymentMethod: string;
} {
  const details =
    order.order_details && typeof order.order_details === 'object'
      ? (order.order_details as Partial<BouquetOrderDetails>)
      : null;

  return {
    deliveryAddress: order.delivery_address || details?.delivery_address || null,
    city: order.city || details?.city || null,
    nearestLandmark: order.nearest_landmark || details?.nearest_landmark || null,
    notes: order.notes || details?.notes || null,
    paymentMethod: 'الدفع عند الاستلام',
  };
}

export function computeCustomerSummaries(
  customers: CustomerRow[],
  orders: OrderRow[],
  loyaltyLogs: LoyaltyLogRow[],
  requiredPurchases = 9
): CustomerSummary[] {
  return customers.map((customer) => {
    const normalizedCustPhone = normalizePhone(customer.phone);
    const customerOrders = orders
      .filter(
        (o) =>
          o.customer_id === customer.id ||
          normalizePhone(o.customer_phone) === normalizedCustPhone
      )
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const customerLogs = loyaltyLogs
      .filter((l) => l.customer_id === customer.id)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    let completedCount = 0;
    let cancelledCount = 0;
    let totalSpendingIqd = 0;
    let deliveryAddress = customer.address ?? null;
    let city = customer.city ?? null;
    let nearestLandmark = customer.nearest_landmark ?? null;
    let latestNotes = customer.notes ?? null;

    for (const o of customerOrders) {
      if (isQualifyingCompletedStatus(o.status)) {
        completedCount += 1;
        totalSpendingIqd += Number(o.total_price_iqd) || 0;
      } else if (o.status === 'cancelled') {
        cancelledCount += 1;
      }
      const meta = extractOrderMeta(o);
      if (!deliveryAddress && meta.deliveryAddress) deliveryAddress = meta.deliveryAddress;
      if (!city && meta.city) city = meta.city;
      if (!nearestLandmark && meta.nearestLandmark) nearestLandmark = meta.nearestLandmark;
      if (!latestNotes && meta.notes) latestNotes = meta.notes;
    }

    const firstOrderAt =
      customerOrders.length > 0
        ? customerOrders[customerOrders.length - 1].created_at
        : customer.created_at ?? null;
    const lastOrderAt = customerOrders.length > 0 ? customerOrders[0].created_at : null;
    const progress = getLoyaltyProgress(customer.stamps_count ?? 0, requiredPurchases);

    return {
      customer,
      orders: customerOrders,
      loyaltyLogs: customerLogs,
      totalOrdersCount: Math.max(customerOrders.length, customer.total_orders ?? 0),
      completedCount,
      cancelledCount,
      totalSpendingIqd,
      firstOrderAt,
      lastOrderAt,
      deliveryAddress,
      city,
      nearestLandmark,
      latestNotes,
      remainingToReward: progress.remainingUntilReward,
      isRewardEligible: progress.isRewardEligible,
    };
  });
}

export function validateProductImageFile(file: {
  type: string;
  size: number;
}): { valid: boolean; error?: string } {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.type)) {
    return {
      valid: false,
      error: 'صيغة الصورة غير مدعومة. الصيغ المسموحة: JPG أو PNG أو WEBP أو GIF.',
    };
  }
  const maxBytes = 5 * 1024 * 1024;
  if (file.size <= 0 || file.size > maxBytes) {
    return {
      valid: false,
      error: 'حجم الصورة يجب ألا يتجاوز 5 ميجابايت.',
    };
  }
  return { valid: true };
}

export function extractCoordsFromMapsUrl(
  url: string | null | undefined,
  fallback = { lat: 32.6027, lng: 44.0197 }
): { lat: number; lng: number } {
  if (!url) return fallback;
  const match = url.match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
  if (!match) return fallback;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fallback;
  return { lat, lng };
}

export function formatOrderDetailsText(raw: unknown): string {
  if (!raw) return 'باقة مخصصة';
  if (typeof raw === 'string') return raw;
  if (typeof raw !== 'object') return 'باقة مخصصة';
  const d = raw as Partial<BouquetOrderDetails>;
  const parts: string[] = [];
  if (d.flower_name) {
    parts.push(`${d.flower_name}${d.flower_count ? ` × ${d.flower_count}` : ''}`);
  }
  if (d.flower_color) parts.push(`اللون: ${d.flower_color}`);
  if (d.bouquet_shape) parts.push(`الشكل: ${d.bouquet_shape}`);
  if (d.wrapping_name) parts.push(`التغليف: ${d.wrapping_name}`);
  if (d.gift_name) parts.push(`الهدية: ${d.gift_name}`);
  return parts.length > 0 ? parts.join(' • ') : 'باقة مخصصة';
}
