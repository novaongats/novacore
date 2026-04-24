/* ============================================================
   NOVA Core v2 — Payroll / Records list (給与一覧)
   Browse past paychecks by month and employee.
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useMemo } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection, orderBy } from '../../store.js';
import { formatYen, monthLabel, asArray, sumBy } from '../../shared.js';
import { EMP_TYPE_MAP } from './constants.js';
import { PayslipOverlay } from './payslip.js';

const html = htm.bind(h);

export function ListTab() {
  const records = useCollection(repos.payrollRecords, () => [orderBy('month', 'desc')]);
  const employees = useCollection(repos.payrollEmployees);

  const [filterMonth, setFilterMonth] = useState('all');
  const [filterEmp, setFilterEmp] = useState('all');
  const [preview, setPreview] = useState(null);

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
    const header = ['月', '従業員ID', '氏名', '雇用形態', '総支給', '健保', '年金', '介護', '雇保', '所得税', '住民税', '控除計', '差引支給'];
    const lines = [header.join(',')];
    for (const r of filtered) {
      lines.push([
        r.month, r.empId, r.empName, EMP_TYPE_MAP[r.empType]?.label || r.empType,
        r.gross || 0, r.health || 0, r.pension || 0, r.care || 0,
        r.employment || 0, r.incomeTax || 0, r.residentTax || 0,
        r.totalDed || 0, r.net || 0,
      ].join(','));
    }
    const bom = '\uFEFF';
    const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `payroll_records_${filterMonth === 'all' ? 'all' : filterMonth}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 0);
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
          <table style=${{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style=${{ background: 'var(--bg-alt)' }}>
                <th style=${th}>月</th>
                <th style=${th}>氏名</th>
                <th style=${th}>形態</th>
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
    </div>
  `;
}

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
const th = {
  padding: '10px 14px', textAlign: 'left',
  color: 'var(--text-3)', fontWeight: 600, fontSize: 11,
  textTransform: 'uppercase', letterSpacing: '0.04em',
};
const td = {
  padding: '10px 14px',
};
