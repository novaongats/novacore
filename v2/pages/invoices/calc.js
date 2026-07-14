/* ============================================================
   NOVA Core v2 — Invoices / Shared calculations & constants
   ============================================================ */

import { runTransaction, doc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { db } from '../../firebase.js';
import { isDevBypass } from '../../auth.js';

export const DOC_TYPES = [
  { id: 'invoice',  label: '請求書', prefix: 'INV', color: '#6366f1' },
  { id: 'receipt',  label: '領収書', prefix: 'REC', color: '#059669' },
  { id: 'quote',    label: '見積書', prefix: 'QUO', color: '#d97706' },
  { id: 'delivery', label: '納品書', prefix: 'DEL', color: '#0891b2' },
];
export const DOC_TYPE_MAP = Object.fromEntries(DOC_TYPES.map(t => [t.id, t]));

export const TAX_TYPES = [
  { id: '10', label: '10%' },
  { id: '8',  label: '8%（軽減）' },
  { id: 'nt', label: '非課税' },
];

export const STATUSES = [
  { id: 'draft',  label: '下書き', color: '#94a3b8' },
  { id: 'issued', label: '発行済', color: '#6366f1' },
  { id: 'paid',   label: '入金済', color: '#10b981' },
  { id: 'void',   label: '取消',   color: '#ef4444' },
];
export const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.id, s]));
// 旧データ互換: 'cancelled' は 'void'（取消）と同義に扱う
STATUS_MAP.cancelled = STATUS_MAP.void;

/**
 * Calculate totals from a list of items.
 * Each item: { quantity, unitPrice, taxType: '10'|'8'|'nt', taxIncluded }
 *
 * インボイス制度（適格請求書）要件:
 *   消費税の端数処理は「税率ごとに1回」だけ行う（明細行ごとの丸め合算は不可）。
 *   端数処理の方法は事業者の任意選択だが、本システムは【切捨て(Math.floor)】を
 *   既定とし固定する。
 *
 * Returns（後方互換: subtotal / tax10 / tax8 / taxAmount / total は従来通り）:
 *   {
 *     subtotal,   // 税抜合計（非課税分を含む）
 *     tax10, tax8, taxAmount, total,
 *     byRate: {   // 税率別内訳。'0' は非課税（課税区分外）
 *       '10': { net, tax, gross },
 *       '8':  { net, tax, gross },
 *       '0':  { net, tax: 0, gross },
 *     },
 *   }
 */
export function calcTotals(items) {
  // 税率ごとの集計: excl = 税抜入力行の合計, incl = 税込入力行の合計
  const buckets = {
    '10': { excl: 0, incl: 0 },
    '8':  { excl: 0, incl: 0 },
    '0':  { excl: 0, incl: 0 },
  };

  for (const it of items || []) {
    const qty   = Number(it.quantity)  || 0;
    const price = Number(it.unitPrice) || 0;
    const line  = Math.round(qty * price);
    if (!line) continue;

    const rate = it.taxType === '8' ? '8' : it.taxType === '10' ? '10' : '0';
    if (rate === '0') {
      buckets['0'].excl += line;           // 非課税: 税込/税抜の区別なし
    } else if (it.taxIncluded) {
      buckets[rate].incl += line;
    } else {
      buckets[rate].excl += line;
    }
  }

  const byRate = {};
  let subtotal = 0, taxAmount = 0, total = 0;

  for (const rateKey of ['10', '8', '0']) {
    const { excl, incl } = buckets[rateKey];
    const r = Number(rateKey);
    // 端数処理はここで税率ごとに1回だけ（切捨て）
    const taxFromExcl = r ? Math.floor(excl * r / 100) : 0;
    const taxFromIncl = r ? Math.floor(incl * r / (100 + r)) : 0;
    const tax   = taxFromExcl + taxFromIncl;
    const net   = excl + (incl - taxFromIncl);
    const gross = net + tax;
    byRate[rateKey] = { net, tax, gross };
    subtotal  += net;
    taxAmount += tax;
    total     += gross;
  }

  return {
    subtotal,
    tax10: byRate['10'].tax,
    tax8:  byRate['8'].tax,
    taxAmount,
    total,
    byRate,
  };
}

/**
 * Allocate the next document number atomically via a Firestore transaction.
 * Format: {PREFIX}-{YEAR}-{NNN}
 *
 * - カウンターは `counters/{型}_{年}` ドキュメントの { lastSeq } を
 *   runTransaction でインクリメント（並行採番でも重複しない）。
 * - 年は発行日（issueDate）の年を使う（今日の日付ではない）。
 * - 失敗時のフォールバックは行わない — 例外を呼び出し元へ伝播させ、
 *   保存を中断してエラー表示する（黙って -001 に戻さない）。
 * - void（取消）は物理削除しないため、採番済み番号が再利用されることはない。
 */
export async function allocateDocNumber(type, issueDate) {
  if (isDevBypass()) {
    throw new Error('デモモード中は採番できません（UI確認のみ）');
  }
  const prefix = DOC_TYPE_MAP[type]?.prefix || 'DOC';
  const y = parseInt(String(issueDate || '').slice(0, 4), 10);
  const year = (y >= 2000 && y <= 2100) ? y : new Date().getFullYear();
  const counterRef = doc(db, 'counters', `${type}_${year}`);

  const seq = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const last = snap.exists() ? (Number(snap.data().lastSeq) || 0) : 0;
    const next = last + 1;
    tx.set(counterRef, { lastSeq: next }, { merge: true });
    return next;
  });

  return `${prefix}-${year}-${String(seq).padStart(3, '0')}`;
}
