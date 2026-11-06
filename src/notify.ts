// alert()/confirm() 은 카카오톡 등 인앱 브라우저·홈 화면 앱에서 막히는 경우가 있어 화면 내 토스트로 대체
type Listener = (msg: string) => void;
const listeners = new Set<Listener>();
export const notify = (msg: string) => listeners.forEach(l => l(msg));
export const onNotify = (l: Listener) => { listeners.add(l); return () => { listeners.delete(l); }; };
