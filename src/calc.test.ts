import { describe, expect, it } from 'vitest';
import { cycleKeyOf, cycleRange, shiftKey, summarize } from './calc';
import { DEFAULT_SETTINGS, type Item } from './types';

describe('카드 주기 (14일~다음달 13일)', () => {
  it('13일까지는 당월 주기, 14일부터는 다음 주기', () => {
    expect(cycleKeyOf('2026-11-13', 14)).toBe('2026-11');
    expect(cycleKeyOf('2026-11-14', 14)).toBe('2026-12');
    expect(cycleKeyOf('2026-12-14', 14)).toBe('2027-01');
    expect(cycleKeyOf('2026-01-01', 14)).toBe('2026-01');
  });
  it('주기 범위', () => {
    expect(cycleRange('2026-11', 14)).toEqual({ start: '2026-10-14', end: '2026-11-13' });
    expect(cycleRange('2027-01', 14)).toEqual({ start: '2026-12-14', end: '2027-01-13' });
    expect(cycleRange('2026-03', 14)).toEqual({ start: '2026-02-14', end: '2026-03-13' });
  });
  it('shiftKey', () => {
    expect(shiftKey('2026-01', -1)).toBe('2025-12');
    expect(shiftKey('2026-12', 1)).toBe('2027-01');
  });
});

describe('summarize', () => {
  const s = { ...DEFAULT_SETTINGS, salary: 4000000, savingGoal: 500000 };
  const items: Item[] = [
    { id: 'f1', kind: 'fixed', name: '월세', amount: 800000, day: 25, method: 'cash', active: true, createdAt: 0 },
    { id: 'f2', kind: 'fixed', name: '통신비', amount: 100000, day: 10, method: 'card', active: true, createdAt: 0 },
    { id: 'e1', kind: 'expense', date: '2026-10-20', amount: 300000, category: '식비', memo: '', method: 'card', who: '나', createdAt: 0 },
    { id: 'e2', kind: 'expense', date: '2026-11-13', amount: 50000, category: '식비', memo: '', method: 'cash', who: '나', createdAt: 0 },
    { id: 'e3', kind: 'expense', date: '2026-11-14', amount: 999999, category: '식비', memo: '', method: 'card', who: '나', createdAt: 0 },
  ];
  it('14일에 이전 사용액이 새 주기에서 초기화된다', () => {
    const cur = summarize(items, s, '2026-11', '2026-11-06');
    expect(cur.cardVariable).toBe(300000);
    const next = summarize(items, s, '2026-12', '2026-11-14');
    expect(next.cardVariable).toBe(999999);
  });
  it('고정수익을 여러 개 등록하면 합산된다', () => {
    const multi: Item[] = [
      ...items,
      { id: 'i1', kind: 'fixedIncome', name: '월급', amount: 3000000, day: 21, active: true, createdAt: 0 },
      { id: 'i2', kind: 'fixedIncome', name: '아내 월급', amount: 2000000, day: 25, active: true, createdAt: 0 },
      { id: 'i3', kind: 'fixedIncome', name: '중지', amount: 999, day: 1, active: false, createdAt: 0 },
    ];
    const r = summarize(multi, s, '2026-11', '2026-11-06');
    expect(r.fixedIncome).toBe(5000000);
    expect(r.fixedIncomes.map(f => f.name)).toEqual(['월급', '아내 월급']);
  });
  it('카드 한도/잔액/일일 사용가능액', () => {
    const r = summarize(items, s, '2026-11', '2026-11-06');
    expect(r.cardBudget).toBe(4000000 - 800000 - 50000 - 500000);
    expect(r.cardUsed).toBe(400000);
    expect(r.cardRemaining).toBe(r.cardBudget - 400000);
    expect(r.daysLeft).toBe(8);
  });
});
