import { describe, expect, it } from 'vitest';
import { parseReceipt } from './receipt';

const now = new Date('2026-11-07T00:00:00');

describe('영수증 텍스트 파싱', () => {
  it('일반 영수증: 합계·날짜·상호', () => {
    const r = parseReceipt(`행복마트 의왕점
사업자번호 123-45-67890
전화 031-123-4567
2026-11-05 18:32
우유 2,500
라면 4,300
과세물품가액 6,182
부가세 618
합 계 6,800
신용카드 승인 6,800원`, now);
    expect(r.amount).toBe(6800);
    expect(r.date).toBe('2026-11-05');
    expect(r.merchant).toBe('행복마트 의왕점');
    expect(r.method).toBe('card');
  });
  it('결제금액 키워드가 다음 줄에 있어도 인식', () => {
    const r = parseReceipt(`상호: 맛있는식당
2026.11.03
결제금액
23,000`, now);
    expect(r.amount).toBe(23000);
    expect(r.merchant).toBe('맛있는식당');
    expect(r.date).toBe('2026-11-03');
  });
  it('키워드 없으면 전화번호를 제외한 최대 금액', () => {
    const r = parseReceipt(`카페A
TEL 02-1234-5678
아메리카노 4,500
라떼 5,000`, now);
    expect(r.amount).toBe(5000);
  });
  it('OCR 오인식된 합계 키워드도 허용', () => {
    expect(parseReceipt('한 계   12,400\n', now).amount).toBe(12400);
    expect(parseReceipt('함계 12,400', now).amount).toBe(12400);
    expect(parseReceipt('결제금액(부가세 포함) 15,000원', now).amount).toBe(15000);
    expect(parseReceipt('받을금액 : 9,900', now).amount).toBe(9900);
  });
  it('키워드가 전혀 없으면 반복되는 큰 금액 우선', () => {
    const r = parseReceipt('카페B\n아메리카노 4,500\n라떼 5,000\n9,500\n9,500', now);
    expect(r.amount).toBe(9500);
  });
  it('2자리 연도와 잘못된 날짜 처리', () => {
    expect(parseReceipt('26/11/06 합계 1,000', now).date).toBe('2026-11-06');
    expect(parseReceipt('2026-13-45 합계 1,000', now).date).toBe('');
  });
});
