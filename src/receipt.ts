import type { Method } from './types';

export interface ReceiptResult {
  amount: number;
  date: string; // YYYY-MM-DD, 못 찾으면 ''
  merchant: string;
  method: Method | null;
  text: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
// OCR 오인식(합계→한계/함계/합게, 금액→급액 등)까지 허용
const AMOUNT_KEYS = /(결\s*제\s*[금급]\s*액|승\s*인\s*[금급]\s*액|청\s*구\s*[금급]\s*액|받\s*을\s*[금급돈]|총\s*결\s*제|[합함한]\s*[계게]|총\s*[금급]?\s*액|판\s*매\s*[금급]|결\s*제\s*요\s*청|TOTAL|AMOUNT|SUM|결\s*제|승\s*인)/i;
const PAID_WORDS = /(결\s*제|승\s*인|청\s*구|받\s*을|총\s*[금급]?\s*액|TOTAL)/i;
const SKIP_LINE = /(영수증|사업자|대표|전화|TEL|주소|승인번호|카드번호|가맹점번호|단말기|거래일|POS|http|www|\d{2,4}-\d{3,4}-\d{4})/i;
const NOT_PAID = /(부가세|부가가치세|과세|면세|세액|공급가|봉사료|할인|포인트|적립|거스름|잔액|받은\s*돈|받은금액|수량|단가|정상가)/;

/** 한 줄에서 금액 후보(원 단위 정수) 추출. 콤마 있는 숫자 우선, 없으면 3자리 이상 숫자 */
function numbersIn(line: string): number[] {
  const out: number[] = [];
  // OCR 이 '14, 500' 처럼 쉼표 뒤에 공백을 넣는 경우도 허용
  for (const m of line.matchAll(/\d{1,3}(?:[,.]\s?\d{3})+|\d{3,9}/g)) {
    const n = Number(m[0].replace(/[,.\s]/g, ''));
    if (n >= 100 && n <= 99_999_999) out.push(n);
  }
  return out;
}

export function parseDate(text: string, now = new Date()): string {
  const cands: string[] = [];
  for (const m of text.matchAll(/(20\d{2}|\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/g)) {
    let y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
    if (y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    const s = `${y}-${pad(mo)}-${pad(d)}`;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCMonth() !== mo - 1) continue;
    if (y > now.getFullYear() + 1 || y < now.getFullYear() - 5) continue;
    cands.push(s);
  }
  if (!cands.length) {
    // 20261105 20:35 처럼 구분자 없는 8자리 날짜
    for (const m of text.matchAll(/(?<!\d)(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/g)) {
      const y = Number(m[1]);
      if (y > now.getFullYear() + 1 || y < now.getFullYear() - 5) continue;
      cands.push(`${m[1]}-${m[2]}-${m[3]}`);
    }
  }
  return cands[0] ?? '';
}

export function parseReceipt(raw: string, now = new Date()): ReceiptResult {
  const text = raw.replace(/[ \t]+/g, ' ');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // 금액: 합계/결제금액 등 키워드 줄 → 같은 줄 또는 바로 다음 줄의 숫자
  let amount = 0;
  const lastNum = (i: number): number | null => {
    const nums = numbersIn(lines[i]);
    if (nums.length) return nums[nums.length - 1];
    const nx = lines[i + 1] ? numbersIn(lines[i + 1]) : [];
    return nx.length ? nx[nx.length - 1] : null;
  };
  // 1순위: '결제금액' 줄 — 할인·포인트가 반영된 실제 결제액이라 합계보다 우선
  const payAmounts: number[] = [];
  lines.forEach((l, i) => {
    if (!/결\s*제\s*(대\s*상\s*)?[금급]\s*액|최\s*종\s*결\s*제/.test(l)) return;
    if (/(잔액|후|적립|포인트|환불|취소)/.test(l)) return;
    const n = lastNum(i);
    if (n) payAmounts.push(n);
  });
  // 2순위: '합계' 줄 (OCR 이 '합 Al:' 처럼 깨뜨려도 줄 첫머리의 '합'으로 인식). 과세·면세·부가세·정상가·할인 합계는 제외
  // 합계 바로 아래(2줄 이내)에 할인(음수) 줄이 있으면 '합계 − 할인'으로 계산해 결제액을 구한다.
  // (결제금액 글자가 깨져 못 읽어도 계산으로 복원: 51,800 − 12,000 = 39,800)
  const entries: { n: number; list: boolean; adjusted: boolean }[] = [];
  let base: { idx: number; line: number } | null = null;
  lines.forEach((l, i) => {
    const isTotal = /[합함한]\s*[계게]|판\s*매\s*합|^[합함한]\s+\S/.test(l);
    const negative = /[-−–]\s*\d/.test(l);
    if (negative && (isTotal || /할인/.test(l)) && base && i - base.line <= 2) {
      const d = lastNum(i);
      const e = entries[base.idx];
      if (d && d < e.n) { e.n -= d; e.adjusted = true; base = { idx: base.idx, line: i }; } // 연속 할인 줄도 반영
      return;
    }
    if (!isTotal || /(과세|면세|부가세|세액|공급가)/.test(l) || /할인/.test(l)) return;
    const n = lastNum(i);
    if (!n) return;
    entries.push({ n, list: /정상가/.test(l), adjusted: false });
    base = { idx: entries.length - 1, line: i };
  });
  // '정상가 합계'(할인 전 금액)는 할인 계산으로 보정된 경우에만 인정
  const totals = entries.filter(e => !e.list || e.adjusted).map(e => e.n);
  // 2순위: 결제금액·받을금액·승인금액 등
  const keyed: number[] = [];
  lines.forEach((l, i) => {
    if (!AMOUNT_KEYS.test(l)) return;
    if (NOT_PAID.test(l) && !PAID_WORDS.test(l)) return; // '부가세 합계' 같은 줄은 제외, '합계(부가세 포함)'은 허용
    if (/승\s*인\s*번\s*호|카드\s*번\s*호/.test(l)) return;
    const n = lastNum(i);
    if (n) keyed.push(n);
  });
  if (payAmounts.length) amount = Math.max(...payAmounts);
  else if (totals.length) amount = Math.max(...totals);
  else if (keyed.length) amount = Math.max(...keyed);
  else {
    // 키워드가 없으면 전화번호·날짜 줄을 뺀 가장 큰 금액
    const all = lines.filter(l => !SKIP_LINE.test(l) && !NOT_PAID.test(l) && !/\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(l)).flatMap(numbersIn);
    // 총액은 보통 '합계'와 '카드 승인'에서 2번 이상 나오므로 반복되는 큰 금액을 우선
    const count = new Map<number, number>();
    all.forEach(n => count.set(n, (count.get(n) ?? 0) + 1));
    const repeated = [...count].filter(([, c]) => c >= 2).map(([n]) => n);
    if (repeated.length) amount = Math.max(...repeated);
    else if (all.length) amount = Math.max(...all);
  }

  // 가게명: '상호/가맹점' 줄의 값, 없으면 위쪽에서 처음 나오는 한글 줄
  let merchant = '';
  const labeled = lines.find(l => /^(상\s*호|가맹점명?|매장명?)\s*[:：]?\s*\S+/.test(l));
  if (labeled) merchant = labeled.replace(/^(상\s*호|가맹점명?|매장명?)\s*[:：]?\s*/, '');
  else {
    const head = lines.slice(0, 10).map(l => l.replace(/^\[[^\]]*\]\s*/, '').replace(/\(?0\d{1,2}\)?[-\s]?\d{3,4}-\d{4}/g, '').trim()); // '[영수증] 상호' → '상호', 전화번호 제거
    const ok = (l: string) => /[가-힣]{2,}/.test(l) && !SKIP_LINE.test(l) && !AMOUNT_KEYS.test(l) && !/(주문|번호|대기|교환|환불|인증|고객|문의)/.test(l) && numbersIn(l).length === 0;
    // 확실한 경우(업종·지점 표기로 끝나는 줄)만 채우고, 불확실하면 비워 둠 (틀린 상호보다 빈칸이 낫다)
    merchant = head.find(l => ok(l) && /(점|마트|커피|카페|식당|편의점|약국|주유소|병원|치킨|피자|베이커리)\s*$/.test(l.trim())) ?? '';
  }
  merchant = merchant.replace(/[^\w가-힣 ()&.\-]/g, '').trim().slice(0, 30);

  const method: Method | null = /현금\s*(영수증|결제|승인)|현금$/m.test(text) ? 'cash' : /(카드|신용|체크|승인|VISA|MASTER)/i.test(text) ? 'card' : null;

  return { amount, date: parseDate(text, now), merchant, method, text: raw };
}

/** 인식률을 높이기 위해 크기 조정 + 흑백 변환 */
export async function prepareImage(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const target = 2000;
  const scale = Math.min(2, target / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, w, h);

  // 그림자·조명 얼룩 제거: 주변 평균보다 어두운 픽셀만 글자로 보는 국소 이진화 (적분영상)
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  const g = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = (px[p] * 0.299 + px[p + 1] * 0.587 + px[p + 2] * 0.114) | 0;
  const W = w + 1;
  const integ = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += g[y * w + x]; integ[(y + 1) * W + x + 1] = integ[y * W + x + 1] + row; }
  }
  const r = Math.max(12, Math.round(Math.min(w, h) / 24));
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const sum = integ[y1 * W + x1] - integ[y0 * W + x1] - integ[y1 * W + x0] + integ[y0 * W + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const v = g[y * w + x] < mean * 0.86 ? 0 : 255;
      const p = (y * w + x) * 4;
      px[p] = px[p + 1] = px[p + 2] = v; px[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('이미지 변환 실패'))), 'image/png'));
}

export async function readReceipt(file: File, onProgress?: (msg: string) => void, psm = '4'): Promise<ReceiptResult> {
  onProgress?.('이미지 준비 중…');
  const img = await prepareImage(file);
  onProgress?.('인식 엔진 불러오는 중… (처음엔 시간이 걸려요)');
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(['kor', 'eng'], 1, {
    logger: m => { if (m.status === 'recognizing text') onProgress?.(`글자 읽는 중… ${Math.round(m.progress * 100)}%`); },
  });
  try {
    // 영수증은 한 줄에 '항목 ... 금액'이 이어지는 단일 단 구조라 줄 단위 인식(PSM 4)이 유리
    await worker.setParameters({ tessedit_pageseg_mode: psm as never, preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(img);
    return parseReceipt(data.text);
  } finally {
    await worker.terminate();
  }
}
