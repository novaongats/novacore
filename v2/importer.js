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
import { snapToStandard } from './pages/payroll/calc.js';

// Firestore batch limit
const BATCH_SIZE = 400;

// ---- クラウド読込（v1 novaSync の RTDB ミラー） -----------------------------
// v1 は保存のたびに localStorage の JSON 文字列を RTDB `novacore/{fbKey}` へ
// ミラーしている（v1 index.html の novaSync.KEYS と同じ対応表）。
// これを読めば、旧版を使っていたブラウザでなくても移行できる。
// 注意: ミラーの鮮度は「最後に同期が成功した時点」。移行前にプレビューの
// 件数・最新日付を旧版の画面と突き合わせること。

export const CLOUD_DB_URL =
  'https://novacore-65fb5-default-rtdb.asia-southeast1.firebasedatabase.app';

const CLOUD_KEYS = {
  nova_members:              'nova_members',
  nova_st3_cats:             'st3_cats',
  nova_st3_daily:            'st3_daily',
  nova_st3_costs:            'st3_costs',
  nova_sales:                'nova_sales',
  'expense-tracker-data-v2': 'expense_tracker',
  rcpt_history:              'rcpt_history',
  rcpt_accounts:             'rcpt_accounts',
  rcpt_depts:                'rcpt_depts',
  invoice_history:           'invoice_history',
  client_master:             'client_master',
  bank_master:               'bank_master',
  nova_docs:                 'nova_docs',
  payroll_v2_employees:      'payroll_employees',
  payroll_v2_records:        'payroll_records',
  payroll_v2_bonus:          'payroll_bonus',
  payroll_v2_rates:          'payroll_rates',
  payroll_v2_health_rates:   'payroll_health_rates',
  payroll_v2_bank_accounts:  'payroll_bank_accounts',
};

/**
 * RTDB ミラーから旧版データ一式を取得し、previewImport/runImport が
 * そのまま食べられる legacy JSON 形（localStorage キー名）で返す。
 * @returns {Promise<{data: Object, missing: string[]}>}
 */
export async function fetchLegacyFromCloud(onProgress = () => {}) {
  const data = {};
  const missing = [];
  const entries = Object.entries(CLOUD_KEYS);
  let i = 0;
  for (const [legacyKey, fbKey] of entries) {
    onProgress({ current: ++i, total: entries.length, label: fbKey });
    const res = await fetch(`${CLOUD_DB_URL}/novacore/${encodeURIComponent(fbKey)}.json`);
    if (!res.ok) throw new Error(`クラウド読込に失敗 (${fbKey}: HTTP ${res.status})`);
    let v = await res.json();
    if (v == null) { missing.push(fbKey); continue; }
    // novaSync は JSON.stringify した文字列を保存している
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch { missing.push(fbKey); continue; }
    }
    data[legacyKey] = v;
  }
  return { data, missing };
}

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

  // Staff master (担当者マスタ). v1 の nova_members はログイン兼担当者マスタで
  // pass / mustChangePass などの認証フィールドを含む — v2 のログインは
  // Firebase Auth（users コレクション）なので、担当者情報のみを移す。
  // level / pages は v2 の権限体系とは別物のため legacy* として保持のみ。
  nova_members: {
    repo: 'staffMembers',
    priority: 10,
    transform: (items) => arr(items).map(m => ({
      name:        m.name || '',
      role:        m.role || '',
      color:       m.color || '#6366f1',
      legacyLevel: m.level || '',
      legacyPages: arr(m.pages),
      archived:    false,
      id: nonEmptyId(m.id, genId('stf_')),
    })),
  },

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

  // 旧従業員マスタは「チェックボックス + 社保固定額」方式。v2 は
  // 「標準報酬月額 × 料率」方式のため、次の正規化を行う:
  //   - standardRemuneration をそのまま採用。無ければ厚生年金の固定額から
  //     逆算（本人負担 × 2 ÷ 18.3% → 等級表にスナップ。都道府県非依存で最も安全）
  //   - careCheck → careEligible / _archived → archived / parttime → parttime-full
  //   - 旧固定額は legacyAmounts に保持（移行後の突き合わせ確認用）
  payroll_v2_employees: {
    repo: 'payrollEmployees',
    priority: 10,
    transform: (items) => arr(items).map(e => {
      const pensionAmt = toNum(e.pensionAmount);
      const std = toNum(e.standardRemuneration)
        || (pensionAmt > 0 ? snapToStandard(Math.round(pensionAmt * 200 / 18.3)) : 0);
      const type = e.type === 'parttime' ? 'parttime-full' : (e.type || 'regular');
      const out = {
        ...e,
        type,
        stdRemuneration: std,
        careEligible: !!(e.careEligible ?? e.careCheck),
        archived: !!(e.archived ?? e._archived),
        dependents: toNum(e.dependents),
        residentTax: toNum(e.residentTax),
        monthlySalary: toNum(e.monthlySalary),
        hourlyWage: toNum(e.hourlyWage),
        baseHours: toNum(e.baseHours),
        commuteAllowanceMonthly: toNum(e.commuteAllowanceMonthly),
        commuteIsPublicTransport: e.commuteIsPublicTransport !== false,
        legacyAmounts: {
          health: toNum(e.healthAmount),
          pension: pensionAmt,
          care: toNum(e.careAmount),
          childSupport: toNum(e.childSupportAmount),
          healthCheck: !!e.healthCheck,
          pensionCheck: !!e.pensionCheck,
          employmentCheck: !!e.employmentCheck,
        },
        id: nonEmptyId(e.id, genId('emp_')),
      };
      delete out.healthCheck; delete out.pensionCheck; delete out.careCheck;
      delete out.employmentCheck; delete out.healthAmount; delete out.pensionAmount;
      delete out.careAmount; delete out.childSupportAmount;
      delete out.standardRemuneration; delete out._archived; delete out.salary;
      return out;
    }),
  },

  // 旧レコードは grossSalary/netSalary、v2 は gross/net/social。
  payroll_v2_records: {
    repo: 'payrollRecords',
    priority: 50,
    transform: (items) => arr(items)
      .filter(r => r && (r.month || r.yearMonth) && r.empId)
      .map(r => {
        const month = r.month || r.yearMonth;
        const health = toNum(r.health), pension = toNum(r.pension),
              care = toNum(r.care), childSupport = toNum(r.childSupport),
              employment = toNum(r.employment);
        const out = {
          ...r,
          month,
          gross: toNum(r.gross ?? r.grossSalary),
          net:   toNum(r.net ?? r.netSalary),
          social: toNum(r.social) || (health + pension + care + childSupport + employment),
          taxable: toNum(r.taxable ?? r.taxableGross) || null,
          childSupport,
          id: `${month}_${r.empId}`,
        };
        delete out.grossSalary; delete out.netSalary; delete out.taxableGross;
        return out;
      }),
  },

  // 旧賞与は bonusAmt/netAmount、v2 は amount/net/social。
  payroll_v2_bonus: {
    repo: 'payrollBonus',
    priority: 50,
    transform: (items) => arr(items)
      .filter(r => r && (r.month || r.yearMonth) && r.empId)
      .map(r => {
        const month = r.month || r.yearMonth;
        const health = toNum(r.health), pension = toNum(r.pension),
              care = toNum(r.care), childSupport = toNum(r.childSupport),
              employment = toNum(r.employment);
        const out = {
          ...r,
          month,
          amount: toNum(r.amount ?? r.bonusAmt),
          net:    toNum(r.net ?? r.netAmount),
          social: toNum(r.social) || (health + pension + care + childSupport + employment),
          childSupport,
          id: `${month}_${r.empId}`,
        };
        delete out.bonusAmt; delete out.netAmount;
        return out;
      }),
  },

  // 旧料率履歴: [{effectiveDate:'YYYY-MM', employmentEmployee, employmentCompany}]
  // → v2 payrollRates スキーマ（doc id = effectiveDate）へ正規化。
  payroll_v2_rates: {
    repo: 'payrollRates',
    priority: 10,
    transform: (items) => arr(items)
      .map((r, i) => {
        // effectiveDate 形式（旧版標準）と year/month 形式の両対応
        let eff = String(r.effectiveDate || '').trim();
        if (!/^\d{4}-\d{2}$/.test(eff)) {
          const y = Math.floor(toNum(r.year));
          const m = Math.floor(toNum(r.month));
          eff = (y > 0 && m >= 1 && m <= 12) ? `${y}-${String(m).padStart(2, '0')}` : '';
        }
        if (!eff) return null;
        return {
          effectiveDate: eff,
          employmentEmployee: toNum(r.employmentEmployee),
          employmentEmployer: toNum(r.employmentEmployer ?? r.employmentCompany),
          note: '旧NOVACoreから移行',
          source: 'import',
          id: eff,
        };
      })
      .filter(Boolean),
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
  // writeBatch 直叩きのため store.js の guardWrite を通らない。
  // デモモード中に実ログインセッションが残っていると実データへ全置換が
  // 走り得るので、ここでも明示的にブロックする。
  let bypass = false;
  try { bypass = localStorage.getItem('nova_v2_dev_bypass') === '1'; } catch { /* noop */ }
  if (bypass) throw new Error('デモモード中はインポートできません（UI確認のみ）');
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
        // skipped（id空でbatchに載せていない分）を failed に二重計上しない
        failed += written;
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
