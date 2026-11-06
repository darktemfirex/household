/** 원 단위 표기 (소수점 없음) */
export const won = (n: number) => `${n < 0 ? '-' : ''}${Math.abs(Math.round(n)).toLocaleString('ko-KR')}원`;
export const comma = (n: number) => (n ? Math.round(n).toLocaleString('ko-KR') : '');
export const digits = (s: string) => Number(s.replace(/[^0-9]/g, '')) || 0;
export const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const WD = ['일', '월', '화', '수', '목', '금', '토'];
export const mdw = (d: string) => `${md(d)} (${WD[new Date(d + 'T00:00:00').getDay()]})`;
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
