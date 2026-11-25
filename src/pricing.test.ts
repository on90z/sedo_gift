import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateBouquetTotal,
  calculateHaversineDistanceMeters,
  clampFlowerCount,
  computeCustomerSummaries,
  computeDailyOrderStats,
  DEFAULT_SHOP_LAT,
  DEFAULT_SHOP_LNG,
  extractCoordsFromMapsUrl,
  extractOrderBreakdown,
  formatIqd,
  formatOrderDetailsText,
  formatWhatsAppUrl,
  getBaghdadDateKey,
  getLoyaltyProgress,
  hasOrderStamp,
  isQualifyingCompletedStatus,
  nextStampCount,
  normalizePhone,
  parseStorePhoneList,
  PROMO_COOLDOWN_MS,
  resolveInstagramUrl,
  resolveShopCoordinates,
  shouldTriggerProximityPromo,
  validateProductImageFile,
} from './pricing.ts';

test('calculateBouquetTotal multiplies stems and adds wrapping + optional gift', () => {
  assert.equal(
    calculateBouquetTotal({
      flowerPriceIqd: 3000,
      flowerCount: 11,
      wrappingPriceIqd: 5000,
      giftPriceIqd: 7000,
    }),
    45000
  );
});

test('clampFlowerCount stays between 1 and available stock/100', () => {
  assert.equal(clampFlowerCount(0, 50), 1);
  assert.equal(clampFlowerCount(25, 15), 15);
  assert.equal(clampFlowerCount(200, null), 100);
});

test('normalizePhone and formatWhatsAppUrl handle official SEDO Iraqi numbers cleanly', () => {
  assert.equal(normalizePhone('٠٧٧٦ ٢٩٦ ٣٦٧٤'), '07762963674');
  assert.equal(formatWhatsAppUrl('07762963674'), 'https://wa.me/9647762963674');
  assert.equal(formatWhatsAppUrl('07733484176'), 'https://wa.me/9647733484176');
});

test('parseStorePhoneList and resolveInstagramUrl return official defaults when placeholder exists', () => {
  assert.deepEqual(parseStorePhoneList('07700000000'), ['07762963674', '07733484176']);
  assert.deepEqual(parseStorePhoneList('07762963674, 07733484176'), [
    '07762963674',
    '07733484176',
  ]);
  assert.equal(resolveInstagramUrl('https://instagram.com'), 'https://www.instagram.com/sedo.gift/');
});

test('Asia/Baghdad daily grouping and daily statistics calculate accurately', () => {
  // 2026-11-24 22:30 UTC is 2026-11-25 01:30 in Asia/Baghdad (+03:00)
  assert.equal(getBaghdadDateKey('2026-11-24T22:30:00Z'), '2026-11-25');
  assert.equal(getBaghdadDateKey('2026-11-24T20:59:00Z'), '2026-11-24');

  const orders = [
    {
      id: 'o1',
      created_at: '2026-11-24T10:00:00Z',
      status: 'pending',
      total_price_iqd: 25000,
      customer_id: 'c1',
      customer_name: 'أحمد',
      customer_phone: '07762963674',
      customer_birth_date: null,
      order_details: null,
    },
    {
      id: 'o2',
      created_at: '2026-11-24T12:00:00Z',
      status: 'delivered',
      total_price_iqd: 45000,
      customer_id: 'c1',
      customer_name: 'أحمد',
      customer_phone: '07762963674',
      customer_birth_date: null,
      order_details: null,
    },
    {
      id: 'o3',
      created_at: '2026-11-24T22:30:00Z', // Next day in Baghdad
      status: 'delivered',
      total_price_iqd: 30000,
      customer_id: 'c1',
      customer_name: 'أحمد',
      customer_phone: '07762963674',
      customer_birth_date: null,
      order_details: null,
    },
  ];

  const stats = computeDailyOrderStats(orders, '2026-11-24');
  assert.equal(stats.total, 2);
  assert.equal(stats.pending, 1);
  assert.equal(stats.delivered, 1);
  assert.equal(stats.deliveredSalesIqd, 45000);
});

test('Loyalty rules enforce 9 qualifying completed purchases + duplicate prevention', () => {
  assert.equal(isQualifyingCompletedStatus('pending'), false);
  assert.equal(isQualifyingCompletedStatus('cancelled'), false);
  assert.equal(isQualifyingCompletedStatus('preparing'), false);
  assert.equal(isQualifyingCompletedStatus('delivered'), true);
  assert.equal(isQualifyingCompletedStatus('completed'), true);

  assert.deepEqual(getLoyaltyProgress(8, 9), {
    currentStamps: 8,
    requiredPurchases: 9,
    remainingUntilReward: 1,
    isRewardEligible: false,
  });
  assert.deepEqual(getLoyaltyProgress(9, 9), {
    currentStamps: 9,
    requiredPurchases: 9,
    remainingUntilReward: 0,
    isRewardEligible: true,
  });

  assert.equal(
    hasOrderStamp('o2', [{ order_id: 'o2', action: 'qualifying_purchase_stamp' }]),
    true
  );
  assert.equal(hasOrderStamp('o3', [{ order_id: 'o2', action: 'add_stamp' }]), false);
});

test('computeCustomerSummaries aggregates real order metrics accurately without inventing missing data', () => {
  const summaries = computeCustomerSummaries(
    [
      {
        id: 'c1',
        full_name: 'زهراء علي',
        phone: '07762963674',
        birth_date: null,
        stamps_count: 3,
        total_orders: 2,
      },
    ],
    [
      {
        id: 'o1',
        created_at: '2026-11-20T10:00:00Z',
        status: 'delivered',
        total_price_iqd: 50000,
        customer_id: 'c1',
        customer_name: 'زهراء علي',
        customer_phone: '07762963674',
        customer_birth_date: null,
        delivery_address: 'حي الحسين',
        city: 'كربلاء',
        order_details: null,
      },
      {
        id: 'o2',
        created_at: '2026-11-22T10:00:00Z',
        status: 'cancelled',
        total_price_iqd: 35000,
        customer_id: 'c1',
        customer_name: 'زهراء علي',
        customer_phone: '07762963674',
        customer_birth_date: null,
        order_details: null,
      },
    ],
    []
  );

  assert.equal(summaries[0].completedCount, 1);
  assert.equal(summaries[0].cancelledCount, 1);
  assert.equal(summaries[0].totalSpendingIqd, 50000);
  assert.equal(summaries[0].deliveryAddress, 'حي الحسين');
  assert.equal(summaries[0].nearestLandmark, null);
});

test('validateProductImageFile enforces allowed formats and max 5MB size', () => {
  assert.equal(validateProductImageFile({ type: 'image/webp', size: 1024 * 500 }).valid, true);
  assert.equal(validateProductImageFile({ type: 'application/pdf', size: 1024 }).valid, false);
  assert.equal(
    validateProductImageFile({ type: 'image/jpeg', size: 6 * 1024 * 1024 }).valid,
    false
  );
});

test('formatIqd, nextStampCount, extractCoordsFromMapsUrl, and formatOrderDetailsText work cleanly', () => {
  assert.equal(formatIqd(45000), '45,000 د.ع');
  assert.equal(nextStampCount(9, 10), 10);
  assert.deepEqual(extractCoordsFromMapsUrl('https://maps.google.com/?q=32.615,44.032'), {
    lat: 32.615,
    lng: 44.032,
  });
  assert.ok(
    formatOrderDetailsText({
      flower_name: 'ورد أحمر طبيعي',
      flower_count: 15,
    }).includes('ورد أحمر طبيعي × 15')
  );
});

test('Haversine distance and 12-hour geofencing promo trigger rules work accurately', () => {
  assert.equal(
    Math.round(
      calculateHaversineDistanceMeters(
        DEFAULT_SHOP_LAT,
        DEFAULT_SHOP_LNG,
        DEFAULT_SHOP_LAT,
        DEFAULT_SHOP_LNG
      )
    ),
    0
  );

  // ~555 meters north in Karbala
  const nearbyMeters = calculateHaversineDistanceMeters(32.6077, 44.0197, 32.6027, 44.0197);
  assert.ok(nearbyMeters > 500 && nearbyMeters < 650);

  // ~3.3 km away
  const farMeters = calculateHaversineDistanceMeters(32.6327, 44.0197, 32.6027, 44.0197);
  assert.ok(farMeters > 3000);

  const now = 1_700_000_000_000;
  assert.equal(
    shouldTriggerProximityPromo({
      distanceMeters: 450,
      radiusMeters: 1000,
      lastNotifiedAtMs: null,
      nowMs: now,
    }),
    true
  );

  // Inside 12h cooldown -> blocked
  assert.equal(
    shouldTriggerProximityPromo({
      distanceMeters: 450,
      radiusMeters: 1000,
      lastNotifiedAtMs: now - (PROMO_COOLDOWN_MS - 60_000),
      nowMs: now,
    }),
    false
  );

  // Past 12h cooldown -> allowed
  assert.equal(
    shouldTriggerProximityPromo({
      distanceMeters: 450,
      radiusMeters: 1000,
      lastNotifiedAtMs: now - (PROMO_COOLDOWN_MS + 1000),
      nowMs: now,
    }),
    true
  );

  // Outside radius -> blocked
  assert.equal(
    shouldTriggerProximityPromo({
      distanceMeters: 1200,
      radiusMeters: 1000,
      lastNotifiedAtMs: null,
      nowMs: now,
    }),
    false
  );

  assert.deepEqual(
    resolveShopCoordinates({
      shop_lat: 32.6111,
      shop_lng: 44.0222,
      google_maps_url: 'https://maps.google.com/?q=32.6027,44.0197',
    }),
    { lat: 32.6111, lng: 44.0222 }
  );
});

test('Daily reset zeroes prior orders of the same Baghdad day without affecting new orders or next day', () => {
  const orders = [
    {
      id: 'old-1',
      created_at: '2026-11-25T08:00:00Z',
      status: 'delivered',
      total_price_iqd: 40000,
      customer_id: 'c1',
      customer_name: 'علي',
      customer_phone: '07762963674',
      customer_birth_date: null,
      order_details: null,
    },
    {
      id: 'old-2',
      created_at: '2026-11-25T11:30:00Z',
      status: 'pending',
      total_price_iqd: 25000,
      customer_id: 'c2',
      customer_name: 'مريم',
      customer_phone: '07733484176',
      customer_birth_date: null,
      order_details: null,
    },
    {
      id: 'new-3',
      created_at: '2026-11-25T13:15:00Z',
      status: 'delivered',
      total_price_iqd: 55000,
      customer_id: 'c3',
      customer_name: 'نور',
      customer_phone: '07762963674',
      customer_birth_date: null,
      order_details: null,
    },
  ];

  // Reset performed at 12:00Z (between old-2 and new-3)
  const afterResetBeforeNew = computeDailyOrderStats(
    orders.slice(0, 2),
    '2026-11-25',
    '2026-11-25T12:00:00Z'
  );
  assert.equal(afterResetBeforeNew.total, 0);
  assert.equal(afterResetBeforeNew.pending, 0);
  assert.equal(afterResetBeforeNew.delivered, 0);
  assert.equal(afterResetBeforeNew.deliveredSalesIqd, 0);

  // New order created after reset IS counted normally
  const afterNewOrder = computeDailyOrderStats(
    orders,
    '2026-11-25',
    '2026-11-25T12:00:00Z'
  );
  assert.equal(afterNewOrder.total, 1);
  assert.equal(afterNewOrder.delivered, 1);
  assert.equal(afterNewOrder.deliveredSalesIqd, 55000);

  // Reset from a previous Baghdad day does NOT suppress all orders on a different day
  const previousDayReset = computeDailyOrderStats(
    orders,
    '2026-11-25',
    '2026-11-24T18:00:00Z'
  );
  assert.equal(previousDayReset.total, 3);
});

test('extractOrderBreakdown produces structured items, options, and totals in IQD', () => {
  const breakdown = extractOrderBreakdown({
    id: 'ord-1',
    created_at: '2026-11-25T10:00:00Z',
    status: 'confirmed',
    total_price_iqd: 45000,
    customer_id: 'c1',
    customer_name: 'سارة',
    customer_phone: '07762963674',
    customer_birth_date: null,
    order_details: {
      flower_id: 'f1',
      flower_name: 'ورد أحمر طبيعي',
      flower_unit_price_iqd: 3000,
      flower_count: 11,
      flower_color: 'أحمر',
      bouquet_shape: 'كلاسيكية دائرية',
      wrapping_id: 'w1',
      wrapping_name: 'تغليف فاخر مطفي',
      wrapping_price_iqd: 5000,
      gift_id: 'g1',
      gift_name: 'بوكس شوكولاتة صغير',
      gift_price_iqd: 7000,
    },
  });

  assert.equal(breakdown.items.length, 3);
  assert.equal(breakdown.items[0].subtotalIqd, 33000);
  assert.equal(breakdown.productsSubtotalIqd, 45000);
  assert.equal(breakdown.finalTotalIqd, 45000);
  assert.equal(breakdown.flowerColor, 'أحمر');
  assert.equal(breakdown.bouquetShape, 'كلاسيكية دائرية');
});
