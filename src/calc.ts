import type { Expense, Fixed, FixedIncome, Income, Item, Settings } from './types';

const pad = (n: number) => String(n).padStart(2, '0');
const DAY = 86400000;
const toDate = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const toStr = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export const todayStr = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; };
export const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);

/** 카드 주기 키 = 주기가 끝나는 달(YYYY-MM). 예) 10/14~11/13 → "2026-11" */
export function cycleKeyOf(date: string, startDay: number): string {
  const [y, m, d] = date.split('-').map(Number);
  if (startDay > 1 && d >= startDay) return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
  return `${y}-${pad(m)}`;
}

export function cycleRange(key: string, startDay: number): { start: string; end: string } {
  const [y, m] = key.split('-').map(Number);
  const off = startDay > 1 ? -1 : 0;
  const start = new Date(Date.UTC(y, m - 1 + off, startDay));
  const end = new Date(Date.UTC(y, m + off, startDay) - DAY);
  return { start: toStr(start), end: toStr(end) };
}

export function shiftKey(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** 해당 주기를 결제하는 월급일 = 주기 종료 달의 월급일 (예: 10/14~11/13 주기 ↔ 11/21 월급) */
export function salaryDateOf(key: string, salaryDay: number): string {
  const [y, m] = key.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // 31일 설정 시 짧은 달은 말일로
  return `${y}-${pad(m)}-${pad(Math.min(salaryDay, last))}`;
}

export interface Summary {
  key: string; start: string; end: string;
  fixedIncome: number; fixedIncomes: { name: string; amount: number; date: string; received: boolean }[];
  extraIncome: number; income: number;
  transferFixed: number; cashSpent: number; savingGoal: number;
  cardBudget: number;
  cardVariable: number; cardFixed: number; cardUsed: number;
  cardRemaining: number; usedPct: number;
  daysLeft: number; dailyAllowance: number; isCurrent: boolean; isPast: boolean;
  byCategory: { category: string; amount: number }[];
  expenses: Expense[]; incomes: Income[];
}

export function summarize(items: Item[], s: Settings, key: string, today: string): Summary {
  const { start, end } = cycleRange(key, s.cardStartDay);
  const inRange = (d: string) => d >= start && d <= end;
  const expenses = items.filter((i): i is Expense => i.kind === 'expense' && inRange(i.date));
  const incomes = items.filter((i): i is Income => i.kind === 'income' && inRange(i.date));
  const fixed = items.filter((i): i is Fixed => i.kind === 'fixed' && i.active);

  // 고정수익 항목이 없으면 (이전 버전의) 단일 월급 설정을 사용
  const fi = items.filter((i): i is FixedIncome => i.kind === 'fixedIncome' && i.active);
  const sources = fi.length > 0 || s.salary <= 0 ? fi : [{ name: '월급', amount: s.salary, day: s.salaryDay }];
  const fixedIncomes = sources
    .map(f => { const date = salaryDateOf(key, f.day); return { name: f.name, amount: f.amount, date, received: date <= today }; })
    .sort((a, b) => a.date.localeCompare(b.date));
  const fixedIncome = fixedIncomes.reduce((a, b) => a + b.amount, 0);
  const extraIncome = incomes.reduce((a, b) => a + b.amount, 0);
  const income = fixedIncome + extraIncome;
  const transferFixed = fixed.filter(f => f.method === 'cash').reduce((a, b) => a + b.amount, 0);
  const cardFixed = fixed.filter(f => f.method === 'card').reduce((a, b) => a + b.amount, 0);
  const cashSpent = expenses.filter(e => e.method === 'cash').reduce((a, b) => a + b.amount, 0);
  const cardVariable = expenses.filter(e => e.method === 'card').reduce((a, b) => a + b.amount, 0);
  const cardUsed = cardVariable + cardFixed;
  const cardBudget = income - transferFixed - cashSpent - s.savingGoal;
  const cardRemaining = cardBudget - cardUsed;

  const isCurrent = today >= start && today <= end;
  const isPast = today > end;
  const daysLeft = isCurrent ? daysBetween(today, end) + 1 : 0;

  const cat = new Map<string, number>();
  for (const e of expenses) cat.set(e.category, (cat.get(e.category) ?? 0) + e.amount);
  const byCategory = [...cat].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);

  return {
    key, start, end,
    fixedIncome, fixedIncomes,
    extraIncome, income, transferFixed, cashSpent, savingGoal: s.savingGoal,
    cardBudget, cardVariable, cardFixed, cardUsed, cardRemaining,
    usedPct: cardBudget > 0 ? Math.min(100, Math.round((cardUsed / cardBudget) * 100)) : cardUsed > 0 ? 100 : 0,
    daysLeft, dailyAllowance: daysLeft > 0 ? Math.floor(cardRemaining / daysLeft) : 0,
    isCurrent, isPast, byCategory, expenses, incomes,
  };
}
