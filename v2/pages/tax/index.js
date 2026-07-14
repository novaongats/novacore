/* ============================================================
   NOVA Core v2 — 税理士提出書類（本部）

   税理士の月次確認・申告準備に必要な書類一式を、
   全社（本部総合）/ 部門（店舗）別 で PDF・CSV 出力するハブ。

   書類一覧:
     1. 月次損益サマリー        5. 消費税区分集計表
     2. 売上帳（日別明細）      6. 賃金台帳・源泉税納付集計
     3. 経費帳（勘定科目別）    7. 請求書・領収書 発行一覧
     4. 現金出納帳              8. 月次推移表（12ヶ月）
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useMemo, useEffect } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection, useDoc, where } from '../../store.js';
import { dayjs, thisMonth, monthLabel, addMonths, asArray } from '../../shared.js';
import { useDepts } from '../../depts.js';
import { getRatesFor } from '../payroll/calc.js';
import {
  buildPL, buildSalesLedger, buildExpenseLedger, buildCashbookDoc,
  buildTaxSummary, buildWageLedger, buildInvoiceList, buildTrend,
  downloadCsv,
} from './data.js';
import { TaxDocOverlay, applyPageOrientation } from './print.js';

const html = htm.bind(h);

const DOCS = [
  { id: 'pl',             icon: '📊', title: '月次損益サマリー',
    desc: '売上（部門別）・経費（科目別）・営業利益。月次報告の表紙に', scoped: true },
  { id: 'sales-ledger',   icon: '📈', title: '売上帳（日別明細）',
    desc: '日付・部門・カテゴリ・摘要つきの売上明細と月計', scoped: true },
  { id: 'expense-ledger', icon: '🧾', title: '経費帳（勘定科目別）',
    desc: '科目ごとに明細と小計を整理。仕訳の確認用', scoped: true },
  { id: 'cashbook',       icon: '📒', title: '現金出納帳',
    desc: '税率・インボイス有無つきの現金支出明細', scoped: true },
  { id: 'tax-summary',    icon: '🧮', title: '消費税区分集計表',
    desc: '仮受・仮払消費税の概算と適格請求書の区分', scoped: true },
  { id: 'wage-ledger',    icon: '💰', title: '賃金台帳・源泉税納付集計',
    desc: '従業員別の支給・控除明細と納付書転記用の集計（A4横）', scoped: false },
  { id: 'invoice-list',   icon: '📄', title: '請求書・領収書 発行一覧',
    desc: '発行書類の一覧と入金状況（売掛残）', scoped: false },
  { id: 'trend',          icon: '📅', title: '月次推移表（12ヶ月）',
    desc: '売上・経費・人件費・営業利益の推移', scoped: true },
];

export function TaxReportPage() {
  const [month, setMonth] = useState(thisMonth());
  const [scope, setScope] = useState('all');
  const [active, setActive] = useState(null); // 表示中の書類スペック

  const depts = useDepts();

  // データ読込（この会社の規模なら全件購読で十分軽い）
  const catsQ     = useCollection(repos.salesCategories);
  const entriesQ  = useCollection(repos.salesEntries);
  const costsQ    = useCollection(repos.salesCosts);
  const cashbookQ = useCollection(repos.cashbook);
  const payrollQ  = useCollection(repos.payrollRecords);
  const bonusQ    = useCollection(repos.payrollBonus);
  const invoicesQ = useCollection(repos.invoices);
  const ratesQ    = useCollection(repos.payrollRates);
  const empRatesQ = useDoc(repos.settings, 'payroll_employment_rates');

  const loading = catsQ.loading || entriesQ.loading || costsQ.loading
    || cashbookQ.loading || payrollQ.loading || invoicesQ.loading;

  const data = useMemo(() => {
    const inMonth = (d) => (d || '').startsWith(month);
    const cats = asArray(catsQ.data);
    const allEntries  = asArray(entriesQ.data);
    const allCosts    = asArray(costsQ.data);
    const allCashbook = asArray(cashbookQ.data);
    const allPayroll  = asArray(payrollQ.data);
    const allBonus    = asArray(bonusQ.data);
    return {
      cats,
      allEntries, allCosts, allCashbook, allPayroll, allBonus,
      entries:  allEntries.filter(e => inMonth(e.date)),
      costs:    allCosts.filter(c => c.yearMonth === month),
      cashbook: allCashbook.filter(e => inMonth(e.date)),
      payroll:  allPayroll.filter(r => r.month === month),
      bonus:    allBonus.filter(b => b.month === month),
      invoices: asArray(invoicesQ.data),
      rates: getRatesFor(month, asArray(ratesQ.data), {
        employmentEmployer: empRatesQ.data?.employer,
      }),
    };
  }, [month, catsQ.data, entriesQ.data, costsQ.data, cashbookQ.data,
      payrollQ.data, bonusQ.data, invoicesQ.data, ratesQ.data, empRatesQ.data]);

  function buildSpec(docId, forScope = scope) {
    const base = { month, scope: forScope, depts, ...data };
    switch (docId) {
      case 'pl':             return buildPL(base);
      case 'sales-ledger':   return buildSalesLedger(base);
      case 'expense-ledger': return buildExpenseLedger(base);
      case 'cashbook':       return buildCashbookDoc(base);
      case 'tax-summary':    return buildTaxSummary(base);
      case 'wage-ledger':    return buildWageLedger({ ...base, employees: [] });
      case 'invoice-list':   return buildInvoiceList(base);
      case 'trend':          return buildTrend(base);
      default: return null;
    }
  }

  function open(docId) {
    const spec = buildSpec(docId);
    if (!spec) return;
    applyPageOrientation(!!spec.landscape);
    setActive(spec);
  }

  function csv(docId) {
    const spec = buildSpec(docId);
    if (spec) downloadCsv(spec, `${spec.id}_${month}${scope === 'all' ? '' : '_' + scope}`);
  }

  // 月次一式CSV（全書類をまとめて出力）
  function exportAllCsv() {
    for (const d of DOCS) csv(d.id);
  }

  const scopeOptions = [
    { key: 'all', label: '全社（本部総合）' },
    ...depts.map(d => ({ key: d.key, label: d.label + (d.archived ? '（アーカイブ済）' : '') })),
  ];

  return html`
    <div style=${{ maxWidth: 1000 }}>
      <!-- 期間・範囲コントロール -->
      <div class="card" style=${{ padding: 16, marginBottom: 18,
                                  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style=${{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button class="btn btn-ghost" onClick=${() => setMonth(addMonths(month, -1))}>◀</button>
          <div style=${{ fontSize: 16, fontWeight: 700, minWidth: 110, textAlign: 'center' }}>
            ${monthLabel(month)}
          </div>
          <button class="btn btn-ghost" onClick=${() => setMonth(addMonths(month, 1))}>▶</button>
          <button class="btn btn-ghost" onClick=${() => setMonth(thisMonth())}>今月</button>
        </div>

        <div style=${{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style=${{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600 }}>集計範囲</span>
          <select value=${scope} onChange=${e => setScope(e.target.value)}
                  style=${{ padding: '9px 12px', border: '1px solid var(--border)',
                            borderRadius: 8, background: 'var(--surface)', fontSize: 13,
                            fontFamily: 'inherit' }}>
            ${scopeOptions.map(o => html`
              <option key=${o.key} value=${o.key}>${o.label}</option>
            `)}
          </select>
        </div>

        <div style=${{ marginLeft: 'auto' }}>
          <button class="btn btn-ghost" onClick=${exportAllCsv} disabled=${loading}>
            📥 全書類をCSVで一括出力
          </button>
        </div>
      </div>

      ${loading && html`<div style=${{ color: 'var(--text-3)', padding: 8 }}>データ読込中...</div>`}

      <!-- 書類カード -->
      <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
        ${DOCS.map(d => {
          const scopeNote = !d.scoped && scope !== 'all';
          return html`
            <div key=${d.id} class="card" style=${{ padding: 18, display: 'flex',
                                                     flexDirection: 'column', gap: 10 }}>
              <div style=${{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style=${{ fontSize: 22 }}>${d.icon}</span>
                <div>
                  <div style=${{ fontSize: 14, fontWeight: 700 }}>${d.title}</div>
                  <div style=${{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>${d.desc}</div>
                </div>
              </div>
              ${scopeNote && html`
                <div style=${{ fontSize: 10.5, color: 'var(--text-4)' }}>
                  ※ この書類は常に全社集計です
                </div>
              `}
              <div style=${{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                <button class="btn" style=${{ flex: 1 }} disabled=${loading}
                        onClick=${() => open(d.id)}>👁 プレビュー / 印刷</button>
                <button class="btn btn-ghost" disabled=${loading}
                        onClick=${() => csv(d.id)}>CSV</button>
              </div>
            </div>
          `;
        })}
      </div>

      <div class="note note-info" style=${{ marginTop: 18 }}>
        <strong>月次の渡し方（推奨）:</strong>
        ①損益サマリー → ②売上帳 → ③経費帳 → ④現金出納帳 → ⑤消費税区分 → ⑥賃金台帳 の順で
        PDF保存（プレビュー→印刷→「PDFに保存」）し、まとめて税理士へ送付してください。
        数値の根拠を聞かれたら各明細書類（売上帳・経費帳・出納帳）を参照できます。
      </div>

      ${active && html`
        <${TaxDocOverlay} spec=${active} onClose=${() => setActive(null)} />
      `}
    </div>
  `;
}
