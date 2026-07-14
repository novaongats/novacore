/* ============================================================
   NOVA Core v2 — Payroll / 算定基礎届
   April/May/June mean → determine new standard remuneration.
   Updates emp.stdRemuneration on apply.
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useMemo } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection, where } from '../../store.js';
import { formatYen, asArray } from '../../shared.js';
import { getHealthStandard, findGrade } from './calc.js';
import { EMP_TYPE_MAP } from './constants.js';

const html = htm.bind(h);

export function AssessmentTab() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [busyId, setBusyId] = useState(null);

  const employees = useCollection(repos.payrollEmployees);
  // Pull April + May + June records for the selected year
  const records = useCollection(
    repos.payrollRecords,
    () => [
      where('month', '>=', `${year}-04`),
      where('month', '<=', `${year}-06`),
    ],
    [year],
  );

  const empList = asArray(employees.data);
  const recByKey = useMemo(() => {
    const m = new Map();
    for (const r of asArray(records.data)) m.set(`${r.month}|${r.empId}`, r);
    return m;
  }, [records.data]);

  function rowFor(emp) {
    const m4 = recByKey.get(`${year}-04|${emp.id}`);
    const m5 = recByKey.get(`${year}-05|${emp.id}`);
    const m6 = recByKey.get(`${year}-06|${emp.id}`);
    const got = [m4, m5, m6].filter(Boolean);
    const avg = got.length > 0
      ? Math.round(got.reduce((s, r) => s + (Number(r.gross) || 0), 0) / got.length)
      : null;
    const newStd = avg != null ? getHealthStandard(avg) : null;
    const curStd = emp.stdRemuneration || (emp.monthlySalary ? getHealthStandard(emp.monthlySalary) : 0);
    const diff = newStd != null ? newStd - curStd : 0;
    const gradeChange = newStd != null ? (findGrade(newStd) || 0) - (findGrade(curStd) || 0) : 0;
    return { m4, m5, m6, avg, newStd, curStd, diff, gradeChange };
  }

  async function apply(emp, newStd) {
    setBusyId(emp.id);
    try {
      await repos.payrollEmployees.upsert({ id: emp.id, stdRemuneration: newStd });
    } catch (e) {
      console.error('[payroll/assessment] apply failed', e);
      alert('更新に失敗: ' + (e.message || e));
    } finally {
      setBusyId(null);
    }
  }

  async function applyAll() {
    if (!confirm('全員の標準報酬月額を一括で更新します。よろしいですか？')) return;
    for (const emp of empList) {
      const r = rowFor(emp);
      if (r.newStd != null && r.newStd !== r.curStd) {
        await apply(emp, r.newStd);
      }
    }
  }

  function exportCsv() {
    const header = ['氏名', '4月', '5月', '6月', '平均', '現標準報酬', '現等級', '新標準報酬', '新等級', '等級変動'];
    const lines = [header.join(',')];
    for (const emp of empList) {
      const r = rowFor(emp);
      lines.push([
        emp.name,
        r.m4?.gross || 0, r.m5?.gross || 0, r.m6?.gross || 0,
        r.avg || 0,
        r.curStd, findGrade(r.curStd) || '-',
        r.newStd || '-', r.newStd ? (findGrade(r.newStd) || '-') : '-',
        r.gradeChange > 0 ? '+' + r.gradeChange : r.gradeChange,
      ].join(','));
    }
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `assessment_${year}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 0);
  }

  return html`
    <div>
      <div style=${{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <button class="btn btn-ghost" onClick=${() => setYear(year - 1)}>◀</button>
        <div style=${{ fontSize: 16, fontWeight: 700, minWidth: 80, textAlign: 'center' }}>
          ${year}年 算定基礎届
        </div>
        <button class="btn btn-ghost" onClick=${() => setYear(year + 1)}>▶</button>
        <button class="btn btn-ghost" onClick=${() => setYear(thisYear)}>今年</button>

        <div style=${{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button class="btn btn-ghost" onClick=${exportCsv} disabled=${empList.length === 0}>
            📥 CSV出力
          </button>
          <button class="btn" onClick=${applyAll} disabled=${empList.length === 0}>
            ✓ 全員の等級を一括更新
          </button>
        </div>
      </div>

      <div class="note note-info">
        ${year}年 4月・5月・6月の月次給与（総支給）平均から標準報酬月額を算定します。<br/>
        日本年金機構への提出期限は毎年 <strong>7月10日</strong>。新しい等級は9月から適用されます。
      </div>

      ${empList.length === 0 ? html`
        <div class="note note-warn">従業員が未登録です。</div>
      ` : html`
        <div class="card" style=${{ padding: 0, overflow: 'auto' }}>
          <table style=${{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style=${{ background: 'var(--bg-alt)' }}>
                <th style=${th} rowspan="2">氏名</th>
                <th style=${{ ...th, textAlign: 'center' }} colspan="4">4〜6月 月次給与</th>
                <th style=${{ ...th, textAlign: 'right' }} rowspan="2">現標準報酬<br/>(等級)</th>
                <th style=${{ ...th, textAlign: 'right' }} rowspan="2">新標準報酬<br/>(等級)</th>
                <th style=${th} rowspan="2">変動</th>
                <th rowspan="2"></th>
              </tr>
              <tr style=${{ background: 'var(--bg-alt)' }}>
                <th style=${{ ...th, textAlign: 'right' }}>4月</th>
                <th style=${{ ...th, textAlign: 'right' }}>5月</th>
                <th style=${{ ...th, textAlign: 'right' }}>6月</th>
                <th style=${{ ...th, textAlign: 'right' }}>平均</th>
              </tr>
            </thead>
            <tbody>
              ${empList.map(emp => {
                const r = rowFor(emp);
                const canApply = r.newStd != null && r.newStd !== r.curStd;
                return html`
                  <tr key=${emp.id} style=${{ borderTop: '1px solid var(--border-2)' }}>
                    <td style=${td}>
                      <div style=${{ fontSize: 13, fontWeight: 600 }}>${emp.name}</div>
                      <div style=${{ fontSize: 10, color: 'var(--text-3)' }}>
                        ${EMP_TYPE_MAP[emp.type]?.label || emp.type}
                      </div>
                    </td>
                    <td class="num" style=${{ ...td, textAlign: 'right' }}>
                      ${r.m4 ? formatYen(r.m4.gross) : '-'}
                    </td>
                    <td class="num" style=${{ ...td, textAlign: 'right' }}>
                      ${r.m5 ? formatYen(r.m5.gross) : '-'}
                    </td>
                    <td class="num" style=${{ ...td, textAlign: 'right' }}>
                      ${r.m6 ? formatYen(r.m6.gross) : '-'}
                    </td>
                    <td class="num" style=${{ ...td, textAlign: 'right', fontWeight: 700 }}>
                      ${r.avg != null ? formatYen(r.avg) : '-'}
                    </td>
                    <td class="num" style=${{ ...td, textAlign: 'right' }}>
                      ${formatYen(r.curStd)}
                      <div style=${{ fontSize: 10, color: 'var(--text-3)' }}>(${findGrade(r.curStd) || '-'}級)</div>
                    </td>
                    <td class="num" style=${{ ...td, textAlign: 'right' }}>
                      ${r.newStd != null ? formatYen(r.newStd) : '-'}
                      ${r.newStd != null && html`<div style=${{ fontSize: 10, color: 'var(--text-3)' }}>
                        (${findGrade(r.newStd) || '-'}級)
                      </div>`}
                    </td>
                    <td style=${td}>
                      ${r.gradeChange !== 0 && html`<span style=${{
                        fontSize: 11, padding: '2px 8px', borderRadius: 999, fontWeight: 600,
                        background: r.gradeChange > 0 ? '#fef3c7' : '#dbeafe',
                        color:      r.gradeChange > 0 ? '#92400e' : '#1e40af',
                      }}>${r.gradeChange > 0 ? '+' : ''}${r.gradeChange}級</span>`}
                    </td>
                    <td style=${{ ...td, textAlign: 'right' }}>
                      ${canApply && html`
                        <button class="btn btn-ghost"
                                onClick=${() => apply(emp, r.newStd)}
                                disabled=${busyId === emp.id}>
                          ${busyId === emp.id ? '...' : '適用'}
                        </button>
                      `}
                    </td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
}

const th = {
  padding: '10px 14px', textAlign: 'left',
  color: 'var(--text-3)', fontWeight: 600, fontSize: 11,
  textTransform: 'uppercase', letterSpacing: '0.04em',
};
const td = { padding: '11px 14px' };
