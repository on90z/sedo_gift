import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateBouquetTotal,
  clampFlowerCount,
  extractCoordsFromMapsUrl,
  formatIqd,
  formatOrderDetailsText,
  nextStampCount,
  normalizePhone,
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

  assert.equal(
    calculateBouquetTotal({
      flowerPriceIqd: 3500,
      flowerCount: 7,
      wrappingPriceIqd: 2000,
      giftPriceIqd: 0,
    }),
    26500
  );
});

test('clampFlowerCount stays between 1 and available stock/100', () => {
  assert.equal(clampFlowerCount(0, 50), 1);
  assert.equal(clampFlowerCount(-5, 50), 1);
  assert.equal(clampFlowerCount(25, 15), 15);
  assert.equal(clampFlowerCount(200, null), 100);
});

test('normalizePhone converts Arabic digits and Iraqi prefixes cleanly', () => {
  assert.equal(normalizePhone('٠٧٧٠ ١٢٣ ٤٥٦٧'), '07701234567');
  assert.equal(normalizePhone('+964 780 111 2233'), '07801112233');
  assert.equal(normalizePhone('009647719998877'), '07719998877');
});

test('formatIqd always formats using English digits and IQD suffix', () => {
  assert.equal(formatIqd(45000), '45,000 د.ع');
  assert.equal(formatIqd(0), '0 د.ع');
});

test('nextStampCount increments safely and caps at 10', () => {
  assert.equal(nextStampCount(0), 1);
  assert.equal(nextStampCount(9), 10);
  assert.equal(nextStampCount(10), 10);
});

test('extractCoordsFromMapsUrl extracts numeric coordinates or falls back to Karbala', () => {
  assert.deepEqual(
    extractCoordsFromMapsUrl('https://maps.google.com/?q=32.615,44.032'),
    { lat: 32.615, lng: 44.032 }
  );
  assert.deepEqual(
    extractCoordsFromMapsUrl('https://maps.google.com/?q=كربلاء+حي+الميلاد'),
    { lat: 32.6027, lng: 44.0197 }
  );
});

test('formatOrderDetailsText formats structured JSONB bouquet details in Arabic', () => {
  const formatted = formatOrderDetailsText({
    flower_name: 'ورد أحمر طبيعي',
    flower_count: 15,
    flower_color: 'أحمر',
    bouquet_shape: 'كلاسيكية دائرية',
    wrapping_name: 'تغليف فاخر مطفي',
    gift_name: 'بوكس شوكولاتة صغير',
  });
  assert.ok(formatted.includes('ورد أحمر طبيعي × 15'));
  assert.ok(formatted.includes('تغليف فاخر مطفي'));
  assert.ok(formatted.includes('بوكس شوكولاتة صغير'));
});
