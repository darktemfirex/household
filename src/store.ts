import type { User } from 'firebase/auth';
import type { Item } from './types';

export interface Store {
  subscribe(cb: (items: Item[]) => void, onError?: (e: unknown) => void): () => void;
  save(item: Item): void;
  remove(id: string): void;
}

// 웹 앱용 Firebase 설정값은 공개되어도 안전합니다. 접근 제어는 Firestore 보안 규칙(허용 이메일)이 담당합니다.
const firebaseConfig = {
  apiKey: 'AIzaSyBtSpahysjfQ2Xt_d1R9GYn44qAxe3rqu0',
  authDomain: 'household-fc08c.firebaseapp.com',
  projectId: 'household-fc08c',
  storageBucket: 'household-fc08c.firebasestorage.app',
  messagingSenderId: '114729248217',
  appId: '1:114729248217:web:386c822d77395328c1a5c8',
};

/** 이전(공유 설정 전)에 이 기기 localStorage 에 쌓인 데이터 — 서버로 옮길 때만 사용 */
export const readLocalItems = (): Item[] => {
  try { return JSON.parse(localStorage.getItem('household:items') ?? '[]'); } catch { return []; }
};

async function modules() {
  const [{ initializeApp, getApps, getApp }, auth, fs] = await Promise.all([
    import('firebase/app'), import('firebase/auth'), import('firebase/firestore'),
  ]);
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return { app, auth, fs };
}

export async function watchAuth(cb: (u: User | null) => void): Promise<() => void> {
  const { app, auth } = await modules();
  return auth.onAuthStateChanged(auth.getAuth(app), cb);
}

export async function signInGoogle() {
  const { app, auth } = await modules();
  await auth.signInWithPopup(auth.getAuth(app), new auth.GoogleAuthProvider());
}

export async function signOutUser() {
  const { app, auth } = await modules();
  await auth.signOut(auth.getAuth(app));
}

/** Firestore 실시간 공유. 경로: households/main/items/{id} */
export async function createCloudStore(): Promise<Store> {
  const { app, fs } = await modules();
  let db;
  try {
    db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch {
    db = fs.getFirestore(app); // 이미 초기화된 경우
  }
  const col = fs.collection(db, 'households', 'main', 'items');
  const fail = (e: unknown) => alert('저장 실패: ' + String(e));
  return {
    subscribe(cb, onError) {
      return fs.onSnapshot(col, snap => cb(snap.docs.map(d => d.data() as Item)), e => onError?.(e));
    },
    save(item) { fs.setDoc(fs.doc(col, item.id), item).catch(fail); },
    remove(id) { fs.deleteDoc(fs.doc(col, id)).catch(fail); },
  };
}
