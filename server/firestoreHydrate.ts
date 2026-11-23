import fs from 'node:fs';
import path from 'node:path';
import type { OptionItem, Product, StoreSettings } from '../src/shared/types.ts';
import { getDb, persistDb, wasLoadedFromDisk } from './store.ts';
import { SEED_SETTINGS } from '../src/shared/seedCatalog.ts';

interface FirebaseAppletConfig {
  projectId?: string;
  firestoreDatabaseId?: string;
}

type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { timestampValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

function decodeValue(val: FirestoreValue | undefined): unknown {
  if (!val) return undefined;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map((v) => decodeValue(v));
  }
  if ('mapValue' in val) {
    const out: Record<string, unknown> = {};
    const fields = val.mapValue.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = decodeValue(v);
    }
    return out;
  }
  return undefined;
}

function decodeDocument(doc: { name?: string; fields?: Record<string, FirestoreValue> }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc.fields || {})) {
    out[k] = decodeValue(v);
  }
  if (!out.id && doc.name) {
    const parts = doc.name.split('/');
    out.id = parts[parts.length - 1];
  }
  return out;
}

function loadConfig(): FirebaseAppletConfig | null {
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(cfgPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as FirebaseAppletConfig;
    if (!parsed.projectId || parsed.projectId === 'remixed-project-id') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Hydrates public catalog (store_settings/public, products, options) from Firestore
 * using public REST reads allowed by firestore.rules (no IAM/Admin SDK required).
 * Ensures post-deployment edits synced to Firestore survive container restarts.
 */
export async function hydrateCatalogFromPublicFirestore(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg?.projectId) return;
  const dbId = cfg.firestoreDatabaseId || '(default)';
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    cfg.projectId
  )}/databases/${encodeURIComponent(dbId)}/documents`;

  const db = getDb();
  const localLoaded = wasLoadedFromDisk();

  try {
    const settingsResp = await fetch(`${baseUrl}/store_settings/public`, {
      signal: AbortSignal.timeout(4500),
    });
    if (!settingsResp.ok) return;

    const settingsDoc = (await settingsResp.json()) as {
      name?: string;
      fields?: Record<string, FirestoreValue>;
    };
    const remoteSettings = decodeDocument(settingsDoc) as Partial<StoreSettings>;
    const remoteUpdated = typeof remoteSettings.updatedAt === 'string' ? Date.parse(remoteSettings.updatedAt) : 0;
    const localUpdated = typeof db.settings.updatedAt === 'string' ? Date.parse(db.settings.updatedAt) : 0;

    // Only hydrate if container started fresh without disk DB OR Firestore is strictly newer
    if (!localLoaded || (remoteUpdated > 0 && remoteUpdated > localUpdated)) {
      db.settings = {
        ...SEED_SETTINGS,
        ...db.settings,
        ...remoteSettings,
        loyaltyReward: {
          ...SEED_SETTINGS.loyaltyReward,
          ...db.settings.loyaltyReward,
          ...(remoteSettings.loyaltyReward || {}),
        },
        paymentMethods:
          Array.isArray(remoteSettings.paymentMethods) && remoteSettings.paymentMethods.length > 0
            ? remoteSettings.paymentMethods
            : db.settings.paymentMethods,
        categories:
          Array.isArray(remoteSettings.categories) && remoteSettings.categories.length > 0
            ? remoteSettings.categories
            : db.settings.categories,
      };

      const [prodResp, optResp] = await Promise.all([
        fetch(`${baseUrl}/products?pageSize=200`, { signal: AbortSignal.timeout(4500) }),
        fetch(`${baseUrl}/options?pageSize=200`, { signal: AbortSignal.timeout(4500) }),
      ]);

      if (prodResp.ok) {
        const prodJson = (await prodResp.json()) as {
          documents?: Array<{ name?: string; fields?: Record<string, FirestoreValue> }>;
        };
        if (Array.isArray(prodJson.documents) && prodJson.documents.length > 0) {
          db.products = prodJson.documents.map((d) => decodeDocument(d) as unknown as Product);
        }
      }

      if (optResp.ok) {
        const optJson = (await optResp.json()) as {
          documents?: Array<{ name?: string; fields?: Record<string, FirestoreValue> }>;
        };
        if (Array.isArray(optJson.documents) && optJson.documents.length > 0) {
          db.options = optJson.documents.map((d) => decodeDocument(d) as unknown as OptionItem);
        }
      }

      persistDb();
      console.log('Hydrated storefront catalog and settings from Firestore.');
    }
  } catch {
    // Offline or Firestore not yet populated — continue safely with local DB
  }
}
