import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { cycleKeyOf, shiftKey, summarize, todayStr, type Summary } from './calc';
import { comma, digits, md, mdw, uid, won } from './format';
import { notify, onNotify } from './notify';
import { createCloudStore, readLocalItems, signInGoogle, signOutUser, watchAuth, type Store } from './store';
import { CATEGORIES, DEFAULT_SETTINGS, type Expense, type Fixed, type Income, type Item, type Method, type Settings } from './types';

type Tab = 'home' | 'ledger' | 'fixed' | 'settings';
type Status = 'loading' | 'signedout' | 'connecting' | 'cloud' | 'error';

const ME_KEY = 'household:me';
const getMe = () => localStorage.getItem(ME_KEY) || '나';

function useItems() {
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [err, setErr] = useState('');
  const [store, setStore] = useState<Store | null>(null);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let off = () => {};
    watchAuth(u => { setUser(u); setStatus(u ? 'connecting' : 'signedout'); if (!u) { setStore(null); setItems([]); } })
      .then(f => { off = f; })
      .catch(e => { setStatus('error'); setErr(String(e)); });
    return () => off();
  }, []);

  useEffect(() => {
    if (!user) return;
    let dead = false;
    let unsub = () => {};
    createCloudStore().then(s => {
      if (dead) return;
      setStore(s);
      unsub = s.subscribe(
        v => { setItems(v); setStatus('cloud'); setErr(''); },
        e => {
          setStatus('error');
          const msg = String(e);
          setErr(msg.includes('permission') ? '허용되지 않은 계정입니다. 등록된 구글 계정으로 로그인해 주세요.' : msg);
        },
      );
    }).catch(e => { if (!dead) { setStatus('error'); setErr(String(e)); } });
    return () => { dead = true; unsub(); };
  }, [user]);

  return { items, status, err, store, user };
}

function Toast() {
  const [msg, setMsg] = useState('');
  useEffect(() => onNotify(m => { setMsg(m); setTimeout(() => setMsg(''), 3000); }), []);
  return msg ? <div className="toast">{msg}</div> : null;
}

/** 삭제: 1번 누르면 '정말 삭제' 로 바뀌고, 한 번 더 누르면 삭제 (confirm() 대체) */
function DeleteButton({ onDelete }: { onDelete: () => void }) {
  const [ask, setAsk] = useState(false);
  return <button className="danger" onClick={() => (ask ? onDelete() : setAsk(true))}>{ask ? '정말 삭제' : '삭제'}</button>;
}

function Login({ status, err }: { status: Status; err: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const go = async () => {
    setBusy(true); setMsg('');
    try { await signInGoogle(); } catch (e) { setMsg('로그인 실패: ' + String(e)); } finally { setBusy(false); }
  };
  return (
    <div className="app login">
      <div className="logo">₩</div>
      <h2>우리집 가계부</h2>
      {status === 'loading' ? <p className="hint">불러오는 중…</p> : (
        <>
          <p className="hint">등록된 구글 계정으로 로그인하면<br />부부가 같은 가계부를 함께 사용해요.</p>
          <button className="primary wide" disabled={busy} onClick={go}>Google 계정으로 로그인</button>
        </>
      )}
      {(msg || err) && <div className="banner err">{msg || err}</div>}
    </div>
  );
}

export default function App() {
  const { items, status, err, store, user } = useItems();
  const [tab, setTab] = useState<Tab>('home');
  const [sheet, setSheet] = useState<null | { type: 'expense' | 'income'; item?: Expense | Income }>(null);
  const today = todayStr();

  const settings = useMemo<Settings>(
    () => (items.find(i => i.kind === 'settings') as Settings | undefined) ?? DEFAULT_SETTINGS, [items]);
  const curKey = cycleKeyOf(today, settings.cardStartDay);
  const [key, setKey] = useState(curKey);
  useEffect(() => { setKey(curKey); }, [curKey]); // 14일이 되면 자동으로 새 주기로 전환(초기화)

  const sum = useMemo(() => summarize(items, settings, key, today), [items, settings, key, today]);
  const save = (i: Item) => store ? store.save(i) : notify('서버에 연결 중입니다. 잠시 후 다시 시도해 주세요.');
  const remove = (id: string) => store?.remove(id);

  if (!user) return <Login status={status} err={err} />;

  return (
    <div className="app">
      <Toast />
      {status === 'connecting' && <div className="banner">서버에 연결 중…</div>}
      {status === 'error' && (
        <div className="banner err">연결 오류: {err} <button className="link" onClick={() => signOutUser()}>다른 계정으로 로그인</button></div>
      )}
      <main>
        {tab === 'home' && <Home sum={sum} settings={settings} curKey={curKey} setKey={setKey} goSettings={() => setTab('settings')} />}
        {tab === 'ledger' && <Ledger sum={sum} setKey={setKey} onEdit={it => setSheet({ type: it.kind as 'expense' | 'income', item: it })} />}
        {tab === 'fixed' && <FixedTab items={items} save={save} remove={remove} />}
        {tab === 'settings' && <SettingsTab settings={settings} save={save} status={status} user={user} store={store} />}
      </main>
      {tab !== 'settings' && tab !== 'fixed' && <button className="fab" onClick={() => setSheet({ type: 'expense' })}>＋ 입력</button>}
      <nav>
        {([['home', '홈'], ['ledger', '내역'], ['fixed', '고정비용'], ['settings', '고정수익']] as [Tab, string][]).map(([t, l]) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{l}</button>
        ))}
      </nav>
      {sheet && <EntrySheet init={sheet} onClose={() => setSheet(null)} save={save} remove={remove} />}
    </div>
  );
}

/* ---------------- 홈 ---------------- */
function CycleNav({ sum, curKey, setKey }: { sum: Summary; curKey?: string; setKey: (k: string) => void }) {
  return (
    <div className="cyclenav">
      <button onClick={() => setKey(shiftKey(sum.key, -1))}>◀</button>
      <div>
        <b>{Number(sum.key.slice(5))}월 소비동향</b>
        <small>카드 주기 {md(sum.start)} ~ {md(sum.end)}{sum.isCurrent ? ' · 진행 중' : sum.isPast ? ' · 종료' : ' · 예정'}</small>
      </div>
      <button onClick={() => setKey(shiftKey(sum.key, 1))}>▶</button>
      {curKey && sum.key !== curKey && <button className="chip" onClick={() => setKey(curKey)}>이번 주기</button>}
    </div>
  );
}

function Home({ sum, settings, curKey, setKey, goSettings }: { sum: Summary; settings: Settings; curKey: string; setKey: (k: string) => void; goSettings: () => void }) {
  const over = sum.cardRemaining < 0;
  const maxCat = sum.byCategory[0]?.amount || 1;
  return (
    <>
      <CycleNav sum={sum} curKey={curKey} setKey={setKey} />
      {settings.salary === 0 && (
        <div className="card notice">월급이 아직 설정되지 않았어요. <button className="link" onClick={goSettings}>설정에서 월급 입력 →</button></div>
      )}
      <section className={'card hero' + (over ? ' over' : '')}>
        <div className="lbl">{sum.isPast ? '주기 종료 시 남은 카드 한도' : '이번 주기 남은 카드 한도'}</div>
        <div className="big">{won(sum.cardRemaining)}</div>
        <div className="bar"><i style={{ width: sum.usedPct + '%' }} /></div>
        <div className="row"><span>카드 사용 {won(sum.cardUsed)}</span><span>한도 {won(sum.cardBudget)} ({sum.usedPct}%)</span></div>
        {sum.isCurrent && (
          <div className="meta">
            새 주기(초기화)까지 <b>{sum.daysLeft}일</b> · 하루 <b>{won(Math.max(0, sum.dailyAllowance))}</b> 사용 가능
          </div>
        )}
      </section>

      <section className="card">
        <h3>카드 한도 계산</h3>
        <dl>
          <div><dt>월급 <small>({md(sum.salaryDate)}{sum.salaryReceived ? '' : ' 예정'})</small></dt><dd className="pos">+{won(sum.salary)}</dd></div>
          <div><dt>기타 수입</dt><dd className="pos">+{won(sum.extraIncome)}</dd></div>
          <div><dt>고정비 (계좌이체·현금)</dt><dd className="neg">-{won(sum.transferFixed)}</dd></div>
          <div><dt>현금·이체 지출</dt><dd className="neg">-{won(sum.cashSpent)}</dd></div>
          <div><dt>저축 목표</dt><dd className="neg">-{won(sum.savingGoal)}</dd></div>
          <div className="total"><dt>카드로 쓸 수 있는 총액</dt><dd>{won(sum.cardBudget)}</dd></div>
        </dl>
      </section>

      <section className="card">
        <h3>카드 사용 내역</h3>
        <dl>
          <div><dt>카드 고정비</dt><dd>{won(sum.cardFixed)}</dd></div>
          <div><dt>카드 변동 지출</dt><dd>{won(sum.cardVariable)}</dd></div>
          <div className="total"><dt>카드 사용 합계</dt><dd>{won(sum.cardUsed)}</dd></div>
        </dl>
      </section>

      {sum.byCategory.length > 0 && (
        <section className="card">
          <h3>카테고리별 지출</h3>
          {sum.byCategory.map(c => (
            <div className="cat" key={c.category}>
              <span>{c.category}</span>
              <div className="bar sm"><i style={{ width: (c.amount / maxCat) * 100 + '%' }} /></div>
              <b>{won(c.amount)}</b>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

/* ---------------- 내역 ---------------- */
function Ledger({ sum, setKey, onEdit }: { sum: Summary; setKey: (k: string) => void; onEdit: (i: Expense | Income) => void }) {
  const [filter, setFilter] = useState<'all' | Method | 'income'>('all');
  const rows: (Expense | Income)[] = [
    ...(filter === 'income' ? [] : sum.expenses.filter(e => filter === 'all' || e.method === filter)),
    ...(filter === 'all' || filter === 'income' ? sum.incomes : []),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const groups = new Map<string, (Expense | Income)[]>();
  rows.forEach(r => groups.set(r.date, [...(groups.get(r.date) ?? []), r]));
  return (
    <>
      <CycleNav sum={sum} setKey={setKey} />
      <div className="seg">
        {([['all', '전체'], ['card', '카드'], ['cash', '현금/이체'], ['income', '수입']] as const).map(([v, l]) => (
          <button key={v} className={filter === v ? 'on' : ''} onClick={() => setFilter(v)}>{l}</button>
        ))}
      </div>
      {rows.length === 0 && <p className="empty">이 기간에 입력된 내역이 없어요.<br />아래 ＋ 입력 버튼으로 추가하세요.</p>}
      {[...groups].map(([d, list]) => (
        <section className="card" key={d}>
          <h4>{mdw(d)}</h4>
          {list.map(r => (
            <button className="item" key={r.id} onClick={() => onEdit(r)}>
              <div>
                <b>{r.kind === 'expense' ? (r.memo || r.category) : r.title}</b>
                <small>
                  {r.kind === 'expense' ? `${r.category} · ${r.method === 'card' ? '카드' : '현금/이체'}` : '수입'} · {r.who}
                </small>
              </div>
              <span className={r.kind === 'income' ? 'pos' : ''}>{r.kind === 'income' ? '+' : '-'}{won(r.amount)}</span>
            </button>
          ))}
        </section>
      ))}
    </>
  );
}

/* ---------------- 입력 시트 ---------------- */
function AmountInput({ value, onChange, placeholder }: { value: number; onChange: (n: number) => void; placeholder?: string }) {
  return (
    <div className="amt">
      <input inputMode="numeric" value={comma(value)} placeholder={placeholder ?? '0'} onChange={e => onChange(digits(e.target.value))} />
      <span>원</span>
    </div>
  );
}

function EntrySheet({ init, onClose, save, remove }: {
  init: { type: 'expense' | 'income'; item?: Expense | Income };
  onClose: () => void; save: (i: Item) => void; remove: (id: string) => void;
}) {
  const ex = init.item?.kind === 'expense' ? init.item : undefined;
  const inc = init.item?.kind === 'income' ? init.item : undefined;
  const [type, setType] = useState(init.type);
  const [date, setDate] = useState(init.item?.date ?? todayStr());
  const [amount, setAmount] = useState(init.item?.amount ?? 0);
  const [category, setCategory] = useState(ex?.category ?? CATEGORIES[0]);
  const [method, setMethod] = useState<Method>(ex?.method ?? 'card');
  const [memo, setMemo] = useState(ex?.memo ?? inc?.title ?? '');
  const editing = !!init.item;

  const submit = () => {
    if (amount <= 0) return notify('금액을 입력해 주세요.');
    const base = { id: init.item?.id ?? uid(), date, amount, who: init.item?.who ?? getMe(), createdAt: init.item?.createdAt ?? Date.now() };
    if (type === 'expense') save({ ...base, kind: 'expense', category, memo: memo.trim(), method });
    else save({ ...base, kind: 'income', title: memo.trim() || '수입' });
    onClose();
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="seg">
          <button className={type === 'expense' ? 'on' : ''} disabled={editing} onClick={() => setType('expense')}>지출</button>
          <button className={type === 'income' ? 'on' : ''} disabled={editing} onClick={() => setType('income')}>수입</button>
        </div>
        <label>금액<AmountInput value={amount} onChange={setAmount} /></label>
        <div className="quick">
          {[1000, 10000, 50000, 100000].map(n => <button key={n} onClick={() => setAmount(amount + n)}>+{comma(n)}</button>)}
          <button onClick={() => setAmount(0)}>지우기</button>
        </div>
        <label>날짜<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        {type === 'expense' && (
          <>
            <label>결제수단
              <div className="seg">
                <button className={method === 'card' ? 'on' : ''} onClick={() => setMethod('card')}>카드</button>
                <button className={method === 'cash' ? 'on' : ''} onClick={() => setMethod('cash')}>현금/이체</button>
              </div>
            </label>
            <label>카테고리
              <div className="chips">
                {CATEGORIES.map(c => <button key={c} className={category === c ? 'on' : ''} onClick={() => setCategory(c)}>{c}</button>)}
              </div>
            </label>
          </>
        )}
        <label>{type === 'expense' ? '메모' : '수입 내용'}
          <input value={memo} placeholder={type === 'expense' ? '예) 마트 장보기' : '예) 상여금, 용돈'} onChange={e => setMemo(e.target.value)} />
        </label>
        <div className="actions">
          {editing && <DeleteButton onDelete={() => { remove(init.item!.id); onClose(); }} />}
          <button onClick={onClose}>취소</button>
          <button className="primary" onClick={submit}>{editing ? '수정' : '저장'}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 고정비 ---------------- */
function FixedTab({ items, save, remove }: { items: Item[]; save: (i: Item) => void; remove: (id: string) => void }) {
  const list = items.filter((i): i is Fixed => i.kind === 'fixed').sort((a, b) => a.day - b.day);
  const [edit, setEdit] = useState<Fixed | 'new' | null>(null);
  const total = (m: Method) => list.filter(f => f.active && f.method === m).reduce((a, b) => a + b.amount, 0);
  return (
    <>
      <h2>고정비용</h2>
      <p className="hint">한 번 등록하면 매월 자동 반영돼요. 금액이 바뀔 때만 항목을 눌러 수정하세요.</p>
      <section className="card">
        <dl>
          <div><dt>카드 자동결제 (카드 사용액에 포함)</dt><dd>{won(total('card'))}</dd></div>
          <div><dt>계좌이체·현금 (카드 한도에서 차감)</dt><dd>{won(total('cash'))}</dd></div>
        </dl>
      </section>
      {list.length === 0 && <p className="empty">등록된 고정비가 없어요. 월세·통신비·보험료 등을 추가해 보세요.</p>}
      <section className="card">
        {list.map(f => (
          <button className={'item' + (f.active ? '' : ' off')} key={f.id} onClick={() => setEdit(f)}>
            <div><b>{f.name}</b><small>매월 {f.day}일 · {f.method === 'card' ? '카드' : '계좌이체/현금'}{f.active ? '' : ' · 중지'}</small></div>
            <span>{won(f.amount)}</span>
          </button>
        ))}
      </section>
      <button className="primary wide" onClick={() => setEdit('new')}>＋ 고정비 추가</button>
      {edit && <FixedSheet init={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} save={save} remove={remove} />}
    </>
  );
}

function FixedSheet({ init, onClose, save, remove }: { init?: Fixed; onClose: () => void; save: (i: Item) => void; remove: (id: string) => void }) {
  const [name, setName] = useState(init?.name ?? '');
  const [amount, setAmount] = useState(init?.amount ?? 0);
  const [day, setDay] = useState(init?.day ?? 1);
  const [method, setMethod] = useState<Method>(init?.method ?? 'cash');
  const [active, setActive] = useState(init?.active ?? true);
  const submit = () => {
    if (!name.trim() || amount <= 0) return notify('이름과 금액을 입력해 주세요.');
    save({ id: init?.id ?? uid(), kind: 'fixed', name: name.trim(), amount, day: Math.min(31, Math.max(1, day)), method, active, createdAt: init?.createdAt ?? Date.now() });
    onClose();
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <label>항목명<input value={name} placeholder="예) 월세, 통신비, 보험료" onChange={e => setName(e.target.value)} /></label>
        <label>월 금액<AmountInput value={amount} onChange={setAmount} /></label>
        <label>매월 결제일<input type="number" min={1} max={31} value={day} onChange={e => setDay(Number(e.target.value))} /></label>
        <label>결제 방식
          <div className="seg">
            <button className={method === 'card' ? 'on' : ''} onClick={() => setMethod('card')}>카드</button>
            <button className={method === 'cash' ? 'on' : ''} onClick={() => setMethod('cash')}>계좌이체/현금</button>
          </div>
        </label>
        <label className="check"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> 적용 중</label>
        <div className="actions">
          {init && <DeleteButton onDelete={() => { remove(init.id); onClose(); }} />}
          <button onClick={onClose}>취소</button>
          <button className="primary" onClick={submit}>저장</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 설정 ---------------- */
function SettingsTab({ settings, save, status, user, store }: {
  settings: Settings; save: (i: Item) => void; status: Status; user: User; store: Store | null;
}) {
  const [d, setD] = useState(settings);
  useEffect(() => setD(settings), [settings]);
  const [me, setMe] = useState(getMe());

  const clamp = (n: number) => Math.min(28, Math.max(1, n || 1));
  const saveSettings = () => {
    save({ ...d, salaryDay: clamp(d.salaryDay), cardStartDay: clamp(d.cardStartDay), updatedAt: Date.now() });
    localStorage.setItem(ME_KEY, me.trim() || '나');
    notify('저장했어요.');
  };
  const uploadLocal = () => {
    const local = readLocalItems();
    if (!store || local.length === 0) return notify('올릴 이 기기 데이터가 없어요.');
    local.forEach(i => store.save(i));
    localStorage.removeItem('household:items');
  };

  return (
    <>
      <h2>고정수익</h2>
      <p className="hint">월급은 한 번 설정하면 매월 자동 반영돼요. 금액이 바뀔 때만 수정하세요.</p>
      <section className="card form">
        <h3>월급 <small>(부부 공통)</small></h3>
        <label>월급 (세후)<AmountInput value={d.salary} onChange={n => setD({ ...d, salary: n })} /></label>
        <label>월급일 (매월)<input type="number" min={1} max={28} value={d.salaryDay} onChange={e => setD({ ...d, salaryDay: Number(e.target.value) })} /></label>
        <h3>카드·저축 설정</h3>
        <label>카드 주기 시작일 <small>(14 → 14일~다음달 13일)</small><input type="number" min={1} max={28} value={d.cardStartDay} onChange={e => setD({ ...d, cardStartDay: Number(e.target.value) })} /></label>
        <label>월 저축 목표<AmountInput value={d.savingGoal} onChange={n => setD({ ...d, savingGoal: n })} /></label>
        <label>이 기기 사용자 이름 <small>(내역에 표시)</small><input value={me} onChange={e => setMe(e.target.value)} placeholder="나 / 아내" /></label>
        <button className="primary wide" onClick={saveSettings}>저장</button>
      </section>

      <section className="card form">
        <h3>계정 <small>{status === 'cloud' ? '🟢 동기화 중' : status === 'error' ? '🔴 오류' : '🟡 연결 중'}</small></h3>
        <p className="hint">{user.email} 로 로그인됨</p>
        {readLocalItems().length > 0 && <button className="wide" onClick={uploadLocal} disabled={status !== 'cloud'}>이 기기에 남은 예전 데이터를 서버로 올리기</button>}
        <button className="wide" onClick={() => signOutUser()}>로그아웃</button>
      </section>
    </>
  );
}
