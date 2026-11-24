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
}

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
