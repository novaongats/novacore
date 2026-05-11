/* ============================================================
   NOVA Core v2 — Tax report page
   Monthly aggregation across sales / cashbook / payroll / invoices.
   Print-friendly layout + CSV export.
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useMemo } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection, where } from '../store.js';
import {
  dayjs, SALES_DEPTS, EXPENSE_ACCOUNTS,
  deptLabel, accountLabel,
  formatYen, thisMonth, monthLabel, addMonths,
  sumBy, asArray,
} from '../shared.js';

const html = htm.bind(h);

export function TaxReportPage({ user }) {
  const [month, setMonth] = useState(thisMonth());
  const monthStart = month + '-01';
  const monthEnd   = dayjs(monthStart).add(1, 'month').format('YYYY-MM-DD');

  // Load all relevant data
  const salesCats     = useCollection(repos.salesCategories);
  const salesEntries  = useCollection(repos.salesEntries,
    () => [where('date', '>=', monthStart), where('date', '<', monthEnd)], [month]);
  const salesCosts    = useCollection(repos.salesCosts,
    () => [where('yearMonth', '==', month)], [month]);
  const cashbook      = useCollection(repos.cashbook,
    () => [where('date', '>=', monthStart), where('date', '<', monthEnd)], [month]);
  const payrollRecs   = useCollection(repos.payrollRecords,
    () => [where('month', '==', month)], [month]);
  const payrollBonus  = useCollection(repos.payrollBonus,
    () => [where('month', '==', month)], [month]);
  const invoices      = useCollection(repos.invoices,
    () => [where('issueDate', '>=', monthStart), where('issueDate', '<', monthEnd)], [month]);
  const documents     = useCollection(repos.documents,
    () => [where('date', '>=', monthStart), where('date', '<', monthEnd)], [month]);

  const loading = salesCats.loading || salesEntries.loading || salesCosts.loading
    || cashbook.loading || payrollRecs.loading || invoices.loading;

  // --- Aggregation -------------------------------------------------------

  const report = useMemo(() => {
    const cats = asArray(salesCats.data);
    const catMap = new Map(cats.map(c => [c.id, c]));

    // Sales by dept
    const deptSales = {};
    for (const d of SALES_DEPTS) deptSales[d.key] = 0;
    let totalSales = 0;
    for (const e of asArray(salesEntries.data)) {
      const cat = catMap.get(e.catId);
      const dept = cat?.dept || e.dept || 'other';
      deptSales[dept] = (deptSales[dept] || 0) + Number(e.amount || 0);
      totalSales += Number(e.amount || 0);
    }

    // Cost by account (from cashbook + salesCosts + rev-share)
    const costByAccount = {};
    // Cashbook (category field is a free string; map via label match or put in 'cashbook' bucket)
    for (const c of asArray(cashbook.data)) {
      const k = c.category || 'その他';
      costByAccount[k] = (costByAccount[k] || 0) + Number(c.amount || 0);
    }
    // Sales costs items (account keyed)
    for (const sc of asArray(salesCosts.data)) {
      for (const item of asArray(sc.items)) {
        const label = accountLabel(item.type) || 'その他';
        costByAccount[label] = (costByAccount[label] || 0) + Number(item.amount || 0);
      }
    }
    // Rev-share implicit 外注費
    for (const cat of cats) {
      if (!cat.revShare?.enabled) continue;
      const pct = Math.max(0, Math.min(100, Number(cat.revShare.companyPct) || 0));
      const catRevenue = asArray(salesEntries.data)
        .filter(e => e.catId === cat.id)
        .reduce((s, e) => s + (Number(e.amount) || 0), 0);
      const outsource = Math.round(catRevenue * (100 - pct) / 100);
      if (outsource > 0) {
        costByAccount['外注費'] = (costByAccount['外注費'] || 0) + outsource;
      }
    }
    const totalCost = Object.values(costByAccount).reduce((s, v) => s + v, 0);

    // Payroll
    const payrollRows = asArray(payrollRecs.data);
    const bonusRows   = asArray(payrollBonus.data);
    const payrollTotal = sumBy(payrollRows, r => r.gross) + sumBy(bonusRows, r => r.amount);
    const socialTotal  = sumBy(payrollRows, r => r.social) + sumBy(bonusRows, r => r.social);
    const taxWithheld  = sumBy(payrollRows, r => r.incomeTax + (r.residentTax || 0))
                       + sumBy(bonusRows, r => r.incomeTax);
    const netPay       = sumBy(payrollRows, r => r.net) + sumBy(bonusRows, r => r.net);

    // Invoices
    const invList = asArray(invoices.data);
    const invoiceTotal = sumBy(invList, i => i.totalAmount);
    const invoicePaid  = sumBy(invList.filter(i => i.status === 'paid'), i => i.totalAmount);
    const invoiceDue   = invoiceTotal - invoicePaid;

    // 消費税 (簡易概算)
    // 課税売上税 10% 部分 + 軽減 8% 部分を抽出。ここでは受け取り消費税 = 売上の内消費税想定
    const recvTax = Math.round(totalSales * 0.10 / 1.10);
    // 仕入税 (概算)
    const paidTax = Math.round(totalCost * 0.10 / 1.10);
    // 差引納付概算
    const taxPayable = Math.max(0, recvTax - paidTax);

    // P/L
    // 経費の中に salary/labor が含まれていれば payrollTotal は二重計上にならない
    const hasSalaryInCost = asArray(salesCosts.data).some(sc =>
      asArray(sc.items).some(i => i.type === 'salary' || i.type === 'labor'));
    const effectivePayroll = hasSalaryInCost ? 0 : payrollTotal;
    const grossProfit = totalSales - totalCost - effectivePayroll;

    return {
      deptSales, totalSales,
      costByAccount, totalCost,
      payrollTotal, socialTotal, taxWithheld, netPay,
      payrollCount: payrollRows.length + bonusRows.length,
      invoiceTotal, invoicePaid, invoiceDue, invoiceCount: invList.length,
      recvTax, paidTax, taxPayable,
      grossProfit, effectivePayroll, hasSalaryInCost,
      docsCount: asArray(documents.data).length,
    };
  }, [salesCats.data, salesEntries.data, salesCosts.data, cashbook.data,
      payrollRecs.data, payrollBonus.data, invoices.data, documents.data]);

  function exportCsv() {
    const rows = [
      ['税理士レポート', `${monthLabel(month)}`, '有限会社NOVA'],
      [],
      ['① 売上集計'],
      ...SALES_DEPTS.map(d => [d.label, report.deptSales[d.key] || 0]),
      ['合計', report.totalSales],
      [],
      ['② 経費一覧'],
      ...Object.entries(report.costByAccount).sort((a, b) => b[1] - a[1]),
      ['合計', report.totalCost],
      [],
      ['③ 給与支払'],
      ['給与総額（賞与含む）', report.payrollTotal],
      ['社会保険料', report.socialTotal],
      ['源泉徴収税 (所得税+住民税)', report.taxWithheld],
      ['差引支給額', report.netPay],
      [],
      ['④ 請求書'],
      ['発行件数', report.invoiceCount],
      ['請求額合計', report.invoiceTotal],
      ['入金済', report.invoicePaid],
      ['未入金', report.invoiceDue],
      [],
      ['⑤ 消費税（概算）'],
      ['仮受消費税', report.recvTax],
      ['仮払消費税', report.paidTax],
      ['差引納付', report.taxPayable],
      [],
      ['⑥ 損益計算書'],
      ['売上高', report.totalSales],
      ['経費', report.totalCost],
      ['人件費（二重計上回避後）', report.effectivePayroll],
      ['営業利益', report.grossProfit],
      [],
      ['⑦ 添付書類', report.docsCount + '件'],
    ];
    const csv = rows
      .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tax_report_${month}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 0);
  }

  function handlePrint() {
    window.print();
  }

  return html`
    <div class="tax-report-root">
      <div style=${{
        display: 'flex', alignItems: 'center', gap: 10,
        marginBottom: 20, flexWrap: 'wrap',
      }} class="no-print">
        <button class="btn btn-ghost" onClick=${() => setMonth(addMonths(month, -1))}>◀</button>
        <div style=${{ fontSize: 16, fontWeight: 700, minWidth: 140, textAlign: 'center' }}>
          ${monthLabel(month)}
        </div>
        <button class="btn btn-ghost" onClick=${() => setMonth(addMonths(month, 1))}>▶</button>
        <button class="btn btn-ghost" onClick=${() => setMonth(thisMonth())}>今月</button>

        <div style=${{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button class="btn btn-ghost" onClick=${exportCsv}>📥 CSV出力</button>
          <button class="btn" onClick=${handlePrint}>🖨 印刷 / PDF保存</button>
        </div>
      </div>

      ${loading ? html`<div style=${{ color: 'var(--text-3)' }}>集計中...</div>` : html`
        <div class="tax-report">
          <div class="tax-report-header">
            <div class="tax-report-title">税理士レポート</div>
            <div class="tax-report-subtitle">
              ${monthLabel(month)} ／ 有限会社NOVA ／ 生成日: ${new Date().toLocaleDateString('ja-JP')}
            </div>
          </div>

          <!-- ① 売上集計 -->
          <${Section} number="①" title="売上集計" color="#6366f1">
            <${KvTable} rows=${[
              ...SALES_DEPTS.map(d => [d.label, report.deptSales[d.key] || 0]),
              ['__total__', report.totalSales],
            ]} totalLabel="合計" />
          </Section>

          <!-- ② 経費一覧 -->
          <${Section} number="②" title="経費一覧" color="#7c3aed">
            <${KvTable} rows=${[
              ...Object.entries(report.costByAccount).sort((a, b) => b[1] - a[1]),
              ['__total__', report.totalCost],
            ]} totalLabel="合計" />
            ${Object.keys(report.costByAccount).length === 0 && html`
              <div style=${{ color: 'var(--text-3)', padding: '8px 4px' }}>経費データなし</div>
            `}
          </Section>

          <!-- ③ 給与支払 -->
          <${Section} number="③" title="給与支払" color="#d97706">
            <${KvTable} rows=${[
              ['支払対象数', report.payrollCount + ' 件'],
              ['給与総額（賞与含）', report.payrollTotal],
              ['社会保険料', report.socialTotal],
              ['源泉徴収税', report.taxWithheld],
              ['__total__', report.netPay],
            ]} totalLabel="差引支給額" />
            ${report.hasSalaryInCost && html`
              <div style=${{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
                ※ 経費一覧に給与/人件費が含まれるため、損益計算書では二重計上を回避しています。
              </div>
            `}
          </Section>

          <!-- ④ 請求書 -->
          <${Section} number="④" title="請求書" color="#e11d48">
            <${KvTable} rows=${[
              ['発行件数', report.invoiceCount + ' 件'],
              ['請求額合計', report.invoiceTotal],
              ['入金済', report.invoicePaid],
              ['__total__', report.invoiceDue],
            ]} totalLabel="未入金" />
          </Section>

          <!-- ⑤ 消費税 -->
          <${Section} number="⑤" title="消費税（概算）" color="#0d9488">
            <${KvTable} rows=${[
              ['仮受消費税 (売上の内10%想定)', report.recvTax],
              ['仮払消費税 (経費の内10%想定)', report.paidTax],
              ['__total__', report.taxPayable],
            ]} totalLabel="差引納付概算" />
            <div style=${{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
              ※ 簡易計算。軽減税率・非課税項目・インボイス区分経理は未反映。
              正確な納付額は税理士による申告書作成で確定してください。
            </div>
          </Section>

          <!-- ⑥ 損益計算書 -->
          <${Section} number="⑥" title="損益計算書" color="#dc2626">
            <${KvTable} rows=${[
              ['売上高', report.totalSales],
              ['経費', -report.totalCost],
              ['人件費', -report.effectivePayroll],
              ['__total__', report.grossProfit],
            ]} totalLabel="営業利益" />
          </Section>

          <!-- ⑦ 添付書類 -->
          <${Section} number="⑦" title="添付書類" color="#059669">
            <${KvTable} rows=${[
              ['登録書類', report.docsCount + ' 件'],
            ]} />
          </Section>

          <div class="tax-report-footer">
            有限会社NOVA 税理士レポート自動生成 · NovaCore v2
          </div>
        </div>
      `}

      ${printStyle}
    </div>
  `;
}

function Section({ number, title, color, children }) {
  return html`
    <div class="tax-section">
      <div class="tax-section-header" style=${{ borderLeftColor: color }}>
        <span class="tax-section-number" style=${{ color }}>${number}</span>
        <span class="tax-section-title">${title}</span>
      </div>
      <div class="tax-section-body">${children}</div>
    </div>
  `;
}

function KvTable({ rows, totalLabel }) {
  return html`
    <table class="tax-kv">
      <tbody>
        ${rows.map((r, i) => {
          const [label, value] = r;
          const isTotal = label === '__total__';
          return html`
            <tr key=${i} class=${isTotal ? 'tax-kv-total' : ''}>
              <td>${isTotal ? (totalLabel || '合計') : label}</td>
              <td class="num" style=${{
                textAlign: 'right',
                color: typeof value === 'number' && value < 0 ? 'var(--danger)' : 'var(--text)',
              }}>
                ${typeof value === 'number' ? formatYen(value) : value}
              </td>
            </tr>
          `;
        })}
      </tbody>
    </table>
  `;
}

// ---- Print-friendly CSS ---------------------------------------------------

const printStyle = html`
<style>
  .tax-report {
    background: #fff;
    padding: 16px 20px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
  }
  .tax-report-header {
    text-align: center;
    padding-bottom: 14px;
    margin-bottom: 18px;
    border-bottom: 2px solid #000;
  }
  .tax-report-title {
    font-size: 22pt;
    font-weight: 800;
    letter-spacing: 0.1em;
  }
  .tax-report-subtitle {
    font-size: 11pt;
    color: var(--text-3);
    margin-top: 4px;
  }
  .tax-section {
    margin-bottom: 14px;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--border-2);
  }
  .tax-section-header {
    padding: 8px 14px;
    border-left: 4px solid #6366f1;
    background: var(--bg-alt);
    display: flex; align-items: center; gap: 10px;
  }
  .tax-section-number {
    font-size: 15pt;
    font-weight: 800;
  }
  .tax-section-title {
    font-size: 12pt;
    font-weight: 700;
  }
  .tax-section-body {
    padding: 10px 14px;
  }
  .tax-kv {
    width: 100%;
    border-collapse: collapse;
    font-size: 11pt;
  }
  .tax-kv td {
    padding: 5px 8px;
    border-bottom: 1px solid var(--border-2);
  }
  .tax-kv td:last-child {
    font-family: var(--font-num);
  }
  .tax-kv-total td {
    font-weight: 700;
    border-top: 1.5px solid #000;
    border-bottom: none;
    padding-top: 8px;
    font-size: 12pt;
    background: var(--bg-alt);
  }
  .tax-kv-total td:last-child {
    color: var(--primary);
  }
  .tax-report-footer {
    text-align: center;
    margin-top: 20px;
    padding-top: 12px;
    font-size: 9pt;
    color: var(--text-4);
    border-top: 1px solid var(--border-2);
  }

  @media print {
    @page { size: A4; margin: 15mm; }
    body { background: #fff !important; }
    body * { visibility: hidden; }
    .tax-report, .tax-report * { visibility: visible; }
    .tax-report {
      position: absolute; top: 0; left: 0; right: 0;
      margin: 0; box-shadow: none; border: none; border-radius: 0;
    }
    .no-print { display: none !important; }
    .tax-section { page-break-inside: avoid; }
  }
</style>
`;
