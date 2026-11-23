import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  AdminNotification,
  AdminPermission,
  AuditLogEntry,
  BirthdayCampaign,
  CustomerRecord,
  LoyaltyCardRecord,
  LoyaltyTransaction,
  OptionItem,
  OrderRecord,
  Product,
  StoreSettings,
} from '../src/shared/types.ts';
import {
  SEED_BIRTHDAY_CAMPAIGNS,
  SEED_OPTIONS,
  SEED_PRODUCTS,
  SEED_SETTINGS,
} from '../src/shared/seedCatalog.ts';

export type AdminRole = 'owner' | 'manager';

export const ALL_ADMIN_PERMISSIONS: AdminPermission[] = [
  'orders',
  'products',
  'loyalty',
  'customers',
  'notifications',
];

export const DEFAULT_MANAGER_PERMISSIONS: AdminPermission[] = [
  'orders',
  'products',
  'loyalty',
  'notifications',
];

export interface AdminCredentialRecord {
  username: string;
  passwordHash: string; // scrypt salt:hash
  role?: AdminRole;
  mfaEnabled?: boolean;
  mfaSecret?: string;
  pendingMfaSecret?: string;
  recoveryCodeHashes?: string[];
  tokenVersion?: number;
  passwordUpdatedAt?: string;
  createdAt: string;
}

export interface AdminTeamUser {
  id: string;
  username: string;
  passwordHash: string;
  role: 'manager';
  permissions?: AdminPermission[];
  tokenVersion: number;
  createdBy: string;
  createdAt: string;
}

export interface StoreMigrations {
  contactInfoMigrated?: boolean;
  proximityRadius2000?: boolean;
}

export interface StoreDatabase {
  adminCredential: AdminCredentialRecord | null;
  adminUsers?: AdminTeamUser[];
  telegramBotToken: string;
  telegramChatId: string;
  migrations?: StoreMigrations;
  settings: StoreSettings;
  products: Product[];
  options: OptionItem[];
  customers: CustomerRecord[];
  orders: OrderRecord[];
  loyaltyCards: LoyaltyCardRecord[];
  loyaltyTransactions: LoyaltyTransaction[];
  notifications: AdminNotification[];
  birthdayCampaigns: BirthdayCampaign[];
  auditLogs: AuditLogEntry[];
}

function getStoragePaths() {
  const dataDir = process.env.SEDO_DATA_DIR
    ? path.resolve(process.env.SEDO_DATA_DIR)
    : path.resolve(process.cwd(), '.data');
  const backupsDir = path.join(dataDir, 'backups');
  const dataFile = path.join(dataDir, 'sedo-db.json');
  return { dataDir, backupsDir, dataFile };
}

export function createBackupSnapshot(reason = 'manual'): {
  filename: string;
  path: string;
  createdAt: string;
} | null {
  try {
    const { backupsDir, dataFile } = getStoragePaths();
    if (!fs.existsSync(dataFile)) return null;
    fs.mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const safeReason = reason.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
    const filename = `sedo-db-${safeReason}-${stamp}.json`;
    const dest = path.join(backupsDir, filename);
    fs.copyFileSync(dataFile, dest);
    try {
      fs.chmodSync(dest, 0o600);
    } catch {
      // ignore chmod errors on restricted FS
    }
    return { filename, path: dest, createdAt: now.toISOString() };
  } catch (err) {
    console.error('Failed to create backup snapshot:', err);
    return null;
  }
}

export function runAutomatedDailyBackup(): { filename: string; createdAt: string } | null {
  try {
    const { backupsDir, dataFile } = getStoragePaths();
    if (!fs.existsSync(dataFile)) return null;
    fs.mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
    const todayPrefix = `sedo-db-auto_daily-${new Date().toISOString().slice(0, 10)}`;
    const existing = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.json'));
    if (existing.some((f) => f.startsWith(todayPrefix))) {
      return null;
    }
    const snap = createBackupSnapshot('auto_daily');
    // Rotate automated daily backups keeping latest 14
    const autoBackups = fs
      .readdirSync(backupsDir)
      .filter((f) => f.startsWith('sedo-db-auto_daily-') && f.endsWith('.json'))
      .sort()
      .reverse();
    for (const oldFile of autoBackups.slice(14)) {
      try {
        fs.unlinkSync(path.join(backupsDir, oldFile));
      } catch {
        // ignore cleanup error
      }
    }
    return snap ? { filename: snap.filename, createdAt: snap.createdAt } : null;
  } catch (err) {
    console.error('Automated daily backup check failed:', err);
    return null;
  }
}

export function listBackupSnapshots(): Array<{ filename: string; sizeBytes: number; mtime: string }> {
  try {
    const { backupsDir } = getStoragePaths();
    if (!fs.existsSync(backupsDir)) return [];
    return fs
      .readdirSync(backupsDir)
      .filter((f) => f.endsWith('.json'))
      .map((filename) => {
        const stat = fs.statSync(path.join(backupsDir, filename));
        return {
          filename,
          sizeBytes: stat.size,
          mtime: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch {
    return [];
  }
}

function createInitialDb(): StoreDatabase {
  return {
    adminCredential: null,
    adminUsers: [],
    telegramBotToken: '',
    telegramChatId: '',
    migrations: {
      contactInfoMigrated: true,
      proximityRadius2000: true,
    },
    settings: { ...SEED_SETTINGS },
    products: SEED_PRODUCTS.map((p) => ({ ...p })),
    options: SEED_OPTIONS.map((o) => ({ ...o })),
    customers: [],
    orders: [],
    loyaltyCards: [],
    loyaltyTransactions: [],
    notifications: [],
    birthdayCampaigns: SEED_BIRTHDAY_CAMPAIGNS.map((c) => ({ ...c })),
    auditLogs: [],
  };
}

let cachedDb: StoreDatabase | null = null;
let loadedFromDisk = false;

export function wasLoadedFromDisk(): boolean {
  return loadedFromDisk;
}

export function resetDbCacheForTests(): void {
  cachedDb = null;
  loadedFromDisk = false;
}

function hydrateParsedDb(parsed: StoreDatabase): StoreDatabase {
  const migrations: StoreMigrations = { ...(parsed.migrations || {}) };
  let needsPersist = false;

  const mergedSettings: StoreSettings = {
    ...SEED_SETTINGS,
    ...parsed.settings,
    loyaltyReward: {
      ...SEED_SETTINGS.loyaltyReward,
      ...(parsed.settings?.loyaltyReward || {}),
    },
    paymentMethods:
      Array.isArray(parsed.settings?.paymentMethods) && parsed.settings.paymentMethods.length > 0
        ? parsed.settings.paymentMethods
        : SEED_SETTINGS.paymentMethods,
    categories:
      Array.isArray(parsed.settings?.categories) && parsed.settings.categories.length > 0
        ? parsed.settings.categories
        : SEED_SETTINGS.categories.map((c) => ({ ...c })),
  };

  if (!migrations.contactInfoMigrated) {
    if (mergedSettings.phone === '+964 770 000 0000') {
      mergedSettings.phone = SEED_SETTINGS.phone;
    }
    if (!mergedSettings.secondaryPhone) {
      mergedSettings.secondaryPhone = SEED_SETTINGS.secondaryPhone;
    }
    if (mergedSettings.instagramUrl === 'https://www.instagram.com/sedo.flowers.iq/') {
      mergedSettings.instagramUrl = SEED_SETTINGS.instagramUrl;
      mergedSettings.instagramHandle = SEED_SETTINGS.instagramHandle;
    }
    migrations.contactInfoMigrated = true;
    needsPersist = true;
  }

  if (!migrations.proximityRadius2000) {
    createBackupSnapshot('pre_radius_2000');
    if (
      !Number.isFinite(mergedSettings.proximityRadiusMeters) ||
      mergedSettings.proximityRadiusMeters === 600 ||
      mergedSettings.proximityRadiusMeters <= 0
    ) {
      mergedSettings.proximityRadiusMeters = 2000;
    }
    migrations.proximityRadius2000 = true;
    needsPersist = true;
  }

  const adminCredential = parsed.adminCredential
    ? {
        ...parsed.adminCredential,
        role: parsed.adminCredential.role || ('owner' as const),
        tokenVersion: parsed.adminCredential.tokenVersion ?? 1,
        passwordUpdatedAt:
          parsed.adminCredential.passwordUpdatedAt || parsed.adminCredential.createdAt,
      }
    : null;

  const adminUsers = Array.isArray(parsed.adminUsers)
    ? parsed.adminUsers.map((u) => ({
        ...u,
        permissions:
          Array.isArray(u.permissions) && u.permissions.length > 0
            ? u.permissions
            : [...DEFAULT_MANAGER_PERMISSIONS],
      }))
    : [];

  loadedFromDisk = true;
  cachedDb = {
    ...createInitialDb(),
    ...parsed,
    adminCredential,
    adminUsers,
    migrations,
    settings: mergedSettings,
  };
  if (needsPersist) {
    persistDb();
  }
  return cachedDb;
}

function tryRecoverLatestBackup(): StoreDatabase | null {
  try {
    const snapshots = listBackupSnapshots();
    const { backupsDir } = getStoragePaths();
    for (const snap of snapshots) {
      try {
        const raw = fs.readFileSync(path.join(backupsDir, snap.filename), 'utf8');
        const parsed = JSON.parse(raw) as StoreDatabase;
        if (parsed && Array.isArray(parsed.products) && parsed.settings) {
          const recovered = hydrateParsedDb(parsed);
          persistDb();
          console.warn(`Recovered SEDO database automatically from backup: ${snap.filename}`);
          return recovered;
        }
      } catch {
        // try next older backup
      }
    }
  } catch {
    // ignore backup directory error
  }
  return null;
}

export function getDb(): StoreDatabase {
  if (cachedDb) return cachedDb;
  const { dataFile } = getStoragePaths();
  try {
    if (fs.existsSync(dataFile)) {
      const raw = fs.readFileSync(dataFile, 'utf8');
      const parsed = JSON.parse(raw) as StoreDatabase;
      return hydrateParsedDb(parsed);
    }
  } catch (err) {
    console.error('Failed to read store database, attempting automatic backup recovery:', err);
  }

  const recovered = tryRecoverLatestBackup();
  if (recovered) return recovered;

  loadedFromDisk = false;
  cachedDb = createInitialDb();
  persistDb();
  return cachedDb;
}

export function persistDb(): void {
  if (!cachedDb) return;
  const { dataDir, dataFile } = getStoragePaths();
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const tmpFile = `${dataFile}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(cachedDb, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmpFile, dataFile);
  try {
    fs.chmodSync(dataFile, 0o600);
  } catch {
    // ignore chmod failures on restricted filesystems
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derived = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derived.length) return false;
  return crypto.timingSafeEqual(keyBuf, derived);
}

export function addAuditLog(
  actor: string,
  action: string,
  details: string,
  targetId?: string
): void {
  const db = getDb();
  db.auditLogs.unshift({
    id: `audit_${crypto.randomUUID().slice(0, 12)}`,
    actor,
    action,
    targetId,
    details,
    createdAt: new Date().toISOString(),
  });
  if (db.auditLogs.length > 500) {
    db.auditLogs.length = 500;
  }
}
