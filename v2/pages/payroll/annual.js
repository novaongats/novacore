/* ============================================================
   NOVA Core v2 — Payroll / Annual income management
   Detect 年収の壁 (年度対応: 〜2024=103万等 / 2025〜=123万・160万等)
   and project year-end income.
   壁判定の年収は非課税通勤手当を除いた課税支給ベース。
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useMemo } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection, where } from '../../store.js';
import { formatYen, asArray } from '../../shared.js';
import { EMP_TYPE_MAP, getIncomeWalls } from './constants.js';

const html = htm.bind(h);

export function AnnualTab() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);

  const employees = useCollection(repos.payrollEmployees);
  const records = useCollection(
    repos.payrollRecords,
    () => [
      where('month', '>=', year + '-01'),
      where('month', '<=', year + '-12'),
    ],
    [year],
  );
  const bonuses = useCollection(
    repos.payrollBonus,
    () => [
      where('month', '>=', year + '-01'),
      where('month', '<=', year + '-12'),
    ],
    [year],
  );

  const empList = asArray(employees.data);
  const walls = getIncomeWalls(year);

  // Aggregate per-employee
  const summary = useMemo(() => {
    const m = new Map();
    for (const e of empList) {
      m.set(e.id, {
        emp: e,
        monthsWithRecord: 0,
        lastMonthNum: 0,
        monthlyGross: 0,
        monthlyIncomeTax: 0,
        monthlySocial: 0,
        monthlyNet: 0,
        bonusGross: 0,
        bonusIncomeTax: 0,
        bonusSocial: 0,
        bonusNet: 0,
      });
    }
    for (const r of asArray(records.data)) {
      const row = m.get(r.empId);
      if (!row) continue;
      row.monthsWithRecord += 1;
      // 壁判定の年収は非課税通勤手当を除いた課税支給ベース
      row.monthlyGross     += Math.max(0, (Number(r.gross) || 0) - (Number(r.commuteNonTaxable) || 0));
      row.monthlyIncomeTax += Number(r.incomeTax) || 0;
      row.monthlySocial    += Number(r.social) || 0;
      row.monthlyNet       += Number(r.net) || 0;
      const mNum = Number((r.month || '').slice(5, 7)) || 0;
      if (mNum > row.lastMonthNum) row.lastMonthNum = mNum;
    }
    for (const b of asArray(bonuses.data)) {
      const row = m.get(b.empId);
      if (!row) continue;
      row.bonusGross     += Number(b.amount) || 0;
      row.bonusIncomeTax += Number(b.incomeTax) || 0;
      row.bonusSocial    += Number(b.social) || 0;
      row.bonusNet       += Number(b.net) || 0;
    }
    for (const row of m.values()) {
      row.actualGross = row.monthlyGross + row.bonusGross;
      row.actualNet   = row.monthlyNet + row.bonusNet;
      // 見込み = 記録がある最終月までの実績 + 残月 × 直近平均
      if (row.monthsWithRecord === 0) {
        row.projectedGross = row.actualGross;
      } else {
        const avgMonthly = row.monthlyGross / row.monthsWithRecord;
        row.projectedGross = row.actualGross + Math.max(0, 12 - row.lastMonthNum) * avgMonthly;
      }
    }
    return m;
  }, [empList, records.data, bonuses.data]);

  return html`
    <div>
      <div style=${{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18,
      }}>
        <button class="btn btn-ghost" onClick=${() => setYear(year - 1)}>◀</button>
        <div style=${{ fontSize: 16, fontWeight: 700, minWidth: 80, textAlign: 'center' }}>
          ${year}年
        </div>
        <button class="btn btn-ghost" onClick=${() => setYear(year + 1)}>▶</button>
        <button class="btn btn-ghost" onClick=${() => setYear(thisYear)}>今年</button>

        <div style=${{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)' }}>
          ${records.loading || bonuses.loading ? '集計中...' : `${asArray(records.data).length}件の月次 + ${asArray(bonuses.data).length}件の賞与`}
        </div>
      </div>

      <${WallsLegend} walls=${walls} year=${year} />

      ${empList.length === 0 ? html`
        <div class="note note-warn">
          従業員が未登録です。「従業員マスタ」タブから追加してください。
        </div>
      ` : html`
        <div class="card" style=${{ padding: 0, overflow: 'auto' }}>
          <table style=${{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style=${{ background: 'var(--bg-alt)' }}>
                <th style=${th}>従業員</th>
                <th style=${{ ...th, textAlign: 'right' }}>月次累計（課税）</th>
                <th style=${{ ...th, textAlign: 'right' }}>賞与累計</th>
                <th style=${{ ...th, textAlign: 'right' }}>実績合計</th>
                <th style=${{ ...th, textAlign: 'right' }}>年末見込</th>
                <th style=${th}>壁到達状況</th>
              </tr>
            </thead>
            <tbody>
              ${empList.map(e => html`
                <${SummaryRow} key=${e.id} emp=${e} sum=${summary.get(e.id)} walls=${walls} />
              `)}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
}

function WallsLegend({ walls, year }) {
  return html`
    <div class="card" style=${{ padding: 14, marginBottom: 14 }}>
      <div style=${{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
        📏 年収の壁（${year}年${Number(year) >= 2025 ? '・令和7年度税制改正反映' : '・旧制度'}）
      </div>
      <div style=${{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        ${walls.map(w => html`
          <div key=${w.threshold} style=${{
            fontSize: 11, padding: '4px 10px', borderRadius: 999,
            background: 'var(--bg-alt)', color: 'var(--text-2)',
          }} title=${w.description}>
            <strong>${w.label}</strong> — ${w.description}
          </div>
        `)}
      </div>
    </div>
  `;
}

function SummaryRow({ emp, sum, walls }) {
  if (!sum) return null;
  const type = EMP_TYPE_MAP[emp.type] || EMP_TYPE_MAP.regular;
  const projected = sum.projectedGross;
  const actual    = sum.actualGross;

  // Current wall status
  const crossedWalls = walls.filter(w => actual >= w.threshold);
  const nextWall     = walls.find(w => actual < w.threshold);
  const approach = nextWall && (nextWall.threshold - projected <= 100000);

  return html`
    <tr style=${{ borderTop: '1px solid var(--border-2)' }}>
      <td style=${td}>
        <div style=${{ fontSize: 13, fontWeight: 600 }}>${emp.name}</div>
        <div style=${{ fontSize: 11, color: 'var(--text-3)' }}>${type.label}</div>
      </td>
      <td class="num" style=${{ ...td, textAlign: 'right' }}>
        ${formatYen(sum.monthlyGross)}
        <div style=${{ fontSize: 10, color: 'var(--text-3)' }}>(${sum.monthsWithRecord}ヶ月)</div>
      </td>
      <td class="num" style=${{ ...td, textAlign: 'right' }}>
        ${formatYen(sum.bonusGross)}
      </td>
      <td class="num" style=${{ ...td, textAlign: 'right', fontWeight: 700 }}>
        ${formatYen(actual)}
      </td>
      <td class="num" style=${{ ...td, textAlign: 'right', color: 'var(--text-2)' }}>
        ${formatYen(projected)}
      </td>
      <td style=${td}>
        ${crossedWalls.length === 0 && nextWall && html`
          <span style=${{ fontSize: 11, color: 'var(--text-3)' }}>
            ${nextWall.label}まで残 ${formatYen(nextWall.threshold - actual)}
          </span>
        `}
        ${crossedWalls.map(w => html`
          <span key=${w.threshold} style=${{
            display: 'inline-block', fontSize: 10, padding: '2px 8px', borderRadius: 999,
            margin: '2px 4px 2px 0', fontWeight: 600,
            background: 'var(--danger-soft)', color: 'var(--danger)',
          }}>✕ ${w.label}</span>
        `)}
        ${approach && nextWall && html`
          <div style=${{ marginTop: 4, fontSize: 11, color: '#d97706', fontWeight: 600 }}>
            ⚠ 年末見込で ${nextWall.label} 超過の可能性
          </div>
        `}
      </td>
    </tr>
  `;
}

const th = {
  padding: '10px 14px', textAlign: 'left',
  color: 'var(--text-3)', fontWeight: 600, fontSize: 11,
  textTransform: 'uppercase', letterSpacing: '0.04em',
};
const td = { padding: '12px 14px', verticalAlign: 'top' };
