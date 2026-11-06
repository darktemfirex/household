import type { Item } from './types';

export interface Store {
  subscribe(cb: (items: Item[]) => void, onError?: (e: unknown) => void): () => void;
  save(item: Item): void;
  remove(id: string): void;
}

export interface SyncConfig { config: Record<string, unknown>; code: string }

const ITEMS_KEY = 'household:items';
const SYNC_KEY = 'household:sync';

export const loadSync = (): SyncConfig | null => {
  try { const v = localStorage.getItem(SYNC_KEY); return v ? JSON.parse(v) : null; } catch { return null; }
};
export const saveSync = (s: SyncConfig | null) => {
  if (s) localStorage.setItem(SYNC_KEY, JSON.stringify(s)); else localStorage.removeItem(SYNC_KEY);
};

export const readLocalItems = (): Item[] => {
  try { return JSON.parse(localStorage.getItem(ITEMS_KEY) ?? '[]'); } catch { return []; }
};

/** 이 기기에만 저장 (공유 설정 전 기본값) */
export const localStore: Store = (() => {
  const listeners = new Set<(items: Item[]) => void>();
  const emit = () => { const v = readLocalItems(); listeners.forEach(l => l(v)); };
  const write = (items: Item[]) => { localStorage.setItem(ITEMS_KEY, JSON.stringify(items)); emit(); };
  window.addEventListener('storage', e => { if (e.key === ITEMS_KEY) emit(); });
  return {
    subscribe(cb) { listeners.add(cb); cb(readLocalItems()); return () => { listeners.delete(cb); }; },
    save(item) { write([...readLocalItems().filter(i => i.id !== item.id), item]); },
    remove(id) { write(readLocalItems().filter(i => i.id !== id)); },
  };
})();

/** Firebase Firestore 실시간 공유 (부부 기기 간 동기화). 경로: households/{code}/items/{id} */
export async function createCloudStore({ config, code }: SyncConfig): Promise<Store> {
  const [{ initializeApp, getApps, getApp }, fs] = await Promise.all([import('firebase/app'), import('firebase/firestore')]);
  const app = getApps().some(a => a.name === 'household') ? getApp('household') : initializeApp(config, 'household');
  const db = fs.getFirestore(app);
  const col = fs.collection(db, 'households', code, 'items');
  const fail = (e: unknown) => alert('저장 실패: ' + String(e));
  return {
    subscribe(cb, onError) {
      return fs.onSnapshot(col, snap => cb(snap.docs.map(d => d.data() as Item)), e => onError?.(e));
    },
    save(item) { fs.setDoc(fs.doc(col, item.id), item).catch(fail); },
    remove(id) { fs.deleteDoc(fs.doc(col, id)).catch(fail); },
  };
}
