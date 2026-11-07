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
  // 실제 영수증 사진의 OCR 결과(깨진 글자 포함)를 줄여서 옮긴 회귀 테스트
  it('실제 OCR: 메가커피 — 합계 글자가 깨지고 상품권 4,000원이 함께 있어도 합계 5,800', () => {
    const r = parseReceipt(`주문(대기)빈호]
262
HMC HT 의왕고천파크루체점
777-18-02175 dl Ae 1502 온종미
2026-11-07 13:31(&)  P0S:02 BILL:  XXXKKX
부가세 과세 물품가액]  5,273
부      가     세:            527
합        Al:               5,800
er = =e:               5,800
wit 2 =2     :              5, 800
2. ga                      4,000
[승 인 2 액]                4,000`, now);
    expect(r.amount).toBe(5800);
    expect(r.date).toBe('2026-11-07');
    expect(r.merchant).toContain('의왕고천파크루체점');
  });
  it('실제 OCR: 다이소 — 판매 합계, 쉼표 뒤 공백, 과세 합계 제외', () => {
    const r = parseReceipt(`POS 7178740] 2026.11.04 11:07:35
일본제 냄잠고 SEEM 2 1,500 1 1,500
과세 합계 13,183
9판매 합계                   14, 500
음인금맥 14, 500`, now);
    expect(r.amount).toBe(14500);
    expect(r.date).toBe('2026-11-04');
  });
  it('실제 OCR: 빙빙아이스 — 합계금액, 8자리 날짜', () => {
    const r = parseReceipt(`[영수증] 빙빙아이스 고천1호점
20261105 20:35:06       [POS 01-0090]
합계금액                    3,800
과세물품가액      3,455
받을금액 3,800`, now);
    expect(r.amount).toBe(3800);
    expect(r.date).toBe('2026-11-05');
    expect(r.merchant).toBe('빙빙아이스 고천1호점');
  });
  it('실제 OCR: 이마트 — 합계와 결제대상금액', () => {
    const r = parseReceipt(`이마트 의왕점 (031)8063-1234
[구 매]2026-11-04 12:03    POS: 7907-4574
(*)면세 물품 9,980
과세 물품 9,982
부 가 세 998
합 계 20,960
결제대상금액 20,960`, now);
    expect(r.amount).toBe(20960);
    expect(r.merchant).toBe('이마트 의왕점');
  });
  it('결제금액이 있으면 합계보다 결제금액을 우선 (할인 반영)', () => {
    const r = parseReceipt(`GS THE FRESH
2026/10/17[토] 16:22
총합계 9,130원
할인총금액 -2,050
결제금액 7,080원
신용카드 7,080원
결제 후 잔액: 297,520`, now);
    expect(r.amount).toBe(7080);
    expect(r.date).toBe('2026-10-17');
  });
  it('정상가 합계·할인가 합계는 총액 후보에서 제외, 결제금액 우선', () => {
    const r = parseReceipt(`Date : 2026-11-06 11:54:54
정상가 합계 51,800
할인가 합계 -12,000
결제금액 39,800
현금 39,800`, now);
    expect(r.amount).toBe(39800);
    expect(parseReceipt('정상가 합계 51,800\n할인가 합계 -12,000\n현금 39,800', now).amount).not.toBe(51800);
  });
  it('실제 OCR: 결제금액 글자가 깨져도 합계 − 할인 계산으로 복원 (51,800 − 12,000)', () => {
    const r = parseReceipt(`Date       i 2026-11-06 11:54: 94  POS +
제품명               수량  판매금액
ON Air 립 세트               ㅣ 25,900
MKHOUI3403 BEP 150 ~ 할인금액 _ -6, 000
점삼가 합계                     51, 800
할인가 합계                    -12, 000
g EE:                      3,60
=  가                     36, 182
더  가 세                     3, 618
8, 800`, now);
    expect(r.amount).toBe(39800);
    expect(r.date).toBe('2026-11-06');
  });
  it('2자리 연도와 잘못된 날짜 처리', () => {
    expect(parseReceipt('26/11/06 합계 1,000', now).date).toBe('2026-11-06');
    expect(parseReceipt('2026-13-45 합계 1,000', now).date).toBe('');
  });
});
