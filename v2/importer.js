/* ============================================================
   NOVA Core v2 — Legacy JSON importer
   Maps v1 localStorage shape → v2 Firestore collections.

   Design notes
   ------------
   - Each entry in MAP declares `{ repo, priority?, transform }`.
   - `transform(legacyValue)` returns Array<Doc>; every Doc must carry `id`.
   - Fallback ids are generated via genId() (crypto.randomUUID where available).
   - Jobs are executed in priority order (lower first) so parents (categories,
     clients, …) land before their children.
   ============================================================ */

import { repos } from './store.js';
import { writeBatch, doc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { db } from './firebase.js';

// Firestore batch limit
const BATCH_SIZE = 400;

// ---- Helpers ---------------------------------------------------------------

function toNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function toArray(v) {
  return Array.isArray(v) ? v : [];
}
// Preserve short alias used historically in this file.
const arr = toArray;

function nonEmptyId(v, fallback) {
  const s = String(v ?? '').trim();
  return s || fallback;
}

/** Cryptographically random id suffix; falls back on older browsers. */
function genId(prefix = '') {
  const raw = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, '')
    : (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
  return prefix + raw.slice(0, 12);
}

/** Stable non-cryptographic hash (djb2-like) for content-addressable ids. */
function hashString(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  // Force unsigned 32-bit for consistent base36 output.
  return (h >>> 0).toString(36);
}

/** Normalize an id produced from content fields. Returns empty string if all fields are blank. */
function contentId(prefix, ...fields) {
  const joined = fields.map(x => String(x ?? '').trim()).join('|');
  if (!joined.replace(/\|/g, '')) return '';
  return prefix + hashString(joined);
}

/**
 * Legacy export files come in a few shapes:
 *   - bucketed:     { bucket: 'all',  core: {...}, ancore: {...}, ... }
 *   - single-bucket:{ bucket: 'core', data: {...} }
 *   - raw:          { nova_st3_daily: [...], ... }
 */
function unwrapLegacy(legacyJson) {
  if (!legacyJson || typeof legacyJson !== 'object') return {};
  if (legacyJson.data && typeof legacyJson.data === 'object') return legacyJson.data;
  if (legacyJson.core && typeof legacyJson.core === 'object') return legacyJson.core;
  return legacyJson;
}

// ---- Legacy key → Firestore mapping ---------------------------------------
// Each entry describes how to transform v1 data into v2 documents.
//
//   { repo:       target repo from store.js
//     priority:   lower runs first (parents before children). Default 50.
//     transform:  (legacyValue) => Array<Doc>  // each doc must have `id`
//   }
//
// Note on the `...rest, id: …` pattern: the spread must come BEFORE the `id`
// field so the locally-computed id wins over any stale/empty id inside the
// legacy record. (Putting `id` before `...rest` lets `rest.id = ''` silently
// blank out the generated fallback.)

const MAP = {
  // --- Sales ----------------------------------------------------------------

  // Tracker categories (master).
  // v1 marks soft-deleted categories with `_deleted` — skip them on import.
  nova_st3_cats: {
    repo: 'salesCategories',
    priority: 10,
    transform: (items) => arr(items)
      .filter(c => c && !c._deleted && !c.deleted)
      .map(c => ({
        name:      c.name || '',
        dept:      c.dept || 'other',
        group:     c.group || '',
        staffId:   c.staffId || '',
        inputType: c.inputType || 'monthly',
        revShare:  c.revShare || null,
        id: nonEmptyId(c.id, genId('cat_')),
      })),
  },

  // Daily sales entries.
  // v1 soft-deletes rows with a `_deleted` timestamp. salesGetMonthData() in v1
  // filters them out before aggregating — v2 must do the same, otherwise
  // deleted rows are silently resurrected and inflate monthly totals.
  nova_st3_daily: {
    repo: 'salesEntries',
    priority: 50,
    transform: (items) => arr(items)
      .filter(d => d && !d._deleted && !d.deleted)
      .map(d => ({
        date:   d.date,
        catId:  d.catId,
        amount: toNum(d.amount),
        memo:   d.note || '',
        source: 'tracker-legacy',
        legacyCreated: d.created || null,
        id: nonEmptyId(d.id, genId('e_')),
      })),
  },

  // Monthly cost sheets (keyed by yearMonth + catId).
  nova_st3_costs: {
    repo: 'salesCosts',
    priority: 50,
    transform: (items) => arr(items)
      .filter(c => c && c.yearMonth && c.catId)
      .map(c => ({
        yearMonth: c.yearMonth,
        catId:     c.catId,
        items:     arr(c.items).map(i => ({
          type:   i.type || 'misc',
          amount: toNum(i.amount),
          note:   i.note || '',
        })),
        id: `${c.yearMonth}_${c.catId}`,
      })),
  },

  // Legacy manual sales entries (pre-tracker). Keep only truly manual ones.
  nova_sales: {
    repo: 'salesEntries',
    priority: 50,
    transform: (items) => arr(items)
      .filter(r => r && (!r.source || r.source === 'manual'))
      .map(r => ({
        date:   r.date,
        amount: toNum(r.amount),
        memo:   r.memo || '',
        dept:   r.dept || 'other',
        type:   r.type || 'revenue',
        source: 'manual-legacy',
        legacyCreated: r.created || null,
        id: nonEmptyId(r.id, genId('s_legacy_')),
      })),
  },

  // --- Cashbook (現金出納帳 + 領収書AI仕分 統合) ----------------------------

  'expense-tracker-data-v2': {
    repo: 'cashbook',
    priority: 50,
    transform: (obj) => arr(obj && obj.expenses).map(e => ({
      date:       e.date,
      vendor:     e.vendor || '',
      category:   e.category || '',
      amount:     toNum(e.amount),
      reducedTax: !!e.reducedTax,
      hasInvoice: !!e.hasInvoice,
      source:     'manual-legacy',
      id: nonEmptyId(e.id, genId('cb_')),
    })),
  },

  rcpt_history: {
    repo: 'cashbook',
    priority: 50,
    transform: (items) => arr(items).map(r => ({
      date:          r.date,
      vendor:        r.vendor || '',
      category:      r.category || '',
      amount:        toNum(r.amount),
      reducedTax:    Number(r.tax_rate) === 8,
      hasInvoice:    !!r.invoice_number,
      dept:          r.department || '',
      memo:          r.items || '',
      invoiceNumber: r.invoice_number || '',
      confidence:    toNum(r.confidence),
      source:        'ai-legacy',
      id: nonEmptyId(r.id, genId('rcpt_')),
    })),
  },

  rcpt_accounts: {
    repo: 'cashbookAccounts',
    priority: 10,
    transform: (names) => arr(names).map((name, i) => ({
      name,
      order: i,
      // Content-addressable id keeps re-imports stable regardless of array order.
      id: contentId('acct_', name) || ('acct_' + i),
    })),
  },

  rcpt_depts: {
    repo: 'cashbookDepts',
    priority: 10,
    transform: (names) => arr(names).map((name, i) => ({
      name,
      order: i,
      id: contentId('dept_', name) || ('dept_' + i),
    })),
  },

  // --- Invoices -------------------------------------------------------------

  invoice_history: {
    repo: 'invoices',
    priority: 50,
    transform: (items) => arr(items).map(inv => ({
      ...inv,
      id: nonEmptyId(inv.id, genId('inv_')),
    })),
  },

  client_master: {
    repo: 'invoiceClients',
    priority: 10,
    transform: (items) => arr(items).map((c, i) => {
      const company = c.companyName || c.company || '';
      const contact = c.contactName || c.name || '';
      return {
        ...c,
        companyName: company,
        contactName: contact,
        // Stable id derived from identifying fields; falls back to index only
        // when no identifying content exists at all.
        id: c.id || contentId('client_', company, contact) || ('client_' + i),
      };
    }),
  },

  bank_master: {
    repo: 'invoiceBanks',
    priority: 10,
    transform: (items) => arr(items).map((b, i) => ({
      ...b,
      id: b.id
        || contentId('bank_', b.bankName || b.name, b.branchName, b.accountNumber)
        || ('bank_' + i),
    })),
  },

  // --- Documents ------------------------------------------------------------

  nova_docs: {
    repo: 'documents',
    priority: 50,
    transform: (items) => arr(items).map(d => ({
      ...d,
      id: nonEmptyId(d.id, genId('doc_')),
    })),
  },

  // --- Payroll --------------------------------------------------------------

  payroll_v2_employees: {
    repo: 'payrollEmployees',
    priority: 10,
    transform: (items) => arr(items).map(e => ({
      ...e,
      id: nonEmptyId(e.id, genId('emp_')),
    })),
  },

  payroll_v2_records: {
    repo: 'payrollRecords',
    priority: 50,
    transform: (items) => arr(items)
      .filter(r => r && (r.month || r.yearMonth) && r.empId)
      .map(r => ({
        ...r,
        month: r.month || r.yearMonth,
        id: `${r.month || r.yearMonth}_${r.empId}`,
      })),
  },

  payroll_v2_bonus: {
    repo: 'payrollBonus',
    priority: 50,
    transform: (items) => arr(items)
      .filter(r => r && (r.month || r.yearMonth) && r.empId)
      .map(r => ({
        ...r,
        month: r.month || r.yearMonth,
        id: `${r.month || r.yearMonth}_${r.empId}`,
      })),
  },

  payroll_v2_rates: {
    repo: 'payrollRates',
    priority: 10,
    transform: (items) => arr(items).map((r, i) => {
      const y = Math.floor(toNum(r.year));
      const m = Math.floor(toNum(r.month));
      const hasYM = y > 0 && m >= 1 && m <= 12;
      return {
        ...r,
        id: hasYM
          ? `${y}-${String(m).padStart(2, '0')}`
          : 'rate_' + i,
      };
    }),
  },

  payroll_v2_health_rates: {
    repo: 'settings',
    priority: 10,
    transform: (obj) => [{
      rates: obj || {},
      id: 'payroll_health_rates',
    }],
  },

  payroll_v2_bank_accounts: {
    repo: 'payrollBankAccounts',
    priority: 10,
    transform: (obj) => Object.entries(obj || {}).map(([empId, acct]) => ({
      ...acct,
      empId,
      id: empId,
    })),
  },
};

// ---- Public API ------------------------------------------------------------

/**
 * Read a legacy export file and produce a preview of what would be imported.
 * Does NOT write to Firestore.
 */
export function previewImport(legacyJson) {
  const top = unwrapLegacy(legacyJson);
  const summary = [];
  for (const [legacyKey, def] of Object.entries(MAP)) {
    if (!(legacyKey in top)) continue;
    let docs;
    try {
      docs = def.transform(top[legacyKey]);
    } catch (e) {
      summary.push({ legacyKey, repo: def.repo, count: 0, error: e.message });
      continue;
    }
    summary.push({
      legacyKey,
      repo: def.repo,
      count: docs.length,
      sample: docs.slice(0, 1),
    });
  }

  // Find unmapped keys (so user knows what's being skipped)
  const unmapped = Object.keys(top).filter(k => !(k in MAP) && top[k] != null);

  return { summary, unmapped };
}

/**
 * Perform the import.
 *
 * @param {object}   legacyJson
 * @param {Function} [onProgress] Callback: ({ phase, current, total, label, key?, error? })
 *                                phase: 'start' | 'write' | 'skip' | 'error' | 'done'
 * @param {object}   [options]
 * @param {boolean}  [options.merge=false] Firestore `merge` option. Default false
 *                                         for clean migrations (full replace); set
 *                                         true for incremental / patching imports.
 * @returns {Promise<{ imported:number, skipped:number, failed:number, errors:Array }>}
 */
export async function runImport(legacyJson, onProgress = () => {}, { merge = false } = {}) {
  const top = unwrapLegacy(legacyJson);

  // Build job list, honoring priority so parents import before children.
  const jobs = [];
  for (const [legacyKey, def] of Object.entries(MAP)) {
    if (!(legacyKey in top)) continue;
    let docs;
    try {
      docs = def.transform(top[legacyKey]);
    } catch (e) {
      console.error('[import] transform failed for', legacyKey, e);
      onProgress({ phase: 'error', key: legacyKey, error: e.message });
      continue;
    }
    if (docs.length === 0) continue;
    jobs.push({ legacyKey, def, docs });
  }
  jobs.sort((a, b) => (a.def.priority ?? 50) - (b.def.priority ?? 50));

  let imported = 0;
  let skipped  = 0;
  let failed   = 0;
  const errors = [];
  const totalDocs = jobs.reduce((n, j) => n + j.docs.length, 0);

  onProgress({ phase: 'start', current: 0, total: totalDocs, label: '開始' });

  for (const job of jobs) {
    const repo = repos[job.def.repo];
    if (!repo) {
      const reason = `repo '${job.def.repo}' not found`;
      errors.push({ key: job.legacyKey, reason });
      failed += job.docs.length;
      onProgress({ phase: 'error', key: job.legacyKey, error: reason });
      continue;
    }

    // Chunk into batches
    for (let i = 0; i < job.docs.length; i += BATCH_SIZE) {
      const chunk = job.docs.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      let written = 0;

      for (const d of chunk) {
        const { id, ...rest } = d;
        if (!id) {
          skipped++;
          errors.push({ key: job.legacyKey, reason: 'empty id', sample: rest });
          continue;
        }
        const docRef = doc(db, repo.name, String(id));
        batch.set(docRef, { ...rest, importedAt: serverTimestamp() }, { merge });
        written++;
      }

      if (written === 0) {
        onProgress({
          phase: 'skip',
          current: imported,
          total: totalDocs,
          label: `${job.def.repo} (chunk skipped)`,
        });
        continue;
      }

      try {
        await batch.commit();
        imported += written;
        onProgress({
          phase: 'write',
          current: imported,
          total: totalDocs,
          label: `${job.def.repo} (${written}件)`,
        });
      } catch (e) {
        failed += chunk.length;
        const reason = e.message || String(e);
        errors.push({ key: job.legacyKey, reason });
        console.error('[import] batch failed for', job.legacyKey, e);
        onProgress({ phase: 'error', key: job.legacyKey, error: reason });
      }
    }
  }

  onProgress({ phase: 'done', current: imported, total: totalDocs, label: '完了' });
  return { imported, skipped, failed, errors };
}

/**
 * Export map for UI: shows what keys are understood.
 */
export function listMappings() {
  return Object.entries(MAP).map(([k, v]) => ({
    legacyKey:  k,
    targetRepo: v.repo,
    priority:   v.priority ?? 50,
  }));
}
