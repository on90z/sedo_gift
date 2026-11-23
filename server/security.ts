import crypto from 'node:crypto';
import fs from 'node:fs';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function validateStrongPassword(password: string): { valid: boolean; reason?: string } {
  if (typeof password !== 'string') {
    return { valid: false, reason: 'Password is required.' };
  }
  if (password.length < 10 || password.length > 128) {
    return { valid: false, reason: 'Password must be between 10 and 128 characters.' };
  }
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9\s]/.test(password);
  if (!hasUpper || !hasLower || !hasDigit || !hasSymbol) {
    return {
      valid: false,
      reason:
        'Password must include uppercase, lowercase, number, and special character (min 10 chars).',
    };
  }
  return { valid: true };
}

export function generateBase32Secret(byteLength = 20): string {
  const bytes = crypto.randomBytes(byteLength);
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function decodeBase32(base32: string): Buffer {
  const clean = base32.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpCode(secretBase32: string, timestampMs = Date.now(), stepSeconds = 30): string {
  const key = decodeBase32(secretBase32);
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter), 0);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotpCode(
  secretBase32: string,
  code: string,
  windowSteps = 1,
  timestampMs = Date.now()
): boolean {
  const cleaned = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleaned)) return false;
  const supplied = Buffer.from(cleaned);
  for (let delta = -windowSteps; delta <= windowSteps; delta++) {
    const candidate = generateTotpCode(secretBase32, timestampMs + delta * 30_000);
    const expected = Buffer.from(candidate);
    if (supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)) {
      return true;
    }
  }
  return false;
}

export function buildOtpAuthUri(params: {
  issuer: string;
  accountName: string;
  secretBase32: string;
}): string {
  const issuer = encodeURIComponent(params.issuer);
  const account = encodeURIComponent(params.accountName);
  return `otpauth://totp/${issuer}:${account}?secret=${params.secretBase32}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

export function generateRecoveryCodes(count = 6): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  return codes;
}

export function encryptSecretAtRest(plaintext: string): string {
  const keyEnv = process.env.MFA_ENCRYPTION_KEY?.trim();
  if (!keyEnv) return `plain:${plaintext}`;
  const key = crypto.createHash('sha256').update(keyEnv).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `aes256gcm:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecretAtRest(stored: string): string {
  if (!stored) return '';
  if (stored.startsWith('plain:')) {
    return stored.slice('plain:'.length);
  }
  if (stored.startsWith('aes256gcm:')) {
    const keyEnv = process.env.MFA_ENCRYPTION_KEY?.trim();
    if (!keyEnv) return '';
    const [, ivHex, tagHex, dataHex] = stored.split(':');
    if (!ivHex || !tagHex || !dataHex) return '';
    const key = crypto.createHash('sha256').update(keyEnv).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString(
      'utf8'
    );
  }
  return stored;
}

export function isSafeHttpOrLocalAssetUrl(value: string, allowEmpty = false): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return allowEmpty;
  if (trimmed.startsWith('/uploads/') || trimmed.startsWith('/src/assets/')) {
    return !trimmed.includes('..') && !trimmed.includes('\0');
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function hasValidImageMagicBytes(filePath: string, mimeType: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    if (bytesRead < 12) return false;

    if (mimeType === 'image/jpeg') {
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    }
    if (mimeType === 'image/png') {
      return (
        buf[0] === 0x89 &&
        buf[1] === 0x50 &&
        buf[2] === 0x4e &&
        buf[3] === 0x47 &&
        buf[4] === 0x0d &&
        buf[5] === 0x0a &&
        buf[6] === 0x1a &&
        buf[7] === 0x0a
      );
    }
    if (mimeType === 'image/webp') {
      return (
        buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buf.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    }
    return false;
  } catch {
    return false;
  }
}

// Per-account + per-IP brute-force tracker (auto-unlocks after 15 min)
interface FailureRecord {
  count: number;
  firstFailureAt: number;
  lockedUntil: number;
}
const loginFailures = new Map<string, FailureRecord>();
const MAX_CONSECUTIVE_FAILURES = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

export function checkLoginLockout(key: string): { locked: boolean; retryAfterSeconds: number } {
  const rec = loginFailures.get(key);
  if (!rec) return { locked: false, retryAfterSeconds: 0 };
  const now = Date.now();
  if (rec.lockedUntil > now) {
    return {
      locked: true,
      retryAfterSeconds: Math.ceil((rec.lockedUntil - now) / 1000),
    };
  }
  if (now - rec.firstFailureAt > LOCKOUT_WINDOW_MS) {
    loginFailures.delete(key);
  }
  return { locked: false, retryAfterSeconds: 0 };
}

export function recordLoginFailure(key: string): {
  nowLocked: boolean;
  attemptsRemaining: number;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  const prev = loginFailures.get(key);
  const count =
    prev && now - prev.firstFailureAt <= LOCKOUT_WINDOW_MS ? prev.count + 1 : 1;
  const firstFailureAt =
    prev && now - prev.firstFailureAt <= LOCKOUT_WINDOW_MS ? prev.firstFailureAt : now;

  if (count >= MAX_CONSECUTIVE_FAILURES) {
    const lockedUntil = now + LOCKOUT_WINDOW_MS;
    loginFailures.set(key, { count, firstFailureAt, lockedUntil });
    return {
      nowLocked: true,
      attemptsRemaining: 0,
      retryAfterSeconds: Math.ceil(LOCKOUT_WINDOW_MS / 1000),
    };
  }
  loginFailures.set(key, { count, firstFailureAt, lockedUntil: 0 });
  return {
    nowLocked: false,
    attemptsRemaining: MAX_CONSECUTIVE_FAILURES - count,
    retryAfterSeconds: 0,
  };
}

export function clearLoginFailures(key: string): void {
  loginFailures.delete(key);
}
