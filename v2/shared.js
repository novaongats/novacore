/* ============================================================
   NOVA Core v2 — Shared constants, formatters, helpers
   Pure functions only. No side effects on import.
   ============================================================ */

import dayjs from 'https://esm.sh/dayjs@1.11.10';
import customParseFormat from 'https://esm.sh/dayjs@1.11.10/plugin/customParseFormat';
import localeData from 'https://esm.sh/dayjs@1.11.10/plugin/localeData';
import 'https://esm.sh/dayjs@1.11.10/locale/ja';

dayjs.extend(customParseFormat);
dayjs.extend(localeData);
dayjs.locale('ja');

export { dayjs };

// ---- Departments -----------------------------------------------------------
// 事業（部門）は Firestore `salesDepts` コレクションで動的に管理する
// （購読・シード・フックは depts.js）。ここはそのキャッシュ層と、
// Firestore 未接続時の静的フォールバック。
// boat（競艇）/food（飲食）は archived として初期シードされ、新規入力の
// 選択肢から消えるが、過去データの表示・集計には残る。

export const SALES_DEPTS = [
  { key: 'sns',     label: 'SNS事業',       color: '#6366f1', short: 'SNS',  order: 1 },
  { key: 'content', label: '制作コンテンツ', color: '#7c3aed', short: '制作', order: 2 },
  { key: 'boat',    label: '競艇事業',       color: '#e11d48', short: '競艇', order: 3, archived: true },
  { key: 'food',    label: '飲食事業',       color: '#059669', short: '飲食', order: 4, archived: true },
  { key: 'other',   label: 'その他',         color: '#64748b', short: '他',   order: 5 },
];

export const DEPT_MAP = Object.fromEntries(SALES_DEPTS.map(d => [d.key, d]));

// --- 動的キャッシュ（depts.js が Firestore 購読で更新する）---
let _depts = SALES_DEPTS;
const _deptListeners = new Set();

export function setDepts(list) {
  _depts = (Array.isArray(list) && list.length) ? list : SALES_DEPTS;
  for (const fn of _deptListeners) { try { fn(_depts); } catch { /* noop */ } }
}
export function getDepts({ includeArchived = true } = {}) {
  return includeArchived ? _depts : _depts.filter(d => !d.archived);
}
export function onDeptsChange(fn) {
  _deptListeners.add(fn);
  return () => _deptListeners.delete(fn);
}

export function deptLabel(key) {
  return _depts.find(d => d.key === key)?.label || DEPT_MAP[key]?.label || key || '-';
}
export function deptColor(key) {
  return _depts.find(d => d.key === key)?.color || DEPT_MAP[key]?.color || '#64748b';
}

// ---- Expense accounts (for cost sheets and cashbook) -----------------------

export const EXPENSE_ACCOUNTS = [
  { key: 'outsource',    label: '外注費'       },
  { key: 'tools',        label: 'ツール費'     },
  { key: 'commission',   label: '支払手数料'   },
  { key: 'materials',    label: '材料費'       },
  { key: 'purchase',     label: '仕入'         },
  { key: 'utilities',    label: '水道光熱費'   },
  { key: 'rent',         label: '地代家賃'     },
  { key: 'supplies',     label: '消耗品費'     },
  { key: 'welfare',      label: '福利厚生費'   },
  { key: 'legalWelfare', label: '法定福利費'   },
  { key: 'shipping',     label: '荷造運賃'     },
  { key: 'advertising',  label: '広告宣伝費'   },
  { key: 'communication',label: '通信費'       },
  { key: 'salary',       label: '給料・賞与'   },
  { key: 'labor',        label: '人件費'       },
  { key: 'depreciation', label: '減価償却費'   },
  { key: 'vehicle',      label: '車両費'       },
  { key: 'insurance',    label: '保険料'       },
  { key: 'misc',         label: '雑費'         },
];

export const ACCT_MAP = Object.fromEntries(EXPENSE_ACCOUNTS.map(a => [a.key, a]));
export function accountLabel(key) { return ACCT_MAP[key]?.label || key || '-'; }

// ---- Formatters ------------------------------------------------------------

/** Format integer as Japanese yen string. */
export function formatYen(n) {
  const v = Number(n);
  if (!isFinite(v)) return '¥0';
  return '¥' + Math.round(v).toLocaleString('ja-JP');
}

/** Format integer as thousands-separated number. */
export function formatNum(n) {
  const v = Number(n);
  if (!isFinite(v)) return '0';
  return Math.round(v).toLocaleString('ja-JP');
}

/** Format ratio (0..1) as percentage. */
export function formatPct(n, digits = 1) {
  const v = Number(n);
  if (!isFinite(v)) return '0%';
  return (v * 100).toFixed(digits) + '%';
}

// ---- Date helpers ----------------------------------------------------------

/** Today as YYYY-MM-DD (local). */
export function today() {
  return dayjs().format('YYYY-MM-DD');
}

/** Current month as YYYY-MM (local). */
export function thisMonth() {
  return dayjs().format('YYYY-MM');
}

/** "YYYY-MM" → "2026年4月" */
export function monthLabel(ym) {
  if (!ym) return '';
  const d = dayjs(ym + '-01');
  return d.isValid() ? d.format('YYYY年M月') : ym;
}

/** "YYYY-MM-DD" → "M/D(水)" */
export function shortDateLabel(date) {
  if (!date) return '';
  const d = dayjs(date);
  return d.isValid() ? d.format('M/D(dd)') : date;
}

/** Add months to "YYYY-MM" and return new "YYYY-MM". */
export function addMonths(ym, delta) {
  return dayjs(ym + '-01').add(delta, 'month').format('YYYY-MM');
}

/** Get last N months ending at ym (inclusive). */
export function lastNMonths(ym, n) {
  const base = dayjs(ym + '-01');
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(base.subtract(i, 'month').format('YYYY-MM'));
  }
  return out;
}

/** Days difference: (target - today). Negative = overdue. */
export function daysUntil(dateStr) {
  const d = dayjs(dateStr);
  if (!d.isValid()) return null;
  return d.diff(dayjs().startOf('day'), 'day');
}

// ---- Misc ------------------------------------------------------------------

/** Short URL-safe random id. */
export function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Sum a numeric field over an array. */
export function sumBy(arr, fn) {
  let total = 0;
  for (const x of arr) total += Number(fn(x)) || 0;
  return total;
}

/** Group array by key function → Map. */
export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

/** Defensive: always return array. */
export function asArray(v) { return Array.isArray(v) ? v : []; }

// ---- CSV -------------------------------------------------------------------

/**
 * CSV セルの共通エスケープ。
 * - カンマ・引用符・改行を含むセルは quote + "" エスケープ
 * - `=` `+` `@` 始まりは Excel が数式として評価するため `'` を前置して無害化
 *   （数値は Number のまま渡せば影響なし）
 */
export function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  let s = String(v);
  if (/^[=+@]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** 2次元配列 → CSV 文字列（BOM 付き、Excel で文字化けしない）。 */
export function toCsv(rows) {
  return '\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}

/** テキストをファイルとしてダウンロードさせる。 */
export function downloadTextFile(text, filename, mime = 'text/csv') {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
