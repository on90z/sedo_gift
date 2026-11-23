import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCustomBouquetPrice,
  formatIqd,
  isBirthdayMatch,
  isValidIraqiPhone,
  normalizeIraqiPhone,
  toTelHref,
  toWhatsAppUrl,
  validateAndPriceCartItems,
} from './pricing.ts';
import { SEED_OPTIONS, SEED_PRODUCTS } from './seedCatalog.ts';

test('rose unit price 3,000 IQD calculates 7, 8, and 10 roses accurately', () => {
  const b7 = calculateCustomBouquetPrice(
    {
      roseQuantity: 7,
      flowerTypeId: 'ft_ecuador_rose',
      colorIds: ['fc_red'],
      wrappingId: 'wrap_premium_paper',
      arrangementId: 'arr_round',
      giftIds: [],
    },
    SEED_OPTIONS,
    3000
  );
  assert.equal(b7.rosesSubtotalIqd, 21000);
  assert.equal(b7.totalIqd, 24000); // 21,000 + 3,000 wrapping

  const b8 = calculateCustomBouquetPrice(
    {
      roseQuantity: 8,
      flowerTypeId: 'ft_ecuador_rose',
      colorIds: ['fc_red'],
      wrappingId: 'wrap_premium_paper',
      arrangementId: 'arr_round',
      giftIds: [],
    },
    SEED_OPTIONS,
    3000
  );
  assert.equal(b8.rosesSubtotalIqd, 24000);

  const b10 = calculateCustomBouquetPrice(
    {
      roseQuantity: 10,
      flowerTypeId: 'ft_ecuador_rose',
      colorIds: ['fc_red', 'fc_white'],
      wrappingId: 'wrap_korean',
      arrangementId: 'arr_luxury',
      giftIds: ['gift_chocolate'],
    },
    SEED_OPTIONS,
    3000
  );
  assert.equal(b10.rosesSubtotalIqd, 30000);
  assert.equal(b10.wrappingPriceIqd, 5000);
  assert.equal(b10.arrangementPriceIqd, 5000);
  assert.equal(b10.giftsSubtotalIqd, 15000);
  assert.equal(b10.totalIqd, 55000);
});

test('server pricing reflects admin-updated rose unit price and rejects tampering', () => {
  const updated = calculateCustomBouquetPrice(
    {
      roseQuantity: 10,
      flowerTypeId: 'ft_ecuador_rose',
      colorIds: ['fc_red'],
      wrappingId: 'wrap_korean',
      arrangementId: 'arr_round',
      giftIds: [],
    },
    SEED_OPTIONS,
    4000
  );
  assert.equal(updated.rosesSubtotalIqd, 40000);
  assert.equal(updated.totalIqd, 45000);

  assert.throws(() =>
    calculateCustomBouquetPrice(
      {
        roseQuantity: 0,
        flowerTypeId: 'ft_ecuador_rose',
        colorIds: ['fc_red'],
        wrappingId: 'wrap_korean',
        arrangementId: 'arr_round',
        giftIds: [],
      },
      SEED_OPTIONS,
      3000
    )
  );
});

test('cart validation applies promo discount securely and rejects unknown products', () => {
  const res = validateAndPriceCartItems(
    [
      { type: 'ready_made', productId: 'prod_velvet_15', quantity: 1 },
      {
        type: 'custom_bouquet',
        quantity: 1,
        customSelection: {
          roseQuantity: 10,
          flowerTypeId: 'ft_ecuador_rose',
          colorIds: ['fc_red'],
          wrappingId: 'wrap_korean',
          arrangementId: 'arr_round',
          giftIds: ['gift_card'],
        },
      },
    ],
    SEED_PRODUCTS,
    SEED_OPTIONS,
    3000,
    100,
    10
  );
  // 52,000 + (30,000 + 5,000 + 2,000) = 89,000; 10% discount = 8,900 -> 80,100
  assert.equal(res.subtotalIqd, 89000);
  assert.equal(res.discountIqd, 8900);
  assert.equal(res.totalIqd, 80100);

  assert.throws(() =>
    validateAndPriceCartItems(
      [{ type: 'ready_made', productId: 'non_existent', quantity: 1 }],
      SEED_PRODUCTS,
      SEED_OPTIONS,
      3000
    )
  );
});

test('Iraqi phone validation, birthday check, and English numeral formatting', () => {
  assert.equal(normalizeIraqiPhone('+964 770 123 4567'), '07701234567');
  assert.equal(isValidIraqiPhone('07801234567'), true);
  assert.equal(isValidIraqiPhone('12345'), false);
  assert.equal(formatIqd(21000, 'ar'), '21,000 د.ع');
  assert.equal(formatIqd(21000, 'en'), '21,000 IQD');
  assert.equal(isBirthdayMatch('1995-11-22', new Date(2026, 10, 22)), true);
  assert.equal(isBirthdayMatch('1995-11-23', new Date(2026, 10, 22)), false);
  assert.equal(toTelHref('07762963674'), 'tel:07762963674');
  assert.equal(toWhatsAppUrl('07762963674'), 'https://wa.me/9647762963674');
  assert.equal(toWhatsAppUrl('07733484176'), 'https://wa.me/9647733484176');
});

test('multi-line cart items enforce aggregate stock for ready-made products and custom rose varieties', () => {
  const limitedProduct = { ...SEED_PRODUCTS[0], id: 'prod_limited', stock: 3, isAvailable: true };
  assert.throws(
    () =>
      validateAndPriceCartItems(
        [
          { type: 'ready_made', productId: 'prod_limited', quantity: 2 },
          { type: 'ready_made', productId: 'prod_limited', quantity: 2 },
        ],
        [limitedProduct],
        SEED_OPTIONS,
        3000
      ),
    /insufficient stock/i
  );

  const limitedOptions = SEED_OPTIONS.map((o) =>
    o.id === 'ft_ecuador_rose' ? { ...o, stock: 12 } : o
  );
  assert.throws(
    () =>
      validateAndPriceCartItems(
        [
          {
            type: 'custom_bouquet',
            quantity: 1,
            customSelection: {
              roseQuantity: 7,
              flowerTypeId: 'ft_ecuador_rose',
              colorIds: ['fc_red'],
              wrappingId: 'wrap_korean',
              arrangementId: 'arr_round',
              giftIds: [],
            },
          },
          {
            type: 'custom_bouquet',
            quantity: 1,
            customSelection: {
              roseQuantity: 7,
              flowerTypeId: 'ft_ecuador_rose',
              colorIds: ['fc_red'],
              wrappingId: 'wrap_korean',
              arrangementId: 'arr_round',
              giftIds: [],
            },
          },
        ],
        SEED_PRODUCTS,
        limitedOptions,
        3000
      ),
    /insufficient stock/i
  );
});

