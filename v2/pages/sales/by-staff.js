/* ============================================================
   NOVA Core v2 — Sales / By-staff tab（担当者別）
   担当者ごとの当月 売上 / コスト（実費 + レベシェア外注費）/ 粗利。
   行を展開するとカテゴリ別内訳（v1 の staffMap 集計と同じ構造）。

   集計は dashboard.js の buildGrid / rowCost をそのまま import して
   使う（単一月のグリッド）ため、売上・コスト・利益の合計は
   ダッシュボードタブの当月 KPI と常に一致する。
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useMemo } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection, where } from '../../store.js';
import {
  dayjs, deptLabel, deptColor, accountLabel,
  formatYen, formatPct, thisMonth, monthLabel, addMonths,
  sumBy, asArray,
} from '../../shared.js';
import { buildGrid, rowCost } from './dashboard.js';

const html = htm.bind(h);

const NO_STAFF_KEY = '__none';
const NO_STAFF_COLOR = '#94a3b8';

// ---- Main tab --------------------------------------------------------------

export function ByStaffTab() {
  const [month, setMonth] = useState(thisMonth());
  const [expanded, setExpanded] = useState(null); // staff group key | null

  const cats  = useCollection(repos.salesCategories);
  const staff = useCollection(repos.staffMembers);

  const monthStart = month + '-01';
  const monthEnd   = dayjs(monthStart).add(1, 'month').format('YYYY-MM-DD');

  const entries = useCollection(
    repos.salesEntries,
    () => [
      where('date', '>=', monthStart),
      where('date', '<',  monthEnd),
    ],
    [month],
  );

  const costs = useCollection(
    repos.salesCosts,
    () => [where('yearMonth', '==', month)],
    [month],
  );

  // ダッシュボードと同じ集計器で単一月グリッドを作る（定義のズレを作らない）
  const months = useMemo(() => [month], [month]);
  const grid = useMemo(
    () => buildGrid(asArray(cats.data), asArray(entries.data), asArray(costs.data), months),
    [cats.data, entries.data, costs.data, months]);

  // カテゴリ別コスト内訳バッジ用: catId → items（当月分のみ）
  const costItemsByCat = useMemo(() => {
    const m = new Map();
    for (const d of asArray(costs.data)) {
      if (d.yearMonth !== month) continue;
      m.set(d.catId, asArray(d.items));
    }
    return m;
  }, [costs.data, month]);

  const { groups, total } = useMemo(
    () => groupByStaff(grid, month, asArray(staff.data)),
    [grid, month, staff.data]);

  const loading = cats.loading || staff.loading || entries.loading || costs.loading;
  const loadError = cats.error || staff.error || entries.error || costs.error;

  return html`
    <div>
      <${MonthBar} month=${month} onChange=${setMonth} />

      ${loadError && html`
        <div class="note note-err" style=${{ marginBottom: 16 }}>
          データの読込に失敗しました: <code>${loadError.code || loadError.message || String(loadError)}</code>
        </div>
      `}

      <${TotalRow} total=${total} />

      ${loading ? html`<div style=${{ color: 'var(--text-3)', padding: 20 }}>集計中...</div>`
        : groups.length === 0 ? html`
          <div class="card" style=${{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-3)' }}>
            <div style=${{ fontSize: 28, marginBottom: 10, opacity: .4 }}>👥</div>
            この月の売上・コストデータはまだありません
          </div>
        ` : groups.map(g => html`
          <${StaffCard} key=${g.key} group=${g}
                       expanded=${expanded === g.key}
                       costItemsByCat=${costItemsByCat}
                       onToggle=${() => setExpanded(expanded === g.key ? null : g.key)} />
        `)}
    </div>
  `;
}

// ---- Aggregation -----------------------------------------------------------

/**
 * grid（buildGrid の出力）を担当者ごとに束ねる。
 * - staffId が staffMembers に無い / 空 → 「担当なし」グループ
 * - 各カテゴリ行: revenue / manualCost(+legacyExpense) / revShareCost / profit
 * - total は grid 全行の合計 = ダッシュボードの当月 KPI と同値
 */
function groupByStaff(grid, month, members) {
  const memberMap = new Map(members.map(s => [s.id, s]));
  const groups = new Map();
  const total = { revenue: 0, cost: 0 };

  function group(sid) {
    const known = sid && memberMap.has(sid);
    const key = known ? sid : NO_STAFF_KEY;
    let g = groups.get(key);
    if (!g) {
      const m = known ? memberMap.get(sid) : null;
      g = {
        key,
        name:  m ? (m.name || sid) : '担当なし',
        role:  m ? (m.role || '') : '',
        color: m ? (m.color || NO_STAFF_COLOR) : NO_STAFF_COLOR,
        isNone: !known,
        revenue: 0, manualCost: 0, revShareCost: 0, cost: 0,
        rows: [],
      };
      groups.set(key, g);
    }
    return g;
  }

  for (const row of grid.values()) {
    if (row.month !== month) continue;
    const cost = rowCost(row);
    total.revenue += row.revenue;
    total.cost += cost;
    if (row.revenue === 0 && cost === 0) continue; // 空行は表示しない（合計には影響なし）
    const g = group(row.cat.staffId);
    const manual = row.manualCost + (row.legacyExpense || 0);
    g.revenue += row.revenue;
    g.manualCost += manual;
    g.revShareCost += row.revShareCost;
    g.cost += cost;
    g.rows.push({
      cat: row.cat,
      revenue: row.revenue,
      manualCost: manual,
      legacyExpense: row.legacyExpense || 0,
      revShareCost: row.revShareCost,
      cost,
      profit: row.revenue - cost,
    });
  }

  const list = Array.from(groups.values());
  for (const g of list) g.rows.sort((a, b) => b.profit - a.profit);
  // 名前順（ja）、「担当なし」は末尾
  list.sort((a, b) => {
    if (a.isNone !== b.isNone) return a.isNone ? 1 : -1;
    return (a.name || '').localeCompare(b.name || '', 'ja');
  });
  return { groups: list, total };
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

function TotalRow({ total }) {
  const profit = total.revenue - total.cost;
  const rate = total.revenue > 0 ? profit / total.revenue : 0;
  return html`
    <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
      <${KpiCard} label="当月売上" value=${formatYen(total.revenue)} accent="primary" />
      <${KpiCard} label="当月コスト" value=${formatYen(total.cost)}
                 accent=${total.cost > 0 ? 'danger' : null}
                 sub="月次コスト実費 + レベシェア外注費" />
      <${KpiCard} label="粗利" value=${formatYen(profit)}
                 accent=${profit >= 0 ? 'success' : 'danger'} />
      <${KpiCard} label="利益率"
                 value=${total.revenue > 0 ? formatPct(rate) : '—'}
                 accent=${total.revenue > 0 ? (rate >= 0 ? 'success' : 'danger') : null}
                 sub="ダッシュボードの当月合計と同一集計" />
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

// ---- Staff card ------------------------------------------------------------

function StaffCard({ group: g, expanded, costItemsByCat, onToggle }) {
  const profit = g.revenue - g.cost;
  const rate = g.revenue > 0 ? profit / g.revenue : 0;

  return html`
    <div class="card" style=${{
      padding: 0, marginBottom: 12, overflow: 'hidden',
      borderLeft: `4px solid ${g.color}`,
    }}>
      <div style=${{
        display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
        cursor: 'pointer', flexWrap: 'wrap',
      }} onClick=${onToggle}>
        <div style=${{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 160, flex: 1 }}>
          <span style=${{
            width: 30, height: 30, borderRadius: '50%', background: g.color,
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700, flexShrink: 0,
          }}>${(g.name || '?').slice(0, 1)}</span>
          <div>
            <div style=${{ fontSize: 14, fontWeight: 700 }}>${g.name}</div>
            <div style=${{ fontSize: 11, color: 'var(--text-3)' }}>
              ${g.isNone ? 'カテゴリに担当者が未設定' : (g.role || '')}
              ${' '}· ${g.rows.length}カテゴリ
            </div>
          </div>
        </div>

        <${Metric} label="売上" value=${formatYen(g.revenue)} />
        <${Metric} label="コスト実費" value=${g.manualCost > 0 ? formatYen(g.manualCost) : '-'}
                  color=${g.manualCost > 0 ? 'var(--danger)' : 'var(--text-4)'} />
        <${Metric} label="レベシェア外注費" value=${g.revShareCost > 0 ? formatYen(g.revShareCost) : '-'}
                  color=${g.revShareCost > 0 ? 'var(--primary)' : 'var(--text-4)'} />
        <${Metric} label="粗利" value=${formatYen(profit)}
                  color=${profit >= 0 ? 'var(--success)' : 'var(--danger)'} bold />
        <${Metric} label="利益率" value=${g.revenue > 0 ? formatPct(rate) : '—'}
                  color=${g.revenue > 0 ? (rate >= 0 ? 'var(--success)' : 'var(--danger)') : 'var(--text-4)'} />

        <span style=${{
          fontSize: 12, color: 'var(--text-3)',
          transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .15s',
        }}>▼</span>
      </div>

      ${expanded && html`
        <${CategoryBreakdown} rows=${g.rows} costItemsByCat=${costItemsByCat} />
      `}
    </div>
  `;
}

function Metric({ label, value, color, bold }) {
  return html`
    <div style=${{ minWidth: 110, textAlign: 'right' }}>
      <div style=${{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600,
                     textTransform: 'uppercase', letterSpacing: '0.04em' }}>${label}</div>
      <div class="num" style=${{
        fontSize: 14, fontWeight: bold ? 700 : 600, color: color || 'var(--text)',
      }}>${value}</div>
    </div>
  `;
}

// ---- Category breakdown (expanded) ------------------------------------------

function CategoryBreakdown({ rows, costItemsByCat }) {
  return html`
    <div style=${{ borderTop: '1px solid var(--border)', background: 'var(--bg-alt)' }}>
      <div style=${{
        display: 'grid', gridTemplateColumns: 'minmax(160px, 1.4fr) 1fr 1.6fr 1fr 1fr', gap: 10,
        padding: '8px 16px', fontSize: 10.5, color: 'var(--text-3)', fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.04em',
        borderBottom: '1px solid var(--border-2)',
      }}>
        <div>カテゴリ</div>
        <div style=${{ textAlign: 'right' }}>売上</div>
        <div>コスト内訳</div>
        <div style=${{ textAlign: 'right' }}>コスト計</div>
        <div style=${{ textAlign: 'right' }}>利益</div>
      </div>
      ${rows.map(r => html`
        <${BreakdownRow} key=${r.cat.id} row=${r}
                        items=${costItemsByCat.get(r.cat.id) || []} />
      `)}
    </div>
  `;
}

function BreakdownRow({ row: r, items }) {
  return html`
    <div style=${{
      display: 'grid', gridTemplateColumns: 'minmax(160px, 1.4fr) 1fr 1.6fr 1fr 1fr', gap: 10,
      padding: '10px 16px', fontSize: 12.5, alignItems: 'center',
      borderBottom: '1px solid var(--border-2)',
    }}>
      <div style=${{ minWidth: 0 }}>
        <span style=${{ fontWeight: 600 }}>${r.cat.name}</span>
        <div style=${{ fontSize: 10.5, marginTop: 2 }}>
          <span style=${{ color: deptColor(r.cat.dept), fontWeight: 600 }}>${deptLabel(r.cat.dept)}</span>
          ${r.cat.group && html`<span style=${{ color: 'var(--text-3)', marginLeft: 6 }}>· ${r.cat.group}</span>`}
        </div>
      </div>
      <div class="num" style=${{ textAlign: 'right',
                                  color: r.revenue > 0 ? 'var(--text)' : 'var(--text-4)' }}>
        ${r.revenue > 0 ? formatYen(r.revenue) : '-'}
      </div>
      <div style=${{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        ${items.filter(i => Number(i.amount)).map((i, idx) => html`
          <span key=${idx} style=${badgeGray}>
            ${accountLabel(i.type)}: ${formatYen(i.amount)}${(i.memo || i.note) ? ` [${i.memo || i.note}]` : ''}
          </span>
        `)}
        ${r.legacyExpense > 0 && html`
          <span style=${badgeGray}>v1経費: ${formatYen(r.legacyExpense)}</span>
        `}
        ${r.revShareCost > 0 && html`
          <span style=${badgePrimary}
                title=${`カテゴリのレベシェア設定 ${r.cat.revShare?.companyPct ?? '-'}% に基づく自動計算`}>
            レベシェア: ${formatYen(r.revShareCost)}
          </span>
        `}
        ${items.length === 0 && r.legacyExpense === 0 && r.revShareCost === 0 && html`
          <span style=${{ color: 'var(--text-4)', fontSize: 11 }}>-</span>
        `}
      </div>
      <div class="num" style=${{ textAlign: 'right',
                                  color: r.cost > 0 ? 'var(--danger)' : 'var(--text-4)' }}>
        ${r.cost > 0 ? formatYen(r.cost) : '-'}
      </div>
      <div class="num" style=${{
        textAlign: 'right', fontWeight: 700,
        color: r.profit >= 0 ? 'var(--success)' : 'var(--danger)',
      }}>
        ${formatYen(r.profit)}
      </div>
    </div>
  `;
}

// ---- Styles ----------------------------------------------------------------

const badgeGray = {
  fontSize: 10.5, padding: '2px 7px', borderRadius: 6,
  background: 'var(--border)', color: 'var(--text-2)', whiteSpace: 'nowrap',
};
const badgePrimary = {
  fontSize: 10.5, padding: '2px 7px', borderRadius: 6,
  background: 'var(--primary-soft)', color: 'var(--primary)', whiteSpace: 'nowrap',
  cursor: 'help',
};
