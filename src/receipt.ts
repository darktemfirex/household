import type { Method } from './types';

export interface ReceiptResult {
  amount: number;
  date: string; // YYYY-MM-DD, 못 찾으면 ''
  merchant: string;
  method: Method | null;
  text: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const AMOUNT_KEYS = /(결제\s*금액|승인\s*금액|청구\s*금액|받을\s*금액|받을\s*돈|총\s*결제|합\s*계|총\s*액|총\s*금액|TOTAL|AMOUNT)/i;
const SKIP_LINE = /(영수증|사업자|대표|전화|TEL|주소|승인번호|카드번호|가맹점번호|단말기|거래일|POS|http|www|\d{2,4}-\d{3,4}-\d{4})/i;
const NOT_PAID = /(부가세|부가가치세|과세|면세|세액|공급가|봉사료|할인|포인트|적립|거스름|잔액|받은\s*돈|받은금액)/;

/** 한 줄에서 금액 후보(원 단위 정수) 추출. 콤마 있는 숫자 우선, 없으면 3자리 이상 숫자 */
function numbersIn(line: string): number[] {
  const out: number[] = [];
  for (const m of line.matchAll(/\d{1,3}(?:[,.]\d{3})+|\d{3,9}/g)) {
    const n = Number(m[0].replace(/[,.]/g, ''));
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
  return cands[0] ?? '';
}

export function parseReceipt(raw: string, now = new Date()): ReceiptResult {
  const text = raw.replace(/[ \t]+/g, ' ');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // 금액: 합계/결제금액 등 키워드 줄 → 같은 줄 또는 바로 다음 줄의 숫자
  let amount = 0;
  const keyed: number[] = [];
  lines.forEach((l, i) => {
    if (!AMOUNT_KEYS.test(l) || NOT_PAID.test(l)) return;
    const nums = numbersIn(l);
    if (nums.length) keyed.push(nums[nums.length - 1]);
    else if (lines[i + 1]) { const nx = numbersIn(lines[i + 1]); if (nx.length) keyed.push(nx[nx.length - 1]); }
  });
  if (keyed.length) amount = Math.max(...keyed);
  else {
    // 키워드가 없으면 전화번호·날짜 줄을 뺀 가장 큰 금액
    const all = lines.filter(l => !SKIP_LINE.test(l) && !NOT_PAID.test(l) && !/\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(l)).flatMap(numbersIn);
    if (all.length) amount = Math.max(...all);
  }

  // 가게명: '상호/가맹점' 줄의 값, 없으면 위쪽에서 처음 나오는 한글 줄
  let merchant = '';
  const labeled = lines.find(l => /^(상\s*호|가맹점명?|매장명?)\s*[:：]?\s*\S+/.test(l));
  if (labeled) merchant = labeled.replace(/^(상\s*호|가맹점명?|매장명?)\s*[:：]?\s*/, '');
  else {
    merchant = lines.slice(0, 8).find(l => /[가-힣]{2,}/.test(l) && !SKIP_LINE.test(l) && !AMOUNT_KEYS.test(l) && numbersIn(l).length === 0) ?? '';
  }
  merchant = merchant.replace(/[^\w가-힣 ()&.\-]/g, '').trim().slice(0, 30);

  const method: Method | null = /현금\s*(영수증|결제|승인)|현금$/m.test(text) ? 'cash' : /(카드|신용|체크|승인|VISA|MASTER)/i.test(text) ? 'card' : null;

  return { amount, date: parseDate(text, now), merchant, method, text: raw };
}

/** 인식률을 높이기 위해 크기 조정 + 흑백 변환 */
async function prepareImage(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const target = 1800;
  const scale = Math.min(2, target / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.filter = 'grayscale(1) contrast(1.4)';
  ctx.drawImage(bmp, 0, 0, w, h);
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('이미지 변환 실패'))), 'image/png'));
}

export async function readReceipt(file: File, onProgress?: (msg: string) => void): Promise<ReceiptResult> {
  onProgress?.('이미지 준비 중…');
  const img = await prepareImage(file);
  onProgress?.('인식 엔진 불러오는 중… (처음엔 시간이 걸려요)');
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(['kor', 'eng'], 1, {
    logger: m => { if (m.status === 'recognizing text') onProgress?.(`글자 읽는 중… ${Math.round(m.progress * 100)}%`); },
  });
  try {
    const { data } = await worker.recognize(img);
    return parseReceipt(data.text);
  } finally {
    await worker.terminate();
  }
}
