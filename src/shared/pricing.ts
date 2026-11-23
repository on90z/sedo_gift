import type {
  BouquetPriceBreakdown,
  CartItemInput,
  CustomBouquetSelection,
  OptionItem,
  Product,
  ValidatedOrderItem,
} from './types.ts';

export function formatIqd(amount: number, lang: 'ar' | 'en' = 'ar'): string {
  const formatted = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.round(amount)));
  return lang === 'ar' ? `${formatted} د.ع` : `${formatted} IQD`;
}

export function normalizeIraqiPhone(raw: string): string {
  const digitsOnly = raw.replace(/[\s\-()]/g, '');
  if (digitsOnly.startsWith('+964')) {
    return '0' + digitsOnly.slice(4);
  }
  if (digitsOnly.startsWith('00964')) {
    return '0' + digitsOnly.slice(5);
  }
  if (digitsOnly.startsWith('964') && digitsOnly.length >= 12) {
    return '0' + digitsOnly.slice(3);
  }
  return digitsOnly;
}

export function isValidIraqiPhone(raw: string): boolean {
  const normalized = normalizeIraqiPhone(raw);
  return /^07[3-9][0-9]{8}$/.test(normalized);
}

export function toTelHref(raw: string): string {
  const cleaned = raw.replace(/[^\d+]/g, '');
  return `tel:${cleaned}`;
}

export function toWhatsAppUrl(raw: string): string {
  const normalized = normalizeIraqiPhone(raw);
  if (/^07[0-9]{9}$/.test(normalized)) {
    return `https://wa.me/964${normalized.slice(1)}`;
  }
  const digits = raw.replace(/\D/g, '');
  return `https://wa.me/${digits}`;
}

export function getEffectiveProductPrice(product: Product): number {
  if (
    typeof product.promoPriceIqd === 'number' &&
    product.promoPriceIqd >= 0 &&
    product.promoPriceIqd < product.priceIqd
  ) {
    return product.promoPriceIqd;
  }
  return product.priceIqd;
}

export function calculateCustomBouquetPrice(
  selection: CustomBouquetSelection,
  options: OptionItem[],
  roseUnitPriceIqd: number,
  maxCustomRoses = 200
): BouquetPriceBreakdown {
  const qty = Math.floor(Number(selection.roseQuantity));
  if (!Number.isFinite(qty) || qty < 1 || qty > maxCustomRoses) {
    throw new Error(`Invalid rose quantity: must be between 1 and ${maxCustomRoses}`);
  }
  if (!Number.isFinite(roseUnitPriceIqd) || roseUnitPriceIqd < 0) {
    throw new Error('Invalid rose unit price');
  }

  const findAvailable = (id: string, group: OptionItem['group']): OptionItem => {
    const found = options.find((o) => o.id === id && o.group === group && o.isAvailable);
    if (!found) {
      throw new Error(`Unavailable or unknown ${group} option: ${id}`);
    }
    return found;
  };

  const flowerType = findAvailable(selection.flowerTypeId, 'flower_type');
  const wrapping = findAvailable(selection.wrappingId, 'wrapping');
  const arrangement = findAvailable(selection.arrangementId, 'arrangement');

  if (!Array.isArray(selection.colorIds) || selection.colorIds.length === 0) {
    throw new Error('At least one flower color must be selected');
  }
  for (const colorId of selection.colorIds) {
    findAvailable(colorId, 'flower_color');
  }

  const uniqueGiftIds = Array.from(new Set(selection.giftIds || []));
  let giftsSubtotalIqd = 0;
  for (const giftId of uniqueGiftIds) {
    const gift = findAvailable(giftId, 'gift');
    giftsSubtotalIqd += gift.priceIqd;
  }

  const rosesSubtotalIqd = qty * roseUnitPriceIqd;
  const flowerTypeSurchargeIqd = flowerType.priceIqd * qty;
  const wrappingPriceIqd = wrapping.priceIqd;
  const arrangementPriceIqd = arrangement.priceIqd;

  const totalIqd =
    rosesSubtotalIqd +
    flowerTypeSurchargeIqd +
    wrappingPriceIqd +
    arrangementPriceIqd +
    giftsSubtotalIqd;

  return {
    roseQuantity: qty,
    roseUnitPriceIqd,
    rosesSubtotalIqd,
    flowerTypeSurchargeIqd,
    wrappingPriceIqd,
    arrangementPriceIqd,
    giftsSubtotalIqd,
    totalIqd,
  };
}

export function validateAndPriceCartItems(
  inputs: CartItemInput[],
  products: Product[],
  options: OptionItem[],
  roseUnitPriceIqd: number,
  maxCustomRoses = 200,
  promoDiscountPercent = 0
): {
  items: ValidatedOrderItem[];
  subtotalIqd: number;
  discountIqd: number;
  totalIqd: number;
} {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error('Cart cannot be empty');
  }
  if (inputs.length > 30) {
    throw new Error('Too many distinct items in a single order');
  }

  const validatedItems: ValidatedOrderItem[] = [];
  let subtotalIqd = 0;

  inputs.forEach((input, idx) => {
    const qty = Math.floor(Number(input.quantity));
    if (!Number.isFinite(qty) || qty < 1 || qty > 50) {
      throw new Error('Invalid item quantity');
    }

    if (input.type === 'ready_made') {
      const product = products.find(
        (p) => p.id === input.productId && p.isAvailable && p.stock >= qty
      );
      if (!product) {
        throw new Error(`Product unavailable or insufficient stock: ${input.productId}`);
      }
      const unitPriceIqd = getEffectiveProductPrice(product);
      const lineTotalIqd = unitPriceIqd * qty;
      subtotalIqd += lineTotalIqd;

      validatedItems.push({
        id: `item_${idx + 1}`,
        type: 'ready_made',
        titleAr: product.nameAr,
        titleEn: product.nameEn,
        quantity: qty,
        unitPriceIqd,
        lineTotalIqd,
        details: {
          roseQuantity: product.roseCount,
        },
        imageUrl: product.imageUrl,
      });
    } else if (input.type === 'custom_bouquet' && input.customSelection) {
      const sel = input.customSelection;
      const breakdown = calculateCustomBouquetPrice(
        sel,
        options,
        roseUnitPriceIqd,
        maxCustomRoses
      );
      const flowerType = options.find((o) => o.id === sel.flowerTypeId)!;
      if (flowerType.stock < sel.roseQuantity * qty) {
        throw new Error(`Insufficient stock for ${flowerType.nameEn}`);
      }
      const colors = sel.colorIds.map((cid) => options.find((o) => o.id === cid)!);
      const wrapping = options.find((o) => o.id === sel.wrappingId)!;
      const arrangement = options.find((o) => o.id === sel.arrangementId)!;
      const gifts = Array.from(new Set(sel.giftIds || [])).map(
        (gid) => options.find((o) => o.id === gid)!
      );

      const unitPriceIqd = breakdown.totalIqd;
      const lineTotalIqd = unitPriceIqd * qty;
      subtotalIqd += lineTotalIqd;

      validatedItems.push({
        id: `item_${idx + 1}`,
        type: 'custom_bouquet',
        titleAr: `باقة مخصصة (${breakdown.roseQuantity} وردة)`,
        titleEn: `Custom Bouquet (${breakdown.roseQuantity} Roses)`,
        quantity: qty,
        unitPriceIqd,
        lineTotalIqd,
        details: {
          roseQuantity: breakdown.roseQuantity,
          flowerTypeNameAr: flowerType.nameAr,
          flowerTypeNameEn: flowerType.nameEn,
          colorNamesAr: colors.map((c) => c.nameAr),
          colorNamesEn: colors.map((c) => c.nameEn),
          wrappingNameAr: wrapping.nameAr,
          wrappingNameEn: wrapping.nameEn,
          arrangementNameAr: arrangement.nameAr,
          arrangementNameEn: arrangement.nameEn,
          giftNamesAr: gifts.map((g) => g.nameAr),
          giftNamesEn: gifts.map((g) => g.nameEn),
          cardMessage: sel.cardMessage ? sel.cardMessage.slice(0, 240) : undefined,
        },
        imageUrl: wrapping.imageUrl || flowerType.imageUrl,
      });
    } else {
      throw new Error('Invalid cart item type');
    }
  });

  const safeDiscountPercent = Math.min(Math.max(promoDiscountPercent, 0), 50);
  const discountIqd = Math.round((subtotalIqd * safeDiscountPercent) / 100);
  const totalIqd = Math.max(0, subtotalIqd - discountIqd);

  return {
    items: validatedItems,
    subtotalIqd,
    discountIqd,
    totalIqd,
  };
}

export function isBirthdayMatch(birthDateIso: string, now = new Date()): boolean {
  const parts = birthDateIso.split('-');
  if (parts.length !== 3) return false;
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!month || !day) return false;
  return now.getMonth() + 1 === month && now.getDate() === day;
}
