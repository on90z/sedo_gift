import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase.ts';
import type { OptionItem, Product, StoreSettings } from '../shared/types.ts';

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefined(v);
      }
    }
    return out as T;
  }
  return value;
}

export function isOwnerFirebaseAuthed(): boolean {
  const user = auth.currentUser;
  return Boolean(user && user.emailVerified && user.email === 'moimlali00@gmail.com');
}

export async function syncProductToFirestore(product: Product): Promise<boolean> {
  if (!isOwnerFirebaseAuthed()) return false;
  try {
    await setDoc(doc(db, 'products', product.id), stripUndefined(product));
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `products/${product.id}`);
  }
}

export async function deleteProductFromFirestore(productId: string): Promise<boolean> {
  if (!isOwnerFirebaseAuthed()) return false;
  try {
    await deleteDoc(doc(db, 'products', productId));
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `products/${productId}`);
  }
}

export async function syncOptionToFirestore(option: OptionItem): Promise<boolean> {
  if (!isOwnerFirebaseAuthed()) return false;
  try {
    await setDoc(doc(db, 'options', option.id), stripUndefined(option));
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `options/${option.id}`);
  }
}

export async function deleteOptionFromFirestore(optionId: string): Promise<boolean> {
  if (!isOwnerFirebaseAuthed()) return false;
  try {
    await deleteDoc(doc(db, 'options', optionId));
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `options/${optionId}`);
  }
}

export async function syncSettingsToFirestore(settings: StoreSettings): Promise<boolean> {
  if (!isOwnerFirebaseAuthed()) return false;
  try {
    const { telegramConfigured: _tc, ...clean } = settings;
    void _tc;
    await setDoc(doc(db, 'store_settings', 'public'), stripUndefined({ ...clean, id: 'public' }));
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'store_settings/public');
  }
}

export async function syncFullCatalogToFirestore(payload: {
  products: Product[];
  options: OptionItem[];
  settings: StoreSettings;
}): Promise<boolean> {
  if (!isOwnerFirebaseAuthed()) return false;
  try {
    const batch = writeBatch(db);
    const { telegramConfigured: _tc, ...cleanSettings } = payload.settings;
    void _tc;
    batch.set(doc(db, 'store_settings', 'public'), stripUndefined({ ...cleanSettings, id: 'public' }));

    for (const p of payload.products) {
      batch.set(doc(db, 'products', p.id), stripUndefined(p));
    }
    for (const o of payload.options) {
      batch.set(doc(db, 'options', o.id), stripUndefined(o));
    }
    await batch.commit();
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'store_settings/public');
  }
}

export async function fetchPublicCatalogFromFirestore(): Promise<{
  settings: Partial<StoreSettings> | null;
  products: Product[] | null;
  options: OptionItem[] | null;
}> {
  try {
    const settingsSnap = await getDoc(doc(db, 'store_settings', 'public'));
    if (!settingsSnap.exists()) {
      return { settings: null, products: null, options: null };
    }
    const [prodSnap, optSnap] = await Promise.all([
      getDocs(collection(db, 'products')),
      getDocs(collection(db, 'options')),
    ]);
    return {
      settings: settingsSnap.data() as Partial<StoreSettings>,
      products: prodSnap.empty ? null : prodSnap.docs.map((d) => d.data() as Product),
      options: optSnap.empty ? null : optSnap.docs.map((d) => d.data() as OptionItem),
    };
  } catch {
    return { settings: null, products: null, options: null };
  }
}
