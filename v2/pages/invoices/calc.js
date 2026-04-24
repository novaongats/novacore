/* ============================================================
   NOVA Core v2 — Invoices / Shared calculations & constants
   ============================================================ */

import { where } from '../../store.js';

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
  { id: 'draft',     label: '下書き', color: '#94a3b8' },
  { id: 'issued',    label: '発行済', color: '#6366f1' },
  { id: 'paid',      label: '入金済', color: '#10b981' },
  { id: 'cancelled', label: '取消',   color: '#ef4444' },
];
export const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.id, s]));

/**
 * Calculate totals from a list of items.
 * Each item: { quantity, unitPrice, taxType: '10'|'8'|'nt', taxIncluded }
 */
export function calcTotals(items) {
  let subtotal = 0;  // net (tax-exclusive) subtotal
  let tax10 = 0;
  let tax8  = 0;

  for (const it of items || []) {
    const qty   = Number(it.quantity)  || 0;
    const price = Number(it.unitPrice) || 0;
    const gross = Math.round(qty * price);
    if (!gross) continue;

    if (it.taxIncluded) {
      // Price already includes tax; extract net + tax.
      if (it.taxType === '8') {
        const net = Math.round(gross / 1.08);
        subtotal += net;
        tax8 += gross - net;
      } else if (it.taxType === '10') {
        const net = Math.round(gross / 1.10);
        subtotal += net;
        tax10 += gross - net;
      } else {
        subtotal += gross;
      }
    } else {
      subtotal += gross;
      if (it.taxType === '8')  tax8  += Math.round(gross * 0.08);
      else if (it.taxType === '10') tax10 += Math.round(gross * 0.10);
    }
  }

  const taxAmount = tax10 + tax8;
  return {
    subtotal,
    tax10,
    tax8,
    taxAmount,
    total: subtotal + taxAmount,
  };
}

/**
 * Compute next document number for a given type.
 * Format: {PREFIX}-{YEAR}-{NNN}
 *
 * Strategy: load docs of this type (single-field index, auto-created),
 * filter by current year, take max+1.
 */
export async function nextDocNumber(repo, type) {
  const prefix = DOC_TYPE_MAP[type]?.prefix || 'DOC';
  const year = new Date().getFullYear();
  const yearPattern = `${prefix}-${year}-`;

  let max = 0;
  try {
    const docs = await repo.list(where('type', '==', type));
    for (const d of docs) {
      const n = (d.docNumber || '');
      if (!n.startsWith(yearPattern)) continue;
      const tail = parseInt(n.slice(yearPattern.length), 10);
      if (tail > max) max = tail;
    }
  } catch (e) {
    console.warn('[invoices] nextDocNumber: list failed, fallback to 001', e);
  }
  return `${prefix}-${year}-${String(max + 1).padStart(3, '0')}`;
}
