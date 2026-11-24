import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateBouquetTotal,
  clampFlowerCount,
  computeCustomerSummaries,
  computeDailyOrderStats,
  extractCoordsFromMapsUrl,
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
  resolveInstagramUrl,
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
