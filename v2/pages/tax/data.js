/* ============================================================
   NOVA Core v2 — 税理士提出書類 / データビルダー

   各ビルダーは「書類スペック」を返す:
     {
       id, title, period, scope,
       summary?: [{ label, value, emph? }],   // 冒頭の要点バンド（3〜4値）
       sections: [{ heading?, desc?, note?, table?: { cols, rows, total? } }],
       footnotes: [string],
     }
   cols: [{ label, align?: 'right'|'center', width? }]
   rows: string|number の二次元配列（number は ¥ フォーマットで描画）
   heading が「①②…」で始まる場合、print.js が番号バッジとして描画する。
   desc はセクション見出しの補足（明細書類への参照など）。

   このスペックを print.js（A4描画）と csv 変換の両方が消費する。
   ============================================================ */

import {
  formatYen, monthLabel, asArray, sumBy, lastNMonths, deptLabel, accountLabel,
  toCsv, downloadTextFile,
} from '../../shared.js';
import { getRatesFor, getInsuranceStatus, isOnLeave } from '../payroll/calc.js';
import { EMP_TYPE_MAP } from '../payroll/constants.js';
import { STATUS_MAP, DOC_TYPE_MAP } from '../invoices/calc.js';

// ---- 共通ヘルパー ------------------------------------------------------------

const yen = n => formatYen(n || 0);

/** scope: 'all' | dept key。エントリの所属部門キーを解決 */
function entryDept(e, catMap) {
  return catMap.get(e.catId)?.dept || e.dept || 'other';
}

function scopeLabel(scope, depts) {
  if (scope === 'all') return '全社（本部総合）';
  return (depts.find(d => d.key === scope)?.label || scope) + '（部門別）';
}

/**
 * cashbook エントリが部門スコープに属するか。
 * 優先順:
 *   1. e.deptKey（現金出納帳の入力フォームで選ぶ salesDepts のキー）
 *   2. e.dept（cashbookDepts 由来の自由テキスト）と salesDepts の key/label の完全一致
 * 全社（scope='all'）は従来どおり全件。
 */
function cashbookInScope(e, scope, depts) {
  if (scope === 'all') return true;
  if (e.deptKey) return e.deptKey === scope;
  const label = depts.find(d => d.key === scope)?.label;
  return e.dept === scope || (!!label && e.dept === label);
}

/** cashbook エントリがいずれかの事業部門に紐付くか（部門スコープ帳票の脚注用） */
function cashbookMatchesAnyDept(e, depts) {
  if (e.deptKey) return true;
  return depts.some(d => e.dept === d.key || e.dept === d.label);
}

/** 部門に紐付かない現金出納帳エントリの合計（¥）と件数 */
function cashbookUnmatched(cashbook, depts) {
  const list = cashbook.filter(e => !cashbookMatchesAnyDept(e, depts));
  return { count: list.length, total: sumBy(list, e => e.amount) };
}

/** 部門スコープ帳票用の自動脚注（紐付かない現金出納帳がある場合のみ） */
function cashbookUnmatchedFootnote(scope, cashbook, depts) {
  if (scope === 'all') return null;
  const u = cashbookUnmatched(cashbook, depts);
  if (!u.count) return null;
  return `現金出納帳のうち部門に紐付かない ${yen(u.total)}（${u.count}件）は全社版にのみ含まれています。`;
}

/** CSV/print 共通のファイル名ベース: {id}_{YYYY-MM}{_scope} */
function fileBase(id, month, scope) {
  return `${id}_${month}` + (scope && scope !== 'all' ? '_' + scope : '');
}

function fmtDate(d) {
  if (!d) return '';
  return String(d).replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, (_, y, m, dd) =>
    `${m}/${dd}`);
}

/** v1移行の手入力経費レコード（salesEntries の type:'expense'）か */
function isLegacyExpense(e) { return e.type === 'expense'; }

/** レベシェアの自動外注費: カテゴリ×月売上から算出（経費レコードは基数に含めない） */
function revShareRows(entries, cats, scope, catMap) {
  const rows = [];
  for (const cat of cats) {
    if (!cat.revShare?.enabled) continue;
    if (scope !== 'all' && (cat.dept || 'other') !== scope) continue;
    const pct = Math.max(0, Math.min(100, Number(cat.revShare.companyPct) || 0));
    const rev = entries
      .filter(e => e.catId === cat.id && !isLegacyExpense(e))
      .reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const outsource = Math.round(rev * (100 - pct) / 100);
    if (outsource > 0) rows.push({ cat, outsource, pct });
  }
  return rows;
}

// ============================================================
// 1. 月次損益サマリー（部門別 P/L）
// ============================================================

export function buildPL({ month, scope, depts, cats, entries, costs, cashbook, payroll, bonus, rates }) {
  const catMap = new Map(cats.map(c => [c.id, c]));
  const inScope = e => scope === 'all' || entryDept(e, catMap) === scope;

  // v1移行の type:'expense' レコードは売上に合算せず、経費側に計上する
  // （home.js の legacyExpense と同じ扱い — ホームの営業利益と一致させる）
  const legacyExpense = sumBy(
    entries.filter(e => isLegacyExpense(e) && inScope(e)), e => e.amount);

  // --- 売上（部門別） ---
  const revByDept = {};
  let totalRevenue = 0;
  for (const e of entries) {
    if (!inScope(e) || isLegacyExpense(e)) continue;
    const d = entryDept(e, catMap);
    const v = Number(e.amount) || 0;
    revByDept[d] = (revByDept[d] || 0) + v;
    totalRevenue += v;
  }

  // --- 経費（勘定科目別） ---
  const costByAccount = {};
  const add = (label, v) => { if (v) costByAccount[label] = (costByAccount[label] || 0) + v; };

  for (const sc of costs) {
    const cat = catMap.get(sc.catId);
    if (scope !== 'all' && (cat?.dept || 'other') !== scope) continue;
    for (const it of asArray(sc.items)) add(accountLabel(it.type), Number(it.amount) || 0);
  }
  for (const r of revShareRows(entries, cats, scope, catMap)) add('外注費', r.outsource);
  for (const e of cashbook) {
    if (!cashbookInScope(e, scope, depts)) continue;
    add(e.category || 'その他（現金）', Number(e.amount) || 0);
  }
  add('移行経費（v1手入力）', legacyExpense);

  // --- 人件費（全社スコープのみ。部門配賦は行っていない） ---
  let payrollGross = 0, employerSocial = 0;
  if (scope === 'all') {
    payrollGross = sumBy(payroll, r => r.gross) + sumBy(bonus, r => r.amount);
    employerSocial = estimateEmployerSocial(payroll, bonus, rates);
    add('給料・賞与（額面）', payrollGross);
    add('法定福利費（事業主負担・概算）', employerSocial);
  }

  const totalCost = Object.values(costByAccount).reduce((s, v) => s + v, 0);
  const profit = totalRevenue - totalCost;

  const revRows = depts
    .filter(d => revByDept[d.key])
    .map(d => [d.label, yen(revByDept[d.key]),
               totalRevenue ? Math.round(revByDept[d.key] / totalRevenue * 100) + '%' : '-']);
  // 未登録部門キーの拾い漏れ防止
  for (const k of Object.keys(revByDept)) {
    if (!depts.some(d => d.key === k)) {
      revRows.push([deptLabel(k), yen(revByDept[k]),
                    totalRevenue ? Math.round(revByDept[k] / totalRevenue * 100) + '%' : '-']);
    }
  }

  const costRows = Object.entries(costByAccount)
    .sort((a, b) => b[1] - a[1])
    .map(([label, v]) => [label, yen(v), totalCost ? Math.round(v / totalCost * 100) + '%' : '-']);

  return {
    id: 'pl',
    title: '月次損益サマリー',
    period: monthLabel(month),
    scope: scopeLabel(scope, depts),
    filenameBase: fileBase('pl', month, scope),
    summary: [
      { label: '売上高', value: yen(totalRevenue) },
      { label: '経費合計', value: yen(totalCost) },
      { label: '営業利益', value: yen(profit), emph: true },
    ],
    sections: [
      {
        heading: '① 売上高（部門別）',
        desc: '明細は「売上帳（日別明細）」参照',
        table: {
          cols: [{ label: '部門' }, { label: '金額', align: 'right' }, { label: '構成比', align: 'right' }],
          rows: revRows.length ? revRows : [['（売上なし）', '-', '-']],
          total: ['売上高 合計', yen(totalRevenue), '100%'],
        },
      },
      {
        heading: '② 経費（勘定科目別）',
        desc: '明細は「経費帳（勘定科目別）」参照',
        table: {
          cols: [{ label: '勘定科目' }, { label: '金額', align: 'right' }, { label: '構成比', align: 'right' }],
          rows: costRows.length ? costRows : [['（経費なし）', '-', '-']],
          total: ['経費 合計', yen(totalCost), '100%'],
        },
      },
      {
        heading: '③ 損益',
        table: {
          cols: [{ label: '項目' }, { label: '金額', align: 'right' }],
          rows: [
            ['売上高', yen(totalRevenue)],
            ['経費合計', '△ ' + yen(totalCost)],
          ],
          total: ['営業利益', yen(profit)],
        },
      },
    ],
    footnotes: [
      scope === 'all'
        ? '人件費（給料・賞与、法定福利費）は全社一括計上（部門配賦なし）。法定福利費は事業主負担の概算値。'
        : '部門別表示では人件費（給料・賞与）を含みません（全社集計でのみ計上）。',
      '経費は「月次コスト（事業別）」「現金出納帳」「レベニューシェア外注費（自動計算）」の合算。',
      legacyExpense
        ? 'v1から移行した手入力経費レコードは「移行経費（v1手入力）」として経費に計上しています（売上には含まれません）。'
        : null,
      '金額はすべて税込。',
      cashbookUnmatchedFootnote(scope, cashbook, depts),
    ].filter(Boolean),
  };
}

/** 事業主負担の社会保険料（概算）: 健保・介護・厚年・支援金は本人と同額、雇用保険は事業主率 */
function estimateEmployerSocial(payroll, bonus, rates) {
  let total = 0;
  const employerEmpRate = (rates?.employmentEmployer ?? 0.9) / 100;
  for (const r of payroll) {
    total += (r.health || 0) + (r.care || 0) + (r.pension || 0) + (r.childSupport || 0);
    total += Math.round((r.gross || 0) * employerEmpRate);
  }
  for (const b of bonus) {
    total += (b.health || 0) + (b.care || 0) + (b.pension || 0) + (b.childSupport || 0);
    total += Math.round((b.amount || 0) * employerEmpRate);
  }
  return total;
}

// ============================================================
// 2. 売上帳（日別明細）
// ============================================================

export function buildSalesLedger({ month, scope, depts, cats, entries }) {
  const catMap = new Map(cats.map(c => [c.id, c]));
  const inScope = e => scope === 'all' || entryDept(e, catMap) === scope;

  // v1移行の経費レコードは売上帳の明細から除外（脚注で注記）
  const excluded = entries.filter(e => isLegacyExpense(e) && inScope(e));
  const list = entries
    .filter(e => inScope(e) && !isLegacyExpense(e))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const rows = list.map(e => {
    const cat = catMap.get(e.catId);
    return [
      fmtDate(e.date),
      deptLabel(entryDept(e, catMap)),
      cat?.name || (e.source?.includes('manual') ? '（手入力）' : '（不明カテゴリ）'),
      e.memo || '',
      yen(e.amount),
    ];
  });
  const total = sumBy(list, e => e.amount);

  return {
    id: 'sales-ledger',
    title: '売上帳（日別明細）',
    period: monthLabel(month),
    scope: scopeLabel(scope, depts),
    filenameBase: fileBase('sales-ledger', month, scope),
    summary: [
      { label: '計上件数', value: `${list.length}件` },
      { label: '売上合計（税込）', value: yen(total), emph: true },
    ],
    sections: [{
      table: {
        cols: [
          { label: '日付', width: 56 }, { label: '部門', width: 110 },
          { label: 'カテゴリ' }, { label: '摘要' },
          { label: '金額', align: 'right', width: 110 },
        ],
        rows: rows.length ? rows : [['', '', '（該当月の売上はありません）', '', '-']],
        total: ['', '', '', `合計（${list.length}件）`, yen(total)],
      },
    }],
    footnotes: [
      '金額は税込。売上入力（日次売上）の登録データに基づく。',
      excluded.length
        ? `v1移行の経費レコード ${excluded.length}件（${yen(sumBy(excluded, e => e.amount))}）は売上ではないため本表から除外しています（損益サマリーの「移行経費（v1手入力）」に計上）。`
        : null,
    ].filter(Boolean),
  };
}

// ============================================================
// 3. 経費帳（勘定科目別明細）
// ============================================================

export function buildExpenseLedger({ month, scope, depts, cats, entries, costs, cashbook }) {
  const catMap = new Map(cats.map(c => [c.id, c]));

  // 科目 → 明細行
  const groups = new Map();
  const push = (account, row, amount) => {
    if (!groups.has(account)) groups.set(account, { rows: [], total: 0 });
    const g = groups.get(account);
    g.rows.push(row);
    g.total += amount;
  };

  for (const sc of costs) {
    const cat = catMap.get(sc.catId);
    if (scope !== 'all' && (cat?.dept || 'other') !== scope) continue;
    for (const it of asArray(sc.items)) {
      const v = Number(it.amount) || 0;
      if (!v) continue;
      push(accountLabel(it.type),
           ['月次コスト', deptLabel(cat?.dept || 'other'), cat?.name || '（不明）', it.memo || it.note || '', yen(v)],
           v);
    }
  }
  for (const r of revShareRows(entries, cats, scope, catMap)) {
    push('外注費',
         ['自動計算', deptLabel(r.cat.dept || 'other'), r.cat.name,
          `レベニューシェア（弊社${r.pct}%）`, yen(r.outsource)],
         r.outsource);
  }
  for (const e of cashbook) {
    if (!cashbookInScope(e, scope, depts)) continue;
    const v = Number(e.amount) || 0;
    if (!v) continue;
    push(e.category || 'その他（現金）',
         ['現金出納帳', e.dept || '-', e.vendor || '', e.memo || '', yen(v)],
         v);
  }
  // v1移行の経費レコード（type:'expense'）。損益サマリー・月次推移と同じ計上で、
  // 経費帳の総合計が他書類の経費合計と一致するようにする。
  for (const e of entries) {
    if (!isLegacyExpense(e)) continue;
    const dept = entryDept(e, catMap);
    if (scope !== 'all' && dept !== scope) continue;
    const v = Number(e.amount) || 0;
    if (!v) continue;
    push('移行経費（v1手入力）',
         ['v1移行', deptLabel(dept), e.category || '', [e.date, e.memo].filter(Boolean).join(' '), yen(v)],
         v);
  }

  const sections = [...groups.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([account, g]) => ({
      heading: `${account}`,
      table: {
        cols: [
          { label: '出所', width: 76 }, { label: '部門/店舗', width: 100 },
          { label: '取引先・カテゴリ' }, { label: '摘要' },
          { label: '金額', align: 'right', width: 100 },
        ],
        rows: g.rows,
        total: ['', '', '', `${account} 計（${g.rows.length}件）`, yen(g.total)],
      },
    }));

  const grandTotal = [...groups.values()].reduce((s, g) => s + g.total, 0);
  const detailCount = [...groups.values()].reduce((s, g) => s + g.rows.length, 0);

  return {
    id: 'expense-ledger',
    title: '経費帳（勘定科目別）',
    period: monthLabel(month),
    scope: scopeLabel(scope, depts),
    filenameBase: fileBase('expense-ledger', month, scope),
    summary: [
      { label: '勘定科目', value: `${groups.size}科目` },
      { label: '明細件数', value: `${detailCount}件` },
      { label: '経費総合計（税込）', value: yen(grandTotal), emph: true },
    ],
    sections: sections.length ? sections : [{
      table: { cols: [{ label: '' }], rows: [['（該当月の経費はありません）']] },
    }],
    grandTotal: { label: '経費 総合計', value: yen(grandTotal) },
    footnotes: [
      '金額は税込。「月次コスト」「現金出納帳」「レベニューシェア外注費」（および v1移行経費がある月はその分）の合算。',
      scope !== 'all' ? '現金出納帳の明細は、部門（deptKey）または部門名が一致するもののみ表示しています。' : null,
      cashbookUnmatchedFootnote(scope, cashbook, depts),
    ].filter(Boolean),
  };
}

// ============================================================
// 4. 現金出納帳（月次）
// ============================================================

export function buildCashbookDoc({ month, scope, depts, cashbook }) {
  const list = cashbook
    .filter(e => cashbookInScope(e, scope, depts))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const rows = list.map(e => [
    fmtDate(e.date),
    e.vendor || '',
    e.category || '',
    e.dept || '',
    e.reducedTax ? '8%（軽減）' : '10%',
    e.hasInvoice ? (e.invoiceNumber ? `有 ${e.invoiceNumber}` : '有') : '無',
    yen(e.amount),
  ]);

  const total = sumBy(list, e => e.amount);
  const t10 = sumBy(list.filter(e => !e.reducedTax), e => e.amount);
  const t8  = sumBy(list.filter(e => e.reducedTax), e => e.amount);
  const inv = sumBy(list.filter(e => e.hasInvoice), e => e.amount);

  return {
    id: 'cashbook',
    title: '現金出納帳',
    period: monthLabel(month),
    scope: scopeLabel(scope, depts),
    filenameBase: fileBase('cashbook', month, scope),
    summary: [
      { label: '記帳件数', value: `${list.length}件` },
      { label: '標準10%対象', value: yen(t10) },
      { label: '軽減8%対象', value: yen(t8) },
      { label: '支出合計（税込）', value: yen(total), emph: true },
    ],
    sections: [
      {
        heading: '① 現金支出明細（日付順）',
        table: {
          cols: [
            { label: '日付', width: 52 }, { label: '相手先' }, { label: '科目', width: 90 },
            { label: '部門/店舗', width: 84 }, { label: '税率', width: 66 },
            { label: 'ｲﾝﾎﾞｲｽ', width: 70 }, { label: '支出額', align: 'right', width: 96 },
          ],
          rows: rows.length ? rows : [['', '（該当月の記帳はありません）', '', '', '', '', '-']],
          total: ['', '', '', '', '', `合計（${list.length}件）`, yen(total)],
        },
      },
      {
        heading: '② 税区分別 内訳',
        desc: '仕入税額控除の確認用',
        table: {
          cols: [{ label: '区分' }, { label: '金額', align: 'right' }],
          rows: [
            ['標準税率 10% 対象', yen(t10)],
            ['軽減税率 8% 対象', yen(t8)],
            ['適格請求書（インボイス）あり', yen(inv)],
            ['適格請求書なし', yen(total - inv)],
          ],
        },
      },
    ],
    footnotes: [
      '金額は税込。「インボイスあり」は適格請求書発行事業者の登録番号が確認できた支出。',
      cashbookUnmatchedFootnote(scope, cashbook, depts),
    ].filter(Boolean),
  };
}

// ============================================================
// 5. 消費税区分集計表
// ============================================================

export function buildTaxSummary({ month, scope, depts, cats, entries, costs, cashbook, invoices }) {
  const catMap = new Map(cats.map(c => [c.id, c]));
  const inScope = e => scope === 'all' || entryDept(e, catMap) === scope;

  // 売上側（税込→内税を概算）。v1移行の経費レコードは売上ではないため仮受から除外。
  // 税区分が不明のため課税仕入（仮払）側にも入れず「対象外」として脚注する。
  const legacyExpList = entries.filter(e => isLegacyExpense(e) && inScope(e));
  const sales = sumBy(entries.filter(e => inScope(e) && !isLegacyExpense(e)), e => e.amount);
  const recvTax = Math.round(sales * 10 / 110);

  // 請求書ベース（当月発行の発行済・入金済のみ、参考値）
  const issued = invoices.filter(i =>
    i.type === 'invoice'
    && (i.issueDate || '').startsWith(month)
    && (i.status === 'issued' || i.status === 'paid'));
  const invTax10 = sumBy(issued, i => i.tax10);
  const invTax8  = sumBy(issued, i => i.tax8);

  // 仕入側
  let cost10 = 0, cost8 = 0, costInv10 = 0, costInv8 = 0;
  for (const e of cashbook) {
    if (!cashbookInScope(e, scope, depts)) continue;
    const v = Number(e.amount) || 0;
    if (e.reducedTax) { cost8 += v; if (e.hasInvoice) costInv8 += v; }
    else              { cost10 += v; if (e.hasInvoice) costInv10 += v; }
  }
  // 月次コスト: 非課税・不課税科目（給与、人件費、保険料、法定福利費、減価償却費）は
  // 消費税がかからないため、仮払消費税の計算から除外して別行で表示する。
  const NON_TAXABLE_TYPES = ['salary', 'labor', 'insurance', 'legalWelfare', 'depreciation'];
  let scCost = 0, scNonTaxable = 0;
  for (const sc of costs) {
    const cat = catMap.get(sc.catId);
    if (scope !== 'all' && (cat?.dept || 'other') !== scope) continue;
    for (const it of asArray(sc.items)) {
      const v = Number(it.amount) || 0;
      if (NON_TAXABLE_TYPES.includes(it.type)) scNonTaxable += v;
      else scCost += v;
    }
  }

  const paid10 = Math.round(cost10 * 10 / 110);
  const paid8  = Math.round(cost8 * 8 / 108);
  const paidSc = Math.round(scCost * 10 / 110);
  const paidTotal = paid10 + paid8 + paidSc;
  const payable = Math.max(0, recvTax - paidTotal);

  return {
    id: 'tax-summary',
    title: '消費税区分集計表（概算）',
    period: monthLabel(month),
    scope: scopeLabel(scope, depts),
    filenameBase: fileBase('tax-summary', month, scope),
    summary: [
      { label: '仮受消費税（概算）', value: yen(recvTax) },
      { label: '仮払消費税（概算）', value: yen(paidTotal) },
      { label: '差引 納付見込（概算）', value: yen(payable), emph: true },
    ],
    sections: [
      {
        heading: '① 売上に係る消費税（仮受・概算）',
        table: {
          cols: [{ label: '区分' }, { label: '税込金額', align: 'right' }, { label: '消費税額（概算）', align: 'right' }],
          rows: [
            ['課税売上（標準10%・内税換算）', yen(sales), yen(recvTax)],
          ],
          total: ['仮受消費税 合計', '', yen(recvTax)],
        },
        note: issued.length
          ? `（参考）発行済請求書ベース: 10%消費税 ${yen(invTax10)} / 軽減8%消費税 ${yen(invTax8)}（${issued.length}件）`
          : null,
      },
      {
        heading: '② 仕入・経費に係る消費税（仮払・概算）',
        table: {
          cols: [{ label: '区分' }, { label: '税込金額', align: 'right' }, { label: '消費税額（概算）', align: 'right' }],
          rows: [
            ['現金出納帳: 標準10%', yen(cost10), yen(paid10)],
            ['　うち 適格請求書あり', yen(costInv10), ''],
            ['現金出納帳: 軽減8%', yen(cost8), yen(paid8)],
            ['　うち 適格請求書あり', yen(costInv8), ''],
            ['月次コスト（標準10%とみなし）', yen(scCost), yen(paidSc)],
            ...(scNonTaxable ? [['月次コスト: 課税仕入対象外（非課税・不課税科目）', yen(scNonTaxable), '—']] : []),
          ],
          total: ['仮払消費税 合計', '', yen(paidTotal)],
        },
      },
      {
        heading: '③ 差引（概算）',
        table: {
          cols: [{ label: '項目' }, { label: '金額', align: 'right' }],
          rows: [
            ['仮受消費税', yen(recvTax)],
            ['仮払消費税', '△ ' + yen(paidTotal)],
          ],
          total: ['差引 納付見込（概算）', yen(payable)],
        },
      },
    ],
    footnotes: [
      '本表は帳簿データからの概算であり、申告額の確定計算ではありません（税理士確認用の参考資料）。',
      '売上・月次コストは標準税率10%の内税として換算。',
      '月次コストのうち非課税・不課税科目（給料・賞与、人件費、保険料、法定福利費、減価償却費）は「課税仕入対象外」として仮払消費税の計算から除外しています。',
      '仕入税額控除の適用可否（インボイス制度・経過措置）は「適格請求書あり」の区分を参照してください。',
      legacyExpList.length
        ? `v1移行の経費レコード ${legacyExpList.length}件（${yen(sumBy(legacyExpList, e => e.amount))}）は税区分が不明なため本表の対象外です（仮受・仮払のいずれにも含まれません）。`
        : null,
      cashbookUnmatchedFootnote(scope, cashbook, depts),
    ].filter(Boolean),
  };
}

// ============================================================
// 6. 賃金台帳 + 源泉徴収税 納付集計
// ============================================================

export function buildWageLedger({ month, depts, payroll, bonus, employees, rates }) {
  const sorted = [...payroll].sort((a, b) => (a.empName || '').localeCompare(b.empName || '', 'ja'));

  // 横計: 基本給 + 諸手当（歩合+手当）+ 通勤手当 − 控除 = 総支給
  const rows = sorted.map(r => [
    r.empName || r.empId,
    EMP_TYPE_MAP[r.empType]?.label || r.empType || '',
    yen(r.basePay), yen((r.commission || 0) + (r.allowance || 0)),
    yen(r.commuteTotal), yen(r.deduction), yen(r.gross),
    yen((r.health || 0) + (r.care || 0)), yen(r.pension),
    yen((r.childSupport || 0)), yen(r.employment),
    yen(r.incomeTax), yen(r.residentTax), yen(r.net),
  ]);

  const t = f => sumBy(payroll, f);
  const total = [
    `合計（${payroll.length}名）`, '',
    yen(t(r => r.basePay)), yen(t(r => (r.commission || 0) + (r.allowance || 0))),
    yen(t(r => r.commuteTotal)), yen(t(r => r.deduction)), yen(t(r => r.gross)),
    yen(t(r => (r.health || 0) + (r.care || 0))), yen(t(r => r.pension)),
    yen(t(r => r.childSupport)), yen(t(r => r.employment)),
    yen(t(r => r.incomeTax)), yen(t(r => r.residentTax)), yen(t(r => r.net)),
  ];

  // 賞与
  const bonusRows = bonus.map(b => [
    b.empName || b.empId, yen(b.amount), yen(b.social), yen(b.incomeTax), yen(b.net),
  ]);

  // 源泉税納付集計（納付書転記用）
  const incomeTaxTotal = t(r => r.incomeTax) + sumBy(bonus, b => b.incomeTax);
  const residentTotal = t(r => r.residentTax);
  const grossTotal = t(r => r.gross);
  const bonusTotal = sumBy(bonus, b => b.amount);

  const sections = [
    {
      heading: '① 給与支給明細（賃金台帳）',
      table: {
        cols: [
          { label: '氏名', width: 76 }, { label: '区分', width: 44 },
          { label: '基本給', align: 'right' }, { label: '諸手当', align: 'right' },
          { label: '通勤手当', align: 'right', width: 56 }, { label: '控除', align: 'right', width: 52 },
          { label: '総支給', align: 'right' },
          { label: '健保+介護', align: 'right' }, { label: '厚生年金', align: 'right' },
          { label: '支援金', align: 'right', width: 52 }, { label: '雇用保険', align: 'right', width: 54 },
          { label: '所得税', align: 'right' }, { label: '住民税', align: 'right' },
          { label: '差引支給', align: 'right' },
        ],
        rows: rows.length ? rows : [['（該当月の給与計算がありません）', '', '', '', '', '', '', '', '', '', '', '', '', '']],
        total: rows.length ? total : null,
        small: true,
      },
    },
  ];

  if (bonusRows.length) {
    sections.push({
      heading: '② 賞与支給明細',
      table: {
        cols: [
          { label: '氏名' }, { label: '賞与額', align: 'right' },
          { label: '社会保険料', align: 'right' }, { label: '所得税', align: 'right' },
          { label: '差引支給', align: 'right' },
        ],
        rows: bonusRows,
        total: [`合計（${bonusRows.length}名）`, yen(bonusTotal),
                yen(sumBy(bonus, b => b.social)), yen(sumBy(bonus, b => b.incomeTax)),
                yen(sumBy(bonus, b => b.net))],
      },
    });
  }

  sections.push({
    heading: `${bonusRows.length ? '③' : '②'} 源泉所得税・住民税 納付集計`,
    desc: '所得税徴収高計算書（納付書）への転記用',
    table: {
      cols: [{ label: '項目' }, { label: '人数', align: 'right' }, { label: '支給総額', align: 'right' }, { label: '税額', align: 'right' }],
      rows: [
        ['給与（俸給・給料等）', payroll.length + '名', yen(grossTotal), yen(t(r => r.incomeTax))],
        ...(bonusRows.length ? [['賞与', bonusRows.length + '名', yen(bonusTotal), yen(sumBy(bonus, b => b.incomeTax))]] : []),
        ['特別徴収住民税（預り）', payroll.filter(r => r.residentTax > 0).length + '名', '', yen(residentTotal)],
      ],
      total: ['源泉所得税 合計（納付額）', '', '', yen(incomeTaxTotal)],
    },
  });

  return {
    id: 'wage-ledger',
    title: '賃金台帳・源泉税納付集計',
    period: monthLabel(month),
    scope: '全社（本部総合）',
    filenameBase: fileBase('wage-ledger', month, 'all'),
    summary: [
      { label: '支給人数', value: `${payroll.length}名` },
      { label: '総支給額（給与）', value: yen(grossTotal) },
      ...(bonusRows.length ? [{ label: '賞与支給額', value: yen(bonusTotal) }] : []),
      { label: '源泉所得税 納付額', value: yen(incomeTaxTotal), emph: true },
    ],
    sections,
    footnotes: [
      '総支給 = 基本給 + 諸手当 + 通勤手当 − 控除。',
      '「支援金」は子ども・子育て支援金（2026年4月分〜、健康保険加入者）。',
      '源泉所得税の納期限は原則翌月10日（納期の特例適用時は7月10日・1月20日）。',
      '住民税（特別徴収）は従業員マスタ登録の月額に基づく預り額。',
    ],
    landscape: true,
  };
}

// ============================================================
// 7. 請求書発行一覧（売掛管理）
// ============================================================

export function buildInvoiceList({ month, invoices }) {
  const list = invoices
    .filter(i => (i.issueDate || '').startsWith(month))
    .sort((a, b) => (a.issueDate || '').localeCompare(b.issueDate || ''));

  const rows = list.map(i => [
    fmtDate(i.issueDate),
    i.docNumber || '',
    DOC_TYPE_MAP[i.type]?.label || i.type || '',
    i.clientCompany || i.clientName || '',
    STATUS_MAP[i.status]?.label || i.status || '',
    yen(i.totalAmount),
  ]);

  // 'void' は現行の取消ステータス、'cancelled' は旧データ互換（STATUS_MAP 参照）
  const active = list.filter(i => !['cancelled', 'void', 'draft'].includes(i.status || 'draft'));
  const total = sumBy(active, i => i.totalAmount);
  const paid = sumBy(active.filter(i => i.status === 'paid'), i => i.totalAmount);

  return {
    id: 'invoice-list',
    title: '請求書・領収書 発行一覧',
    period: monthLabel(month),
    scope: '全社（本部総合）',
    filenameBase: fileBase('invoice-list', month, 'all'),
    summary: [
      { label: '有効発行', value: `${active.length}件` },
      { label: '発行合計（税込）', value: yen(total) },
      { label: '入金済', value: yen(paid) },
      { label: '未入金（売掛残）', value: yen(total - paid), emph: true },
    ],
    sections: [
      {
        heading: '① 発行書類一覧（発行日順）',
        table: {
          cols: [
            { label: '発行日', width: 56 }, { label: '番号', width: 110 },
            { label: '種別', width: 60 }, { label: '宛先' },
            { label: '状態', width: 60 }, { label: '金額（税込）', align: 'right', width: 110 },
          ],
          rows: rows.length ? rows : [['', '', '', '（該当月の発行書類はありません）', '', '-']],
          total: ['', '', '', '', `有効分 合計（${active.length}件）`, yen(total)],
        },
      },
      {
        heading: '② 入金状況',
        table: {
          cols: [{ label: '区分' }, { label: '金額', align: 'right' }],
          rows: [
            ['入金済', yen(paid)],
            ['未入金（売掛残）', yen(total - paid)],
          ],
        },
      },
    ],
    footnotes: ['「有効分」は下書き・取消を除く発行済＋入金済の書類。'],
  };
}

// ============================================================
// 8. 12ヶ月推移表
// ============================================================

export function buildTrend({ month, scope, depts, cats, allEntries, allCosts, allCashbook, allPayroll, allBonus }) {
  const months = lastNMonths(month, 12);
  const catMap = new Map(cats.map(c => [c.id, c]));
  const inScope = e => scope === 'all' || entryDept(e, catMap) === scope;

  const per = {};
  for (const m of months) per[m] = { revenue: 0, cost: 0, payroll: 0 };

  let hasLegacyExpense = false;
  for (const e of allEntries) {
    const m = (e.date || '').slice(0, 7);
    if (!per[m] || !inScope(e)) continue;
    // v1移行の経費レコードは売上ではなく費用へ（home.js / PL と同じ扱い）
    if (isLegacyExpense(e)) { per[m].cost += Number(e.amount) || 0; hasLegacyExpense = true; }
    else per[m].revenue += Number(e.amount) || 0;
  }
  for (const sc of allCosts) {
    const cat = catMap.get(sc.catId);
    if (scope !== 'all' && (cat?.dept || 'other') !== scope) continue;
    if (per[sc.yearMonth]) per[sc.yearMonth].cost += sumBy(asArray(sc.items), i => i.amount);
  }
  // レベシェア外注費（月別）
  for (const m of months) {
    const monthEntries = allEntries.filter(e => (e.date || '').startsWith(m));
    for (const r of revShareRows(monthEntries, cats, scope, catMap)) per[m].cost += r.outsource;
  }
  for (const e of allCashbook) {
    const m = (e.date || '').slice(0, 7);
    if (per[m] && cashbookInScope(e, scope, depts)) per[m].cost += Number(e.amount) || 0;
  }
  if (scope === 'all') {
    for (const r of allPayroll) if (per[r.month]) per[r.month].payroll += Number(r.gross) || 0;
    for (const b of allBonus)   if (per[b.month]) per[b.month].payroll += Number(b.amount) || 0;
  }

  const rows = months.map(m => {
    const p = per[m];
    const profit = p.revenue - p.cost - p.payroll;
    return [
      monthLabel(m),
      yen(p.revenue), yen(p.cost),
      scope === 'all' ? yen(p.payroll) : '-',
      yen(profit),
      p.revenue > 0 ? Math.round(profit / p.revenue * 100) + '%' : '-',
    ];
  });

  const sum = f => months.reduce((s, m) => s + f(per[m]), 0);
  const totalRev = sum(p => p.revenue), totalCost = sum(p => p.cost), totalPay = sum(p => p.payroll);
  const totalProfit = totalRev - totalCost - totalPay;

  return {
    id: 'trend',
    title: '月次推移表（直近12ヶ月）',
    period: `${monthLabel(months[0])} 〜 ${monthLabel(month)}`,
    scope: scopeLabel(scope, depts),
    filenameBase: fileBase('trend', month, scope),
    summary: [
      { label: '期間売上', value: yen(totalRev) },
      { label: '期間経費', value: yen(totalCost) },
      ...(scope === 'all' ? [{ label: '期間人件費', value: yen(totalPay) }] : []),
      { label: '期間営業利益', value: yen(totalProfit), emph: true },
    ],
    sections: [{
      table: {
        cols: [
          { label: '月', width: 90 },
          { label: '売上高', align: 'right' }, { label: '経費', align: 'right' },
          { label: '人件費', align: 'right' }, { label: '営業利益', align: 'right' },
          { label: '利益率', align: 'right', width: 60 },
        ],
        rows,
        total: ['合計', yen(totalRev), yen(totalCost),
                scope === 'all' ? yen(totalPay) : '-', yen(totalProfit),
                totalRev > 0 ? Math.round(totalProfit / totalRev * 100) + '%' : '-'],
      },
    }],
    footnotes: [
      hasLegacyExpense
        ? '経費 = 月次コスト + 現金出納帳 + レベニューシェア外注費 + v1移行の手入力経費。'
        : '経費 = 月次コスト + 現金出納帳 + レベニューシェア外注費。',
      scope === 'all' ? '人件費 = 給与・賞与の額面（法定福利費は含まない）。' : '部門別表示では人件費を含みません。',
      // 部門スコープの注記は他書類と一貫させる（対象期間内の現金出納帳のみで判定）
      cashbookUnmatchedFootnote(scope,
        allCashbook.filter(e => per[(e.date || '').slice(0, 7)]), depts),
    ].filter(Boolean),
  };
}

// ============================================================
// CSV 変換（スペック → CSV文字列）
// ============================================================

/**
 * 表示用セル → CSV用セル。
 * 「¥1,234,567」「¥-500」形式の金額文字列は Excel で集計できるよう生の数値に変換。
 * それ以外（「100%」「△ ¥…」「有 T…」等）は文字列のまま。
 */
function csvCellValue(c) {
  if (typeof c === 'number') return c;
  const s = String(c ?? '');
  if (/^¥?-?[\d,]+$/.test(s) && /\d/.test(s)) return Number(s.replace(/[¥,]/g, ''));
  return s;
}

/** スペック → CSV 行の二次元配列（一括出力の結合にも使う） */
export function specToRows(spec) {
  const rows = [
    [spec.title, spec.period, spec.scope],
  ];
  // 冒頭サマリー: 書類名直後に「ラベル, 値」を横並びで1行（Excelでの検算用）
  if (spec.summary?.length) {
    rows.push(spec.summary.flatMap(s => [s.label, csvCellValue(s.value)]));
  }
  rows.push([]);
  for (const sec of spec.sections) {
    if (sec.heading) rows.push([sec.heading]);
    if (sec.table) {
      rows.push(sec.table.cols.map(c => c.label));
      for (const r of sec.table.rows) rows.push(r.map(csvCellValue));
      if (sec.table.total) rows.push(sec.table.total.map(csvCellValue));
    }
    if (sec.note) rows.push([sec.note]);
    rows.push([]);
  }
  if (spec.grandTotal) rows.push([spec.grandTotal.label, csvCellValue(spec.grandTotal.value)]);
  for (const f of spec.footnotes || []) rows.push(['※ ' + f]);
  return rows;
}

/** スペック → CSV 文字列（BOM 付き・数式インジェクション対策込み） */
export function specToCsv(spec) {
  return toCsv(specToRows(spec));
}

export function downloadCsv(spec, filenameHint) {
  downloadTextFile(specToCsv(spec), `${filenameHint}.csv`);
}
