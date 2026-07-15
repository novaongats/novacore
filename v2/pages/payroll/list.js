/* ============================================================
   NOVA Core v2 — Payroll / Records list (給与一覧)
   Browse past paychecks by month and employee.
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useMemo, useEffect } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection, useDoc, orderBy } from '../../store.js';
import { formatYen, formatNum, monthLabel, asArray, sumBy, toCsv, downloadTextFile } from '../../shared.js';
import { EMP_TYPE_MAP } from './constants.js';
import { PayslipOverlay } from './payslip.js';
import { PrintPortal } from '../../print.js';

const html = htm.bind(h);

export function ListTab() {
  const records = useCollection(repos.payrollRecords, () => [orderBy('month', 'desc')]);
  const employees = useCollection(repos.payrollEmployees);

  const [filterMonth, setFilterMonth] = useState('all');
  const [filterEmp, setFilterEmp] = useState('all');
  const [preview, setPreview] = useState(null);
  const [sheet, setSheet] = useState(null);   // { month, records } — A4横一覧印刷

  const rows = asArray(records.data);
  const empList = asArray(employees.data);

  // Available months & employees from data
  const months = useMemo(() => {
    const set = new Set(rows.map(r => r.month).filter(Boolean));
    return [...set].sort().reverse();
  }, [rows]);

  const filtered = useMemo(() => {
    let r = rows;
    if (filterMonth !== 'all') r = r.filter(x => x.month === filterMonth);
    if (filterEmp !== 'all')   r = r.filter(x => x.empId === filterEmp);
    return r;
  }, [rows, filterMonth, filterEmp]);

  const totals = useMemo(() => ({
    gross:     sumBy(filtered, r => r.gross),
    social:    sumBy(filtered, r => r.social),
    incomeTax: sumBy(filtered, r => r.incomeTax),
    net:       sumBy(filtered, r => r.net),
  }), [filtered]);

  function exportCsv() {
    const rows = [['月', '従業員ID', '氏名', '雇用形態', '基本給', '歩合', '総支給', '通勤手当', '健保', '年金', '介護', '子育て支援金', '雇保', '所得税', '住民税', '控除計', '差引支給']];
    for (const r of filtered) {
      rows.push([
        r.month, r.empId, r.empName, EMP_TYPE_MAP[r.empType]?.label || r.empType,
        r.basePay || 0, r.commission || 0,
        r.gross || 0, r.commuteTotal || 0, r.health || 0, r.pension || 0, r.care || 0,
        r.childSupport || 0,
        r.employment || 0, r.incomeTax || 0, r.residentTax || 0,
        r.totalDed || 0, r.net || 0,
      ]);
    }
    downloadTextFile(toCsv(rows), `payroll_records_${filterMonth === 'all' ? 'all' : filterMonth}.csv`);
  }

  // 一覧印刷: 選択中の月の全従業員（従業員フィルタは無視して全員分）
  function openSheet() {
    if (filterMonth === 'all') return;
    const monthRecords = rows
      .filter(r => r.month === filterMonth)
      .slice()
      .sort((a, b) => (a.empName || '').localeCompare(b.empName || '', 'ja'));
    setSheet({ month: filterMonth, records: monthRecords });
  }

  return html`
    <div>
      <div style=${{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
        flexWrap: 'wrap',
      }}>
        <select value=${filterMonth} onChange=${e => setFilterMonth(e.target.value)}
                style=${selectCompact}>
          <option value="all">すべての月</option>
          ${months.map(m => html`<option key=${m} value=${m}>${monthLabel(m)}</option>`)}
        </select>
        <select value=${filterEmp} onChange=${e => setFilterEmp(e.target.value)}
                style=${selectCompact}>
          <option value="all">全従業員</option>
          ${empList.map(e => html`<option key=${e.id} value=${e.id}>${e.name}</option>`)}
        </select>

        <div style=${{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button class="btn btn-ghost" onClick=${exportCsv} disabled=${filtered.length === 0}>
            📥 CSV出力
          </button>
          <button class="btn btn-ghost" onClick=${openSheet}
                  disabled=${filterMonth === 'all' || rows.every(r => r.month !== filterMonth)}
                  title=${filterMonth === 'all' ? '月を選択すると印刷できます' : '選択月の全従業員を1枚のA4横にまとめて印刷'}>
            🖨 一覧を印刷
          </button>
          <button class="btn" onClick=${() => setPreview({ records: filtered })} disabled=${filtered.length === 0}>
            🖨 明細を印刷
          </button>
        </div>
      </div>

      ${filtered.length > 0 && html`
        <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
          <${Kpi} label="総支給合計" value=${formatYen(totals.gross)} />
          <${Kpi} label="社会保険料" value=${formatYen(totals.social)} />
          <${Kpi} label="所得税"    value=${formatYen(totals.incomeTax)} />
          <${Kpi} label="差引支給額" value=${formatYen(totals.net)} primary />
        </div>
      `}

      ${filtered.length === 0 ? html`
        <div class="card" style=${{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-3)' }}>
          <div style=${{ fontSize: 32, marginBottom: 10, opacity: .4 }}>📋</div>
          ${rows.length === 0 ? '給与計算結果がまだありません' : 'フィルタ条件に一致するレコードがありません'}
        </div>
      ` : html`
        <div class="card" style=${{ padding: 0, overflow: 'auto' }}>
          <table style=${{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style=${{ background: 'var(--bg-alt)' }}>
                <th style=${th}>月</th>
                <th style=${th}>氏名</th>
                <th style=${th}>形態</th>
                <th style=${{ ...th, textAlign: 'right' }}>基本給</th>
                <th style=${{ ...th, textAlign: 'right' }}>歩合</th>
                <th style=${{ ...th, textAlign: 'right' }}>総支給</th>
                <th style=${{ ...th, textAlign: 'right' }}>社保</th>
                <th style=${{ ...th, textAlign: 'right' }}>所得税</th>
                <th style=${{ ...th, textAlign: 'right' }}>住民税</th>
                <th style=${{ ...th, textAlign: 'right' }}>差引</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map(r => html`
                <tr key=${r.id} style=${{ borderTop: '1px solid var(--border-2)' }}>
                  <td style=${td}>${monthLabel(r.month)}</td>
                  <td style=${td}>${r.empName}</td>
                  <td style=${{ ...td, fontSize: 11, color: 'var(--text-3)' }}>
                    ${EMP_TYPE_MAP[r.empType]?.label || r.empType}
                  </td>
                  <td class="num" style=${{ ...td, textAlign: 'right', color: 'var(--text-2)' }}>${formatYen(r.basePay)}</td>
                  <td class="num" style=${{ ...td, textAlign: 'right', color: 'var(--text-2)' }}>
                    ${(r.commission || 0) > 0 ? formatYen(r.commission) : '-'}
                  </td>
                  <td class="num" style=${{ ...td, textAlign: 'right' }}>${formatYen(r.gross)}</td>
                  <td class="num" style=${{ ...td, textAlign: 'right', color: 'var(--text-2)' }}>${formatYen(r.social)}</td>
                  <td class="num" style=${{ ...td, textAlign: 'right', color: 'var(--text-2)' }}>${formatYen(r.incomeTax)}</td>
                  <td class="num" style=${{ ...td, textAlign: 'right', color: 'var(--text-2)' }}>${formatYen(r.residentTax)}</td>
                  <td class="num" style=${{ ...td, textAlign: 'right', fontWeight: 700, color: 'var(--primary)' }}>
                    ${formatYen(r.net)}
                  </td>
                  <td style=${{ ...td, textAlign: 'right' }}>
                    <button class="btn btn-ghost" onClick=${() => setPreview({ records: [r] })}
                            title="明細" style=${{ padding: '4px 8px' }}>👁</button>
                  </td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>
        <div style=${{ marginTop: 10, fontSize: 12, color: 'var(--text-3)' }}>
          ${filtered.length} 件
        </div>
      `}

      ${preview && html`
        <${PayslipOverlay} records=${preview.records} onClose=${() => setPreview(null)} />
      `}
      ${sheet && html`
        <${PayrollSheetOverlay} month=${sheet.month} records=${sheet.records}
                                onClose=${() => setSheet(null)} />
      `}
    </div>
  `;
}

// ---- 給与一覧表（A4横・全従業員1枚）印刷オーバーレイ --------------------------

const SHEET_NUM_COLS = [
  { key: 'basePay',      label: '基本給' },
  { key: 'commission',   label: '歩合' },
  { key: 'allowance',    label: '諸手当' },
  { key: 'commuteTotal', label: '通勤' },
  { key: 'gross',        label: '総支給', strong: true },
  { key: 'health',       label: '健保' },
  { key: 'pension',      label: '厚年' },
  { key: 'care',         label: '介護' },
  { key: 'childSupport', label: '支援金' },
  { key: 'employment',   label: '雇用' },
  { key: 'incomeTax',    label: '所得税' },
  { key: 'residentTax',  label: '住民税' },
  { key: 'totalDed',     label: '控除計', strong: true },
  { key: 'net',          label: '差引支給', strong: true },
];

export function PayrollSheetOverlay({ month, records, onClose }) {
  const issuerQ = useDoc(repos.settings, 'invoiceIssuer');
  const company = issuerQ.data?.companyName || '有限会社NOVA';
  const printed = new Date().toLocaleDateString('ja-JP');

  // A4横の @page はオーバーレイ表示中のみ有効化し、閉じたら必ず除去する。
  // taxdoc の applyPageOrientation（#taxdoc-page-orient）とは別の style 要素で
  // 管理し、後から head に追加することで表示中はこちらが優先される。
  useEffect(() => {
    const el = document.createElement('style');
    el.id = 'payroll-sheet-orient';
    el.textContent = '@media print { @page { size: A4 landscape; margin: 0; } }';
    document.head.appendChild(el);
    return () => { el.remove(); };
  }, []);

  const totals = {};
  for (const c of SHEET_NUM_COLS) totals[c.key] = sumBy(records, r => r[c.key]);

  return html`
    <${PrintPortal}>
    <div class="paysheet-overlay">
      <div class="paysheet-toolbar no-print">
        <div style=${{ color: '#fff', fontWeight: 600 }}>
          給与一覧表
          <span style=${{ marginLeft: 10, fontSize: 12, opacity: .7 }}>
            ${monthLabel(month)} · ${records.length} 名 · A4横
          </span>
        </div>
        <div style=${{ display: 'flex', gap: 8 }}>
          <button class="btn" style=${{ background: '#10b981' }}
                  onClick=${() => window.print()}>🖨 印刷 / PDF保存</button>
          <button class="btn btn-ghost" onClick=${onClose}
                  style=${{ background: 'rgba(255,255,255,.12)', color: '#fff', borderColor: 'transparent' }}>
            ✕ 閉じる
          </button>
        </div>
      </div>

      <div class="paysheet-stage">
        <div class="paysheet-paper">
          <div class="paysheet-head">
            <div class="paysheet-brand">
              <div class="paysheet-logo">N</div>
              <div>
                <div class="paysheet-corp-name">${company}</div>
                <div class="paysheet-sub">対象月: <strong>${monthLabel(month)}</strong>（単位: 円）</div>
              </div>
            </div>
            <div class="paysheet-doc">
              <div class="paysheet-doc-en">PAYROLL SHEET</div>
              <div class="paysheet-doc-ja">給与一覧表</div>
            </div>
          </div>
          <div class="paysheet-rule">
            <div class="acc"></div>
            <div class="rest"></div>
          </div>

          <table class="paysheet-table">
            <thead>
              <tr>
                <th style=${{ textAlign: 'left' }}>氏名</th>
                <th style=${{ textAlign: 'left' }}>形態</th>
                ${SHEET_NUM_COLS.map((c, i) => html`
                  <th key=${i} style=${{ textAlign: 'right' }}>${c.label}</th>
                `)}
              </tr>
            </thead>
            <tbody>
              ${records.map(r => html`
                <tr key=${r.id}>
                  <td class="name">${r.empName || '-'}</td>
                  <td>${EMP_TYPE_MAP[r.empType]?.label || r.empType || '-'}</td>
                  ${SHEET_NUM_COLS.map((c, i) => html`
                    <td key=${i} class=${'num' + (c.strong ? ' strong' : '')}>
                      ${(r[c.key] || 0) !== 0 ? formatNum(r[c.key]) : '-'}
                    </td>
                  `)}
                </tr>
              `)}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="2">合計（${records.length} 名）</td>
                ${SHEET_NUM_COLS.map((c, i) => html`
                  <td key=${i} class="num">${formatNum(totals[c.key])}</td>
                `)}
              </tr>
            </tfoot>
          </table>

          <div class="paysheet-footer">
            <div>対象月: ${monthLabel(month)} ・ 出力日: ${printed}</div>
            <div class="credit">Generated by <span class="brand">NOVA Core</span></div>
          </div>
        </div>
      </div>

      ${sheetStyle}
    </div>
    </${PrintPortal}>
  `;
}

const sheetStyle = html`
<style>
  .paysheet-overlay {
    position: fixed; inset: 0; background: rgba(15,23,42,.92);
    z-index: 99999; display: flex; flex-direction: column;
  }
  .paysheet-toolbar {
    padding: 12px 20px; background: #1e293b; flex-shrink: 0;
    display: flex; justify-content: space-between; align-items: center;
  }
  .paysheet-stage {
    flex: 1; overflow: auto; padding: 24px; background: #2a3442;
    display: flex; flex-direction: column; align-items: center;
  }
  .paysheet-paper {
    width: 297mm; min-height: 210mm; padding: 12mm 14mm 10mm;
    background: #fff; color: #0f172a;
    font-family: 'Noto Sans JP', 'Hiragino Kaku Gothic ProN', sans-serif;
    font-size: 9pt; line-height: 1.5;
    box-shadow: 0 4px 24px rgba(0,0,0,.3); box-sizing: border-box;
    display: flex; flex-direction: column;
  }
  .paysheet-head {
    display: flex; justify-content: space-between; align-items: center;
  }
  .paysheet-brand { display: flex; align-items: center; }
  .paysheet-logo {
    width: 20pt; height: 20pt;
    background: #6366f1; border-radius: 4.5pt;
    color: #fff; font-family: 'Sora', 'Inter', sans-serif;
    font-size: 12pt; font-weight: 800;
    line-height: 20pt; text-align: center;
    margin-right: 7pt;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .paysheet-corp-name { font-size: 11pt; font-weight: 700; letter-spacing: .02em; }
  .paysheet-sub { font-size: 8pt; color: #64748b; margin-top: 1pt; }
  .paysheet-doc { text-align: right; }
  .paysheet-doc-en {
    font-family: 'Sora', 'Inter', sans-serif;
    font-size: 12.5pt; font-weight: 800;
    letter-spacing: .26em; margin-right: -.26em;
    line-height: 1.2;
  }
  .paysheet-doc-ja {
    font-size: 7.5pt; color: #64748b;
    letter-spacing: .38em; margin-right: -.38em; margin-top: 1pt;
  }
  .paysheet-rule { display: flex; align-items: center; margin: 7pt 0 10pt; }
  .paysheet-rule .acc {
    width: 16mm; height: 2.2pt; background: #6366f1;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .paysheet-rule .rest {
    flex: 1; height: .5pt; background: #dde1ea;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  .paysheet-table { width: 100%; border-collapse: collapse; font-size: 7.6pt; }
  .paysheet-table th {
    border-bottom: 1pt solid #0f172a;
    padding: 3.5pt 4pt; font-weight: 700; font-size: 7.2pt;
    color: #475569; white-space: nowrap;
  }
  .paysheet-table td {
    border-bottom: .5pt solid #e6e9f1; padding: 3.4pt 4pt; white-space: nowrap;
  }
  .paysheet-table td.name { font-weight: 600; }
  .paysheet-table td.num {
    text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 7.4pt;
    color: #334155;
  }
  .paysheet-table td.num.strong { font-weight: 700; color: #0f172a; }
  .paysheet-table tbody tr:nth-child(even) td { background: #f7f8fc;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .paysheet-table tfoot td {
    border-top: 1.5pt solid #0f172a; border-bottom: none;
    font-weight: 700; padding-top: 4.5pt;
  }
  .paysheet-table tfoot td.num { text-align: right; font-family: 'JetBrains Mono', monospace; color: #0f172a; }
  .paysheet-table tfoot td.num:last-child { color: #4338ca; }

  .paysheet-footer {
    margin-top: auto;
    padding-top: 5pt;
    border-top: .5pt solid #dde1ea;
    display: flex; justify-content: space-between; align-items: baseline;
    font-size: 7pt; color: #94a3b8; letter-spacing: .04em;
  }
  .paysheet-footer .credit { font-family: 'Sora', 'Inter', sans-serif; letter-spacing: .08em; }
  .paysheet-footer .brand { font-weight: 700; color: #6366f1; }

  /* @page (A4 landscape) は表示中のみ #payroll-sheet-orient (head) が管理する */
  @media print {
    body { background: #fff !important; }
    .no-print { display: none !important; }
    .paysheet-overlay { position: static; background: #fff; }
    .paysheet-stage { padding: 0; background: #fff; overflow: visible; display: block; }
    .paysheet-paper { box-shadow: none; width: auto; min-height: 0; }
    .paysheet-table tr { break-inside: avoid; }
    .paysheet-table thead { display: table-header-group; }
  }
</style>
`;

function Kpi({ label, value, primary }) {
  return html`
    <div class="card" style=${{ padding: 16 }}>
      <div style=${{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600,
                     textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
        ${label}
      </div>
      <div class="num" style=${{
        fontSize: 20, fontWeight: 700,
        color: primary ? 'var(--primary)' : 'var(--text)',
      }}>${value}</div>
    </div>
  `;
}

const selectCompact = {
  padding: '8px 10px', border: '1px solid var(--border)',
  borderRadius: 8, background: 'var(--surface)', fontSize: 12,
};
// 列が増えたため（基本給・歩合）paddingを詰めて収める
const th = {
  padding: '9px 9px', textAlign: 'left',
  color: 'var(--text-3)', fontWeight: 600, fontSize: 10.5,
  textTransform: 'uppercase', letterSpacing: '0.02em',
  whiteSpace: 'nowrap',
};
const td = {
  padding: '9px 9px', whiteSpace: 'nowrap',
};
