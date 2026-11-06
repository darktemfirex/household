export type Method = 'card' | 'cash';

export interface Expense {
  id: string; kind: 'expense'; date: string; amount: number;
  category: string; memo: string; method: Method; who: string; createdAt: number;
}
export interface Income {
  id: string; kind: 'income'; date: string; amount: number;
  title: string; who: string; createdAt: number;
}
export interface Fixed {
  id: string; kind: 'fixed'; name: string; amount: number;
  day: number; method: Method; active: boolean; createdAt: number;
}
export interface Settings {
  id: 'settings'; kind: 'settings';
  salary: number; salaryDay: number; cardStartDay: number; savingGoal: number; updatedAt: number;
}
export type Item = Expense | Income | Fixed | Settings;

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings', kind: 'settings', salary: 0, salaryDay: 21, cardStartDay: 14, savingGoal: 0, updatedAt: 0,
};

export const CATEGORIES = ['식비', '카페/간식', '교통', '쇼핑', '생활', '의료', '육아/교육', '문화/여가', '경조사', '기타'];
