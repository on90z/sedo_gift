import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildOtpAuthUri,
  checkLoginLockout,
  clearLoginFailures,
  generateBase32Secret,
  generateRecoveryCodes,
  generateTotpCode,
  hasValidImageMagicBytes,
  isSafeHttpOrLocalAssetUrl,
  recordLoginFailure,
  validateStrongPassword,
  verifyTotpCode,
} from './security.ts';

describe('SEDO Security Module', () => {
  it('enforces strong passwords (10+ chars, upper, lower, digit, symbol)', () => {
    assert.equal(validateStrongPassword('short').valid, false);
    assert.equal(validateStrongPassword('alllowercase1!').valid, false);
    assert.equal(validateStrongPassword('ALLUPPERCASE1!').valid, false);
    assert.equal(validateStrongPassword('NoDigitsHere!').valid, false);
    assert.equal(validateStrongPassword('NoSymbol12345').valid, false);
    assert.equal(validateStrongPassword('SedoFlower#2026').valid, true);
  });

  it('generates and verifies RFC 6238 TOTP codes and otpauth URIs', () => {
    const secret = generateBase32Secret(20);
    assert.ok(secret.length >= 32);

    const nowMs = 1_760_000_000_000;
    const validCode = generateTotpCode(secret, nowMs);
    assert.match(validCode, /^\d{6}$/);
    assert.equal(verifyTotpCode(secret, validCode, 1, nowMs), true);
    assert.equal(verifyTotpCode(secret, validCode, 1, nowMs + 25_000), true);
    assert.equal(verifyTotpCode(secret, '000000', 1, nowMs), false);
    assert.equal(verifyTotpCode(secret, 'abc123', 1, nowMs), false);

    const uri = buildOtpAuthUri({
      issuer: 'SEDO Admin',
      accountName: 'owner_sedo',
      secretBase32: secret,
    });
    assert.ok(uri.startsWith('otpauth://totp/'));
    assert.ok(uri.includes(secret));
  });

  it('generates properly formatted recovery codes', () => {
    const codes = generateRecoveryCodes(6);
    assert.equal(codes.length, 6);
    for (const c of codes) {
      assert.match(c, /^[0-9A-F]{4}-[0-9A-F]{4}$/);
    }
  });

  it('validates safe HTTP/local URLs and rejects dangerous protocols or traversal', () => {
    assert.equal(isSafeHttpOrLocalAssetUrl('https://example.com/rose.jpg', false), true);
    assert.equal(isSafeHttpOrLocalAssetUrl('/uploads/sedo_abc.jpg', false), true);
    assert.equal(isSafeHttpOrLocalAssetUrl('', true), true);
    assert.equal(isSafeHttpOrLocalAssetUrl('', false), false);
    assert.equal(isSafeHttpOrLocalAssetUrl('javascript:alert(1)', false), false);
    assert.equal(isSafeHttpOrLocalAssetUrl('data:text/html,<script>alert(1)</script>', false), false);
    assert.equal(isSafeHttpOrLocalAssetUrl('/uploads/../etc/passwd', false), false);
  });

  it('verifies real image magic bytes and rejects spoofed files', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sedo-sec-'));
    try {
      const validPng = path.join(tmpDir, 'valid.png');
      fs.writeFileSync(
        validPng,
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
      );
      assert.equal(hasValidImageMagicBytes(validPng, 'image/png'), true);
      assert.equal(hasValidImageMagicBytes(validPng, 'image/jpeg'), false);

      const spoofedImg = path.join(tmpDir, 'spoofed.jpg');
      fs.writeFileSync(spoofedImg, '<html><script>alert(1)</script></html>');
      assert.equal(hasValidImageMagicBytes(spoofedImg, 'image/jpeg'), false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('enforces 5-attempt brute-force lockout and clears on success', () => {
    const key = `test-lock-${Date.now()}`;
    assert.equal(checkLoginLockout(key).locked, false);
    for (let i = 0; i < 4; i++) {
      const res = recordLoginFailure(key);
      assert.equal(res.nowLocked, false);
    }
    const fifth = recordLoginFailure(key);
    assert.equal(fifth.nowLocked, true);
    assert.equal(checkLoginLockout(key).locked, true);

    clearLoginFailures(key);
    assert.equal(checkLoginLockout(key).locked, false);
  });
});
