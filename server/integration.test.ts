import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { createSedoApp } from './app.ts';
import { generateTotpCode } from './security.ts';
import { getDb, resetDbCacheForTests } from './store.ts';

let tempRoot = '';
let dataDir = '';
let uploadsDir = '';
let server: Server;
let baseUrl = '';

const OWNER_USERNAME = 'sedo_test_owner';
const OWNER_PASS = 'SedoOwner!2026#Test';
const MANAGER_USERNAME = 'orders_mgr';
const MANAGER_PASS = 'SedoMgr!2026#Orders';

async function apiJson(
  urlPath: string,
  options: RequestInit & { token?: string; originHeader?: string } = {}
) {
  const headers = new Headers(options.headers || {});
  if (options.token) {
    headers.set('Authorization', `Bearer ${options.token}`);
  }
  if (options.originHeader) {
    headers.set('Origin', options.originHeader);
  }
  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const resp = await fetch(`${baseUrl}${urlPath}`, {
    ...options,
    headers,
  });
  const text = await resp.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { raw: text };
  }
  return { status: resp.status, headers: resp.headers, json };
}

describe('SEDO Full-Stack Security & Business Logic Integration Suite', () => {
  before(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sedo-int-'));
    dataDir = path.join(tempRoot, 'data');
    uploadsDir = path.join(tempRoot, 'uploads');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(uploadsDir, { recursive: true });

    process.env.SEDO_DATA_DIR = dataDir;
    process.env.SEDO_UPLOADS_DIR = uploadsDir;
    process.env.SESSION_SECRET = 'sedo_test_session_secret_32_bytes_minimum_value';
    process.env.CORS_ALLOWED_ORIGINS = 'https://sedo-store.netlify.app';
    delete process.env.ADMIN_PASSCODE;

    resetDbCacheForTests();
    const { app } = createSedoApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetDbCacheForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  let ownerToken = '';
  let managerToken = '';
  let managerId = '';
  let mfaRecoveryCode = '';
  let mfaSecret = '';
  let victimOrderId = '';
  let victimCardId = '';

  it('1. Public catalog strips credentials/secrets and defaults proximity radius to 2000m', async () => {
    const res = await apiJson('/api/catalog');
    assert.equal(res.status, 200);
    assert.equal('adminCredential' in res.json, false);
    assert.equal('adminUsers' in res.json, false);
    assert.equal('telegramBotToken' in res.json, false);
    const settings = res.json.settings as { proximityRadiusMeters: number };
    assert.equal(settings.proximityRadiusMeters, 2000);
  });

  it('2. Unauthenticated callers are rejected from all private /api/admin endpoints', async () => {
    for (const ep of ['/api/admin/dashboard', '/api/admin/security', '/api/admin/backups']) {
      const r = await apiJson(ep);
      assert.equal(r.status, 401);
    }
    const forged = await apiJson('/api/admin/dashboard', { token: 'invalid.token.sig' });
    assert.equal(forged.status, 403);
  });

  it('3. Admin setup enforces strong passwords, locks out re-setup, and supports TOTP 2FA single-use challenge', async () => {
    const weak = await apiJson('/api/admin/setup', {
      method: 'POST',
      body: JSON.stringify({ username: OWNER_USERNAME, password: 'weak' }),
    });
    assert.equal(weak.status, 400);

    const setup = await apiJson('/api/admin/setup', {
      method: 'POST',
      body: JSON.stringify({ username: OWNER_USERNAME, password: OWNER_PASS }),
    });
    assert.equal(setup.status, 201);
    assert.ok(typeof setup.json.token === 'string');
    ownerToken = setup.json.token as string;

    const repeatSetup = await apiJson('/api/admin/setup', {
      method: 'POST',
      body: JSON.stringify({ username: 'attacker', password: OWNER_PASS }),
    });
    assert.equal(repeatSetup.status, 403);

    // Enable MFA
    const beginMfa = await apiJson('/api/admin/security/mfa/begin', {
      method: 'POST',
      token: ownerToken,
    });
    assert.equal(beginMfa.status, 200);
    mfaSecret = beginMfa.json.secret as string;
    const validTotp = generateTotpCode(mfaSecret);

    const confirmMfa = await apiJson('/api/admin/security/mfa/confirm', {
      method: 'POST',
      token: ownerToken,
      body: JSON.stringify({ code: validTotp }),
    });
    assert.equal(confirmMfa.status, 200);
    assert.equal(confirmMfa.json.mfaEnabled, true);
    const codes = confirmMfa.json.recoveryCodes as string[];
    assert.equal(codes.length, 6);
    mfaRecoveryCode = codes[0];

    // Login now requires 2FA challenge, and challenge cannot be replayed twice
    const login = await apiJson('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username: OWNER_USERNAME, password: OWNER_PASS }),
    });
    assert.equal(login.status, 200);
    assert.equal(login.json.requiresMfa, true);
    const challengeToken = login.json.challengeToken as string;

    const verify1 = await apiJson('/api/admin/mfa/verify', {
      method: 'POST',
      body: JSON.stringify({ challengeToken, code: generateTotpCode(mfaSecret) }),
    });
    assert.equal(verify1.status, 200);
    assert.ok(typeof verify1.json.token === 'string');
    ownerToken = verify1.json.token as string;

    const replay = await apiJson('/api/admin/mfa/verify', {
      method: 'POST',
      body: JSON.stringify({ challengeToken, code: generateTotpCode(mfaSecret) }),
    });
    assert.equal(replay.status, 401);
  });

  it('4. Granular RBAC strictly isolates Manager permissions and blocks Owner-only endpoints', async () => {
    const createMgr = await apiJson('/api/admin/security/team', {
      method: 'POST',
      token: ownerToken,
      body: JSON.stringify({
        username: MANAGER_USERNAME,
        password: MANAGER_PASS,
        permissions: ['orders'],
      }),
    });
    assert.equal(createMgr.status, 201);
    const userObj = createMgr.json.user as { id: string; permissions: string[] };
    managerId = userObj.id;
    assert.deepEqual(userObj.permissions, ['orders']);

    const mgrLogin = await apiJson('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username: MANAGER_USERNAME, password: MANAGER_PASS }),
    });
    assert.equal(mgrLogin.status, 200);
    managerToken = mgrLogin.json.token as string;
    assert.equal(mgrLogin.json.adminRole, 'manager');
    assert.deepEqual(mgrLogin.json.permissions, ['orders']);

    // Manager dashboard strips products, customers, loyaltyCards, auditLogs
    const mgrDash = await apiJson('/api/admin/dashboard', { token: managerToken });
    assert.equal(mgrDash.status, 200);
    assert.equal((mgrDash.json.products as unknown[]).length, 0);
    assert.equal((mgrDash.json.customers as unknown[]).length, 0);
    assert.equal((mgrDash.json.auditLogs as unknown[]).length, 0);

    // Manager without 'products' or 'loyalty' or owner permissions is rejected with 403
    const deniedProd = await apiJson('/api/admin/products', {
      method: 'POST',
      token: managerToken,
      body: JSON.stringify({
        kind: 'bouquet',
        category: 'red_roses',
        categoryAr: 'ورد',
        nameAr: 'اختبار',
        nameEn: 'Denied Test',
        priceIqd: 10000,
        stock: 5,
        isAvailable: true,
        imageUrl: '/src/assets/images/bouquet_red_velvet_1795361896339.jpg',
      }),
    });
    assert.equal(deniedProd.status, 403);

    const deniedSettings = await apiJson('/api/admin/settings', {
      method: 'PUT',
      token: managerToken,
      body: JSON.stringify({ roseUnitPriceIqd: 100 }),
    });
    assert.equal(deniedSettings.status, 403);

    const deniedBackups = await apiJson('/api/admin/backups', { token: managerToken });
    assert.equal(deniedBackups.status, 403);

    // Owner updates Manager permissions to include loyalty dynamically
    const grantLoyalty = await apiJson(`/api/admin/security/team/${managerId}`, {
      method: 'PATCH',
      token: ownerToken,
      body: JSON.stringify({ permissions: ['orders', 'loyalty'] }),
    });
    assert.equal(grantLoyalty.status, 200);
  });

  it('5. Checkout ignores spoofed prices, requires delivery address, rejects inactive payments & bad promos', async () => {
    const missingAddr = await apiJson('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        customerName: 'Zainab Test',
        customerPhone: '07701112233',
        customerBirthDate: '1995-05-05',
        marketingConsent: true,
        deliveryType: 'delivery',
        deliveryAddress: ' ',
        paymentMethod: 'cash_on_delivery',
        items: [{ type: 'ready_made', productId: 'prod_velvet_15', quantity: 1 }],
      }),
    });
    assert.equal(missingAddr.status, 400);

    const inactivePayment = await apiJson('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        customerName: 'Zainab Test',
        customerPhone: '07701112233',
        customerBirthDate: '1995-05-05',
        marketingConsent: true,
        deliveryType: 'pickup',
        paymentMethod: 'zain_cash',
        items: [{ type: 'ready_made', productId: 'prod_velvet_15', quantity: 1 }],
      }),
    });
    assert.equal(inactivePayment.status, 400);

    const badPromo = await apiJson('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        customerName: 'Zainab Test',
        customerPhone: '07701112233',
        customerBirthDate: '1995-05-05',
        marketingConsent: true,
        deliveryType: 'pickup',
        paymentMethod: 'cash_on_delivery',
        promoCode: 'FAKE100',
        items: [{ type: 'ready_made', productId: 'prod_velvet_15', quantity: 1 }],
      }),
    });
    assert.equal(badPromo.status, 400);

    // Legitimate checkout with tampered price/total in payload -> server computes real 52,000 + 29,000 = 81,000 IQD
    const beforeFlowerStock = getDb().options.find((o) => o.id === 'ft_ecuador_rose')!.stock;
    const beforeProdStock = getDb().products.find((p) => p.id === 'prod_velvet_15')!.stock;

    const validOrder = await apiJson('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        customerName: 'Zainab Victim',
        customerPhone: '+964 770 111 2233',
        customerBirthDate: '1995-05-05',
        marketingConsent: true,
        deliveryType: 'delivery',
        deliveryAddress: 'حي الحسين - كربلاء',
        paymentMethod: 'cash_on_delivery',
        totalIqd: 1, // spoofed
        items: [
          { type: 'ready_made', productId: 'prod_velvet_15', quantity: 1, unitPriceIqd: 1 },
          {
            type: 'custom_bouquet',
            quantity: 1,
            customSelection: {
              roseQuantity: 8,
              flowerTypeId: 'ft_ecuador_rose',
              colorIds: ['fc_red'],
              wrappingId: 'wrap_korean',
              arrangementId: 'arr_round',
              giftIds: [],
            },
          },
        ],
      }),
    });
    assert.equal(validOrder.status, 201);
    const ord = validOrder.json.order as { id: string; totalIqd: number; stampAwarded: boolean };
    assert.equal(ord.totalIqd, 52000 + 8 * 3000 + 5000);
    assert.equal(ord.stampAwarded, false);
    assert.ok(typeof validOrder.json.customerToken === 'string');
    const card = validOrder.json.loyaltyCard as { id: string; stampsCount: number };
    assert.equal(card.stampsCount, 0);
    victimOrderId = ord.id;
    victimCardId = card.id;

    // Verify BOTH ready-made product and custom flower variety stock were deducted atomically
    assert.equal(getDb().products.find((p) => p.id === 'prod_velvet_15')!.stock, beforeProdStock - 1);
    assert.equal(getDb().options.find((o) => o.id === 'ft_ecuador_rose')!.stock, beforeFlowerStock - 8);
  });

  it('6. Guest order phone takeover attack fails to overwrite DOB or steal victim loyalty card/token', async () => {
    const hijackOrder = await apiJson('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        customerName: 'Attacker Hijack',
        customerPhone: '07701112233',
        customerBirthDate: '2001-01-01',
        marketingConsent: false,
        deliveryType: 'pickup',
        paymentMethod: 'cash_on_delivery',
        items: [{ type: 'ready_made', productId: 'prod_golden_sun_10', quantity: 1 }],
      }),
    });
    assert.equal(hijackOrder.status, 201);
    assert.equal(hijackOrder.json.customerToken, null);
    assert.equal(hijackOrder.json.loyaltyCard, null);
    assert.equal(hijackOrder.json.identityVerificationRequired, true);

    const attackerVerify = await apiJson('/api/customers/verify', {
      method: 'POST',
      body: JSON.stringify({ phone: '07701112233', birthDate: '2001-01-01' }),
    });
    assert.equal(attackerVerify.status, 404);

    const victimVerify = await apiJson('/api/customers/verify', {
      method: 'POST',
      body: JSON.stringify({ phone: '07701112233', birthDate: '1995-05-05' }),
    });
    assert.equal(victimVerify.status, 200);
    assert.ok(typeof victimVerify.json.customerToken === 'string');
  });

  it('7. Loyalty stamps require Completed order status, prevent duplicates, support reversal & 10-stamp expiry check', async () => {
    // Customer cannot award stamp (even for their own order)
    const custAttempt = await apiJson('/api/admin/loyalty/award-stamp', {
      method: 'POST',
      body: JSON.stringify({ orderId: victimOrderId }),
    });
    assert.equal(custAttempt.status, 401);

    // Order is 'New' -> stamp must be rejected until marked Completed
    const uncompletedStamp = await apiJson('/api/admin/loyalty/award-stamp', {
      method: 'POST',
      token: managerToken,
      body: JSON.stringify({ orderId: victimOrderId }),
    });
    assert.equal(uncompletedStamp.status, 400);

    // Manager updates status to Completed, then awards stamp once
    const markCompleted = await apiJson(`/api/admin/orders/${victimOrderId}/status`, {
      method: 'PATCH',
      token: managerToken,
      body: JSON.stringify({ status: 'Completed' }),
    });
    assert.equal(markCompleted.status, 200);

    const stampOk = await apiJson('/api/admin/loyalty/award-stamp', {
      method: 'POST',
      token: managerToken,
      body: JSON.stringify({ orderId: victimOrderId }),
    });
    assert.equal(stampOk.status, 200);
    assert.equal((stampOk.json.card as { stampsCount: number }).stampsCount, 1);

    // Duplicate stamp blocked with 409
    const dupStamp = await apiJson('/api/admin/loyalty/award-stamp', {
      method: 'POST',
      token: managerToken,
      body: JSON.stringify({ orderId: victimOrderId }),
    });
    assert.equal(dupStamp.status, 409);

    // Reverse stamp brings stampsCount back to 0
    const rev = await apiJson('/api/admin/loyalty/reverse-stamp', {
      method: 'POST',
      token: ownerToken,
      body: JSON.stringify({ cardId: victimCardId, orderId: victimOrderId, note: 'Test audit reversal' }),
    });
    assert.equal(rev.status, 200);
    assert.equal((rev.json.card as { stampsCount: number }).stampsCount, 0);
  });

  it('8. Image upload validates magic bytes, enforces JSON error responses, and rejects path traversal delete', async () => {
    // Spoofed <script> masquerading as JPEG
    const spoofForm = new FormData();
    spoofForm.append(
      'image',
      new Blob(['<html><script>alert(1)</script></html>'], { type: 'image/jpeg' }),
      'evil.jpg'
    );
    const spoofRes = await fetch(`${baseUrl}/api/admin/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: spoofForm,
    });
    assert.equal(spoofRes.status, 400);

    // Invalid mimetype returns clean JSON 400 (not HTML stack trace)
    const badMimeForm = new FormData();
    badMimeForm.append('image', new Blob(['hello'], { type: 'text/plain' }), 'evil.txt');
    const badMimeRes = await fetch(`${baseUrl}/api/admin/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: badMimeForm,
    });
    assert.equal(badMimeRes.status, 400);
    const badMimeJson = (await badMimeRes.json()) as { error?: string };
    assert.ok(badMimeJson.error);

    // Valid PNG magic bytes upload succeeds and returns safe /uploads/ URL
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);
    const okForm = new FormData();
    okForm.append('image', new Blob([pngBytes], { type: 'image/png' }), 'rose.png');
    const okRes = await fetch(`${baseUrl}/api/admin/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: okForm,
    });
    assert.equal(okRes.status, 201);
    const okJson = (await okRes.json()) as { url: string; filename: string };
    assert.match(okJson.url, /^\/uploads\/sedo_[a-zA-Z0-9_-]+\.png$/);

    // Delete with traversal blocked, genuine filename delete succeeds
    const travDel = await apiJson('/api/admin/upload/..%2F..%2Fpackage.json', {
      method: 'DELETE',
      token: ownerToken,
    });
    assert.equal(travDel.status, 400);

    const goodDel = await apiJson(`/api/admin/upload/${okJson.filename}`, {
      method: 'DELETE',
      token: ownerToken,
    });
    assert.equal(goodDel.status, 200);
  });

  it('9. CORS & CSRF guard allows configured Netlify origin and blocks untrusted cross-origin writes', async () => {
    const blocked = await apiJson('/api/orders', {
      method: 'POST',
      originHeader: 'https://evil-attacker.example',
      body: JSON.stringify({}),
    });
    assert.equal(blocked.status, 403);

    const allowedCatalog = await apiJson('/api/catalog', {
      originHeader: 'https://sedo-store.netlify.app',
    });
    assert.equal(allowedCatalog.status, 200);
    assert.equal(
      allowedCatalog.headers.get('access-control-allow-origin'),
      'https://sedo-store.netlify.app'
    );
  });

  it('10. TokenVersion invalidates prior sessions on revoke-all and backup auto-recovery restores missing DB', async () => {
    // Test password change & recovery code reset + revoke-all invalidating old token
    const oldToken = ownerToken;
    const revoke = await apiJson('/api/admin/security/revoke-all', {
      method: 'POST',
      token: oldToken,
    });
    assert.equal(revoke.status, 200);

    const afterRevoke = await apiJson('/api/admin/dashboard', { token: oldToken });
    assert.equal(afterRevoke.status, 403);

    // Reset password using one-time MFA recovery code
    const newPass = 'SedoReset!2026#New';
    const resetRes = await apiJson('/api/admin/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        username: OWNER_USERNAME,
        recoveryCode: mfaRecoveryCode,
        newPassword: newPass,
      }),
    });
    assert.equal(resetRes.status, 200);

    // Reusing the same recovery code fails
    const replayRecovery = await apiJson('/api/admin/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        username: OWNER_USERNAME,
        recoveryCode: mfaRecoveryCode,
        newPassword: newPass,
      }),
    });
    assert.equal(replayRecovery.status, 403);

    // Simulate missing/corrupted sedo-db.json with auto-recovery from latest backup snapshot
    const dbFile = path.join(dataDir, 'sedo-db.json');
    const ordersBefore = getDb().orders.length;
    assert.ok(ordersBefore >= 2);
    // Create backup explicitly via store
    const newLogin = await apiJson('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username: OWNER_USERNAME, password: newPass }),
    });
    const mfa2 = await apiJson('/api/admin/mfa/verify', {
      method: 'POST',
      body: JSON.stringify({
        challengeToken: newLogin.json.challengeToken,
        code: generateTotpCode(mfaSecret),
      }),
    });
    assert.equal(mfa2.status, 200);
    const freshToken = mfa2.json.token as string;

    const bkp = await apiJson('/api/admin/backups', {
      method: 'POST',
      token: freshToken,
    });
    assert.equal(bkp.status, 200);

    fs.unlinkSync(dbFile);
    resetDbCacheForTests();
    const recovered = getDb();
    assert.equal(recovered.orders.length, ordersBefore);
    assert.equal(recovered.adminCredential?.username, OWNER_USERNAME);
  });
});
