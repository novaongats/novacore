/* ============================================================
   NOVA Core v2 — Sales / Dashboard tab
   Monthly KPIs, dept-level P&L, 6-month trend, category ranking.
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useMemo } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection, where } from '../../store.js';
import {
  dayjs, SALES_DEPTS, deptLabel, deptColor,
  formatYen, formatPct, thisMonth, monthLabel, addMonths, lastNMonths,
  sumBy, asArray,
} from '../../shared.js';

const html = htm.bind(h);

const TREND_MONTHS = 6;

// ---- Main ------------------------------------------------------------------

export function DashboardTab() {
  const [month, setMonth] = useState(thisMonth());

  // Load categories (always the full set)
  const cats = useCollection(repos.salesCategories);

  // Load entries & costs for the TREND window (6 months ending at selected month).
  const months = useMemo(() => lastNMonths(month, TREND_MONTHS), [month]);
  const rangeStart = months[0] + '-01';
  const rangeEnd   = dayjs(month + '-01').add(1, 'month').format('YYYY-MM-DD');

  const entries = useCollection(
    repos.salesEntries,
    () => [
      where('date', '>=', rangeStart),
      where('date', '<',  rangeEnd),
    ],
    [rangeStart, rangeEnd],
  );

  const costs = useCollection(
    repos.salesCosts,
    () => [
      where('yearMonth', '>=', months[0]),
      where('yearMonth', '<=', month),
    ],
    [months[0], month],
  );

  // Build (month, catId) → { revenue, manualCost, revShareCost }
  const grid = useMemo(() => buildGrid(asArray(cats.data), asArray(entries.data), asArray(costs.data), months),
    [cats.data, entries.data, costs.data, months.join(',')]);

  const loading = cats.loading || entries.loading || costs.loading;

  // Per-month aggregates
  const perMonth = useMemo(() => summarizeByMonth(grid, months), [grid, months]);

  const currentMonth = perMonth[month] || { revenue: 0, cost: 0 };
  const prevMonthKey = months[months.length - 2];
  const prevMonth = perMonth[prevMonthKey] || { revenue: 0, cost: 0 };

  return html`
    <div>
      <${MonthBar} month=${month} onChange=${setMonth} />

      <${KpiRow} current=${currentMonth} prev=${prevMonth} />

      ${loading ? html`<div style=${{ color: 'var(--text-3)', padding: 20 }}>集計中...</div>` : html`
        <${DeptBars} grid=${grid} month=${month} cats=${asArray(cats.data)} />
        <${CategoryRanking} grid=${grid} month=${month} cats=${asArray(cats.data)} />
        <${TrendTable} perMonth=${perMonth} months=${months} month=${month} />
      `}
    </div>
  `;
}

// ---- Aggregation helpers ---------------------------------------------------

/**
 * Build lookup: key "YYYY-MM|catId" → { month, cat, revenue, manualCost, revShareCost }
 */
function buildGrid(cats, entries, costs, months) {
  const monthSet = new Set(months);
  const grid = new Map();

  // Seed cells for each (month, cat) so empty rows are addressable.
  for (const m of months) {
    for (const c of cats) {
      grid.set(m + '|' + c.id, {
        month: m, cat: c,
        revenue: 0, manualCost: 0, revShareCost: 0,
      });
    }
  }

  // Revenue from salesEntries
  for (const e of entries) {
    const m = (e.date || '').substring(0, 7);
    if (!monthSet.has(m)) continue;
    const row = grid.get(m + '|' + e.catId);
    if (row) row.revenue += Number(e.amount || 0);
  }

  // Manual costs from salesCosts
  for (const c of costs) {
    if (!monthSet.has(c.yearMonth)) continue;
    const row = grid.get(c.yearMonth + '|' + c.catId);
    if (row) row.manualCost += sumBy(asArray(c.items), i => i.amount);
  }

  // Rev-share cost (computed)
  for (const row of grid.values()) {
    const rs = row.cat.revShare;
    if (rs?.enabled && row.revenue > 0) {
      const pct = Math.max(0, Math.min(100, Number(rs.companyPct) || 0));
      row.revShareCost = Math.round(row.revenue * (100 - pct) / 100);
    }
  }

  return grid;
}

function summarizeByMonth(grid, months) {
  const out = {};
  for (const m of months) out[m] = { revenue: 0, cost: 0 };
  for (const row of grid.values()) {
    out[row.month].revenue += row.revenue;
    out[row.month].cost += row.manualCost + row.revShareCost;
  }
  return out;
}

function summarizeByDept(grid, month) {
  const out = {};
  for (const row of grid.values()) {
    if (row.month !== month) continue;
    const dept = row.cat.dept || 'other';
    if (!out[dept]) out[dept] = { revenue: 0, cost: 0 };
    out[dept].revenue += row.revenue;
    out[dept].cost += row.manualCost + row.revShareCost;
  }
  return out;
}

function summarizeByCategory(grid, month) {
  const out = [];
  for (const row of grid.values()) {
    if (row.month !== month) continue;
    const cost = row.manualCost + row.revShareCost;
    const profit = row.revenue - cost;
    if (row.revenue === 0 && cost === 0) continue;
    out.push({ cat: row.cat, revenue: row.revenue, cost, profit });
  }
  return out;
}

// ---- UI parts --------------------------------------------------------------

function MonthBar({ month, onChange }) {
  return html`
    <div style=${{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
      <button class="btn btn-ghost" onClick=${() => onChange(addMonths(month, -1))}>◀</button>
      <div style=${{ fontSize: 16, fontWeight: 700, minWidth: 120, textAlign: 'center' }}>
        ${monthLabel(month)}
      </div>
      <button class="btn btn-ghost" onClick=${() => onChange(addMonths(month, 1))}>▶</button>
      <button class="btn btn-ghost" onClick=${() => onChange(thisMonth())}
              style=${{ marginLeft: 8 }}>今月</button>
    </div>
  `;
}

function KpiRow({ current, prev }) {
  const profit = current.revenue - current.cost;
  const profitRate = current.revenue > 0 ? profit / current.revenue : 0;
  const mom = prev.revenue > 0
    ? (current.revenue - prev.revenue) / prev.revenue
    : null;

  return html`
    <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
      <${KpiCard} label="当月売上"  value=${formatYen(current.revenue)}
                 accent="primary" />
      <${KpiCard} label="当月コスト" value=${formatYen(current.cost)}
                 accent=${current.cost > 0 ? 'danger' : null} />
      <${KpiCard} label="営業利益"
                 value=${formatYen(profit)}
                 accent=${profit >= 0 ? 'success' : 'danger'}
                 sub=${current.revenue > 0 ? `利益率 ${formatPct(profitRate)}` : null} />
      <${KpiCard} label="売上 前月比"
                 value=${mom === null ? '—' : (mom >= 0 ? '▲' : '▼') + ' ' + formatPct(Math.abs(mom))}
                 accent=${mom === null ? null : (mom >= 0 ? 'success' : 'danger')}
                 sub=${mom !== null ? `前月 ${formatYen(prev.revenue)}` : '前月データなし'} />
    </div>
  `;
}

function KpiCard({ label, value, sub, accent }) {
  const colors = {
    primary: 'var(--primary)',
    success: 'var(--success)',
    danger:  'var(--danger)',
  };
  return html`
    <div class="card" style=${{ padding: 18 }}>
      <div style=${{
        fontSize: 11, color: 'var(--text-3)', fontWeight: 600, marginBottom: 8,
        textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>
        ${label}
      </div>
      <div class="num" style=${{
        fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em',
        color: colors[accent] || 'var(--text)',
      }}>${value}</div>
      ${sub && html`
        <div style=${{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>${sub}</div>
      `}
    </div>
  `;
}

// ---- Dept bars -------------------------------------------------------------

function DeptBars({ grid, month, cats }) {
  const byDept = summarizeByDept(grid, month);
  const rows = SALES_DEPTS
    .map(d => ({ ...d, ...byDept[d.key] }))
    .filter(r => r.revenue > 0 || r.cost > 0);

  if (rows.length === 0) {
    return html`
      <div class="card" style=${{ padding: 18, marginBottom: 16 }}>
        <div style=${{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>部門別 損益</div>
        <div style=${{ color: 'var(--text-3)', fontSize: 13 }}>データなし</div>
      </div>
    `;
  }

  // Normalize bar width to the largest value across rows
  const maxVal = Math.max(1, ...rows.flatMap(r => [r.revenue || 0, r.cost || 0]));

  return html`
    <div class="card" style=${{ padding: 18, marginBottom: 16 }}>
      <div style=${{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>部門別 損益</div>
      ${rows.map(r => {
        const profit = (r.revenue || 0) - (r.cost || 0);
        const wRev = Math.round(((r.revenue || 0) / maxVal) * 100);
        const wCost = Math.round(((r.cost || 0) / maxVal) * 100);
        const profitColor = profit >= 0 ? 'var(--success)' : 'var(--danger)';
        return html`
          <div key=${r.key} style=${{ marginBottom: 14 }}>
            <div style=${{ display: 'flex', justifyContent: 'space-between',
                           alignItems: 'baseline', marginBottom: 5 }}>
              <span style=${{ fontSize: 12, color: r.color, fontWeight: 600 }}>${r.label}</span>
              <span class="num" style=${{ fontSize: 12, fontWeight: 700, color: profitColor }}>
                利益 ${formatYen(profit)}
              </span>
            </div>
            ${(r.revenue || 0) > 0 && html`
              <div style=${{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style=${{ fontSize: 10, color: 'var(--text-3)', width: 30 }}>売上</span>
                <div style=${{ flex: 1, height: 6, background: 'var(--border)',
                                borderRadius: 3, overflow: 'hidden' }}>
                  <div style=${{
                    width: wRev + '%', height: '100%', background: r.color,
                    transition: 'width .4s',
                  }}></div>
                </div>
                <span class="num" style=${{ fontSize: 11, fontWeight: 600, minWidth: 100, textAlign: 'right' }}>
                  ${formatYen(r.revenue)}
                </span>
              </div>
            `}
            ${(r.cost || 0) > 0 && html`
              <div style=${{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style=${{ fontSize: 10, color: 'var(--text-3)', width: 30 }}>コスト</span>
                <div style=${{ flex: 1, height: 6, background: 'var(--border)',
                                borderRadius: 3, overflow: 'hidden' }}>
                  <div style=${{
                    width: wCost + '%', height: '100%', background: 'var(--danger)',
                    transition: 'width .4s',
                  }}></div>
                </div>
                <span class="num" style=${{ fontSize: 11, fontWeight: 600, minWidth: 100,
                                             textAlign: 'right', color: 'var(--danger)' }}>
                  ${formatYen(r.cost)}
                </span>
              </div>
            `}
          </div>
        `;
      })}
    </div>
  `;
}

// ---- Category ranking ------------------------------------------------------

function CategoryRanking({ grid, month, cats }) {
  const items = summarizeByCategory(grid, month)
    .sort((a, b) => b.profit - a.profit);

  if (items.length === 0) {
    return html`
      <div class="card" style=${{ padding: 18, marginBottom: 16 }}>
        <div style=${{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>カテゴリ別 利益ランキング</div>
        <div style=${{ color: 'var(--text-3)', fontSize: 13 }}>データなし</div>
      </div>
    `;
  }

  return html`
    <div class="card" style=${{ padding: 18, marginBottom: 16 }}>
      <div style=${{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>カテゴリ別 利益ランキング</div>
      <div style=${{ display: 'grid', gridTemplateColumns: '40px 1fr 1fr 1fr 1fr', gap: 10,
                     fontSize: 11, color: 'var(--text-3)', fontWeight: 600,
                     padding: '0 4px 6px', borderBottom: '1px solid var(--border-2)' }}>
        <div>順位</div>
        <div>カテゴリ</div>
        <div style=${{ textAlign: 'right' }}>売上</div>
        <div style=${{ textAlign: 'right' }}>コスト</div>
        <div style=${{ textAlign: 'right' }}>利益</div>
      </div>
      ${items.slice(0, 10).map((r, idx) => html`
        <div key=${r.cat.id} style=${{
          display: 'grid', gridTemplateColumns: '40px 1fr 1fr 1fr 1fr', gap: 10,
          padding: '9px 4px', borderBottom: '1px solid var(--border-2)',
          alignItems: 'center', fontSize: 12.5,
        }}>
          <div style=${{ fontWeight: 700, color: 'var(--text-3)' }}>${idx + 1}</div>
          <div>
            <span style=${{ fontWeight: 600 }}>${r.cat.name}</span>
            <span style=${{ marginLeft: 6, fontSize: 10, color: deptColor(r.cat.dept), fontWeight: 600 }}>
              ${deptLabel(r.cat.dept)}
            </span>
          </div>
          <div class="num" style=${{ textAlign: 'right' }}>${formatYen(r.revenue)}</div>
          <div class="num" style=${{ textAlign: 'right', color: r.cost > 0 ? 'var(--danger)' : 'var(--text-4)' }}>
            ${r.cost > 0 ? formatYen(r.cost) : '-'}
          </div>
          <div class="num" style=${{ textAlign: 'right', fontWeight: 700,
                                      color: r.profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
            ${formatYen(r.profit)}
          </div>
        </div>
      `)}
    </div>
  `;
}

// ---- 6-month trend table ---------------------------------------------------

function TrendTable({ perMonth, months, month }) {
  return html`
    <div class="card" style=${{ padding: 18, marginBottom: 16 }}>
      <div style=${{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>
        ${TREND_MONTHS}ヶ月推移
      </div>
      <div style=${{ overflowX: 'auto' }}>
        <table style=${{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style=${thCell}>項目</th>
              ${months.map(m => html`
                <th key=${m} style=${{
                  ...thCell, textAlign: 'right',
                  color: m === month ? 'var(--primary)' : 'var(--text-3)',
                  fontWeight: m === month ? 700 : 600,
                }}>
                  ${monthLabel(m).replace(/年\d+/, s => s.slice(4))}
                </th>
              `)}
            </tr>
          </thead>
          <tbody>
            <${TrendRow} label="売上" values=${months.map(m => perMonth[m]?.revenue || 0)}
                       color="var(--primary)" />
            <${TrendRow} label="コスト" values=${months.map(m => perMonth[m]?.cost || 0)}
                       color="var(--danger)" />
            <${TrendRow} label="営業利益" bold
                       values=${months.map(m => {
                         const p = perMonth[m] || { revenue: 0, cost: 0 };
                         return p.revenue - p.cost;
                       })}
                       color="var(--success)" />
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function TrendRow({ label, values, color, bold }) {
  return html`
    <tr>
      <td style=${{ ...tdCell, color: color, fontWeight: bold ? 700 : 600 }}>${label}</td>
      ${values.map((v, i) => {
        const display = v === 0 ? '-' : formatYen(v);
        const displayColor = v === 0
          ? 'var(--text-4)'
          : (bold ? (v >= 0 ? 'var(--success)' : 'var(--danger)') : 'var(--text)');
        return html`
          <td key=${i} class="num" style=${{
            ...tdCell, textAlign: 'right',
            fontWeight: bold ? 700 : 500,
            color: displayColor,
          }}>${display}</td>
        `;
      })}
    </tr>
  `;
}

// ---- Styles ----------------------------------------------------------------

const thCell = {
  padding: '8px 12px', textAlign: 'left',
  color: 'var(--text-3)', fontWeight: 600, fontSize: 11,
  textTransform: 'uppercase', letterSpacing: '0.04em',
  borderBottom: '1px solid var(--border)',
};
const tdCell = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--border-2)',
};
