/* ============================================================
   NOVA Core v2 — Home page
   Minimal dashboard per user requirements: 売上が見れる程度.
   Shows current month KPIs + recent activity.
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useMemo } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection, where, orderBy, limit } from '../store.js';
import {
  dayjs, deptLabel, deptColor,
  formatYen, thisMonth, monthLabel, addMonths, shortDateLabel,
  sumBy, asArray,
} from '../shared.js';
import { useDepts } from '../depts.js';
import { DeptDonut } from '../charts.js';

const html = htm.bind(h);

export function HomePage({ user }) {
  const [month, setMonth] = useState(thisMonth());
  const monthStart = month + '-01';
  const monthEnd = dayjs(monthStart).add(1, 'month').format('YYYY-MM-DD');
  const prevMonth = addMonths(month, -1);
  const prevStart = prevMonth + '-01';

  // Current month data
  const salesCats  = useCollection(repos.salesCategories);
  const curEntries = useCollection(repos.salesEntries,
    () => [where('date', '>=', monthStart), where('date', '<', monthEnd)], [month]);
  const curCosts   = useCollection(repos.salesCosts,
    () => [where('yearMonth', '==', month)], [month]);
  const curCashbook = useCollection(repos.cashbook,
    () => [where('date', '>=', monthStart), where('date', '<', monthEnd)], [month]);

  // Previous month (for MoM)
  const prevEntries = useCollection(repos.salesEntries,
    () => [where('date', '>=', prevStart), where('date', '<', monthStart)], [month]);

  // Recent activity — 表示件数（8件）だけをサーバー側で絞る。
  // 月次集計は上の curEntries（当月 where 範囲）を使うため、全件購読は不要。
  const recentEntries = useCollection(repos.salesEntries,
    () => [orderBy('date', 'desc'), limit(8)], []);

  const cats = asArray(salesCats.data);
  const catMap = new Map(cats.map(c => [c.id, c]));
  const depts = useDepts();

  const stats = useMemo(() => {
    const all = asArray(curEntries.data);
    // v1移行データに type:'expense'（手入力経費）が混在するため、売上と分離する
    const entries = all.filter(e => e.type !== 'expense');
    const legacyExpense = sumBy(all.filter(e => e.type === 'expense'), e => e.amount);
    const costs   = asArray(curCosts.data);
    const expenses = asArray(curCashbook.data);
    const prev = asArray(prevEntries.data);

    const totalRevenue = sumBy(entries, e => e.amount);
    const prevRevenue  = sumBy(prev.filter(e => e.type !== 'expense'), e => e.amount);

    // 部門コスト: 月次コスト表 + レベシェア + v1移行の経費レコード
    let deptCost = 0;
    for (const c of costs) deptCost += sumBy(asArray(c.items), i => i.amount);
    for (const cat of cats) {
      if (!cat.revShare?.enabled) continue;
      const pct = Math.max(0, Math.min(100, Number(cat.revShare.companyPct) || 0));
      const rev = entries.filter(e => e.catId === cat.id)
        .reduce((s, e) => s + (Number(e.amount) || 0), 0);
      deptCost += Math.round(rev * (100 - pct) / 100);
    }
    deptCost += legacyExpense;
    // 現金出納帳（全社経費）— ホームは「全社収支」なので合算する
    const cashCost = sumBy(expenses, e => e.amount);
    const totalCost = deptCost + cashCost;

    const profit = totalRevenue - totalCost;
    const mom = prevRevenue > 0 ? (totalRevenue - prevRevenue) / prevRevenue : null;

    // By-dept（売上のみ）
    const byDept = {};
    for (const d of depts) byDept[d.key] = 0;
    for (const e of entries) {
      const cat = catMap.get(e.catId);
      const dept = cat?.dept || e.dept || 'other';
      byDept[dept] = (byDept[dept] || 0) + Number(e.amount || 0);
    }
    // 部門マスタに無い dept キー（例: honbu）の売上もドーナツに含める
    const knownDepts = new Set(depts.map(d => d.key));
    let unknownDeptRevenue = 0;
    for (const [k, v] of Object.entries(byDept)) {
      if (!knownDepts.has(k)) unknownDeptRevenue += v;
    }

    return { totalRevenue, totalCost, deptCost, cashCost, legacyExpense,
             profit, mom, byDept, unknownDeptRevenue, prevRevenue };
  }, [curEntries.data, curCosts.data, curCashbook.data, prevEntries.data, cats, depts]);

  const recentList = asArray(recentEntries.data).slice(0, 8);

  const loadError = salesCats.error || curEntries.error || curCosts.error
    || curCashbook.error || prevEntries.error || recentEntries.error;

  return html`
    <div>
      <!-- Greeting + month selector -->
      <div style=${{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 20, flexWrap: 'wrap', gap: 10,
      }}>
        <div>
          <div style=${{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em' }}>
            ${greeting()}${user?.name ? `、${user.name}さん` : ''}
          </div>
          <div style=${{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
            ${new Date().toLocaleDateString('ja-JP',
              { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
          </div>
        </div>
        <div style=${{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button class="btn btn-ghost" onClick=${() => setMonth(addMonths(month, -1))}>◀</button>
          <div style=${{ fontSize: 14, fontWeight: 700, minWidth: 110, textAlign: 'center' }}>
            ${monthLabel(month)}
          </div>
          <button class="btn btn-ghost" onClick=${() => setMonth(addMonths(month, 1))}>▶</button>
          <button class="btn btn-ghost" onClick=${() => setMonth(thisMonth())}>今月</button>
        </div>
      </div>

      ${loadError && html`
        <div class="note note-err" style=${{ marginBottom: 16 }}>
          データの読込に失敗しました: <code>${loadError.code || loadError.message || String(loadError)}</code>
        </div>
      `}

      <!-- 4 main KPIs -->
      <div style=${{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 14, marginBottom: 20,
      }}>
        <${Kpi} label="当月売上"     value=${formatYen(stats.totalRevenue)}
               sub=${stats.prevRevenue > 0 ? `前月 ${formatYen(stats.prevRevenue)}` : ''}
               accent="primary" icon="▲" />
        <${Kpi} label="当月コスト（全社）" value=${formatYen(stats.totalCost)}
               sub=${`部門コスト ${formatYen(stats.deptCost)} ＋ 現金出納帳 ${formatYen(stats.cashCost)}`}
               accent="danger"  icon="━" />
        <${Kpi} label="営業利益"     value=${formatYen(stats.profit)}
               accent=${stats.profit >= 0 ? 'success' : 'danger'} icon="◆" />
        <${Kpi} label="前月比"
               value=${stats.mom === null ? '—'
                 : (stats.mom >= 0 ? '▲' : '▼') + ' ' + (Math.abs(stats.mom * 100)).toFixed(1) + '%'}
               accent=${stats.mom === null ? null : (stats.mom >= 0 ? 'success' : 'danger')}
               icon="➚" />
      </div>

      <!-- Dept breakdown + recent entries -->
      <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <div class="card" style=${{ padding: 18 }}>
          <div style=${sectionTitle}>📊 部門別売上</div>
          ${stats.totalRevenue === 0 ? html`
            <div style=${{ color: 'var(--text-3)', fontSize: 13 }}>データなし</div>
          ` : html`
            <${DeptDonut}
              items=${depts
                .filter(d => stats.byDept[d.key] > 0)
                .map(d => ({ label: d.label, value: stats.byDept[d.key], color: d.color }))
                .concat(stats.unknownDeptRevenue > 0
                  ? [{ label: 'その他（未登録部門）', value: stats.unknownDeptRevenue, color: '#94a3b8' }]
                  : [])
                .sort((a, b) => b.value - a.value)}
            />
          `}
        </div>

        <div class="card" style=${{ padding: 18 }}>
          <div style=${sectionTitle}>📋 直近の売上</div>
          ${recentList.length === 0 ? html`
            <div style=${{ color: 'var(--text-3)', fontSize: 13 }}>データなし</div>
          ` : html`
            <div>
              ${recentList.map(e => {
                const cat = catMap.get(e.catId);
                const color = deptColor(cat?.dept);
                return html`
                  <div key=${e.id} style=${{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 0', borderBottom: '1px solid var(--border-2)',
                  }}>
                    <span style=${{
                      width: 3, alignSelf: 'stretch', background: color, borderRadius: 2,
                    }}></span>
                    <div style=${{ flex: 1, minWidth: 0 }}>
                      <div style=${{ fontSize: 12.5, fontWeight: 600,
                                     overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        ${cat?.name || e.memo || '(無題)'}
                        ${e.type === 'expense' && html`<span style=${{
                          marginLeft: 6, fontSize: 9, padding: '1px 5px',
                          background: '#fee2e2', color: '#b91c1c', borderRadius: 4,
                          fontWeight: 700, verticalAlign: 'middle',
                        }}>経費</span>`}
                      </div>
                      <div style=${{ fontSize: 10, color: 'var(--text-3)' }}>
                        ${shortDateLabel(e.date)} · ${deptLabel(cat?.dept || e.dept)}
                      </div>
                    </div>
                    <div class="num" style=${{ fontWeight: 700, fontSize: 13,
                      color: e.type === 'expense' ? 'var(--danger)' : 'var(--text)' }}>
                      ${formatYen(e.amount)}
                    </div>
                  </div>
                `;
              })}
            </div>
          `}
        </div>
      </div>

      <!-- Quick nav -->
      <div class="card" style=${{ padding: 18 }}>
        <div style=${sectionTitle}>🚀 クイックナビ</div>
        <div style=${{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <${NavTile} icon="▲" label="売上管理"   href="#/sales"    color="#6366f1" />
          <${NavTile} icon="📒" label="現金出納帳" href="#/cashbook" color="#7c3aed" />
          <${NavTile} icon="⬟" label="給与計算"   href="#/payroll"  color="#d97706" />
          <${NavTile} icon="▢" label="請求書"     href="#/invoices" color="#e11d48" />
          <${NavTile} icon="▤" label="書類管理"   href="#/docs"     color="#0891b2" />
          <${NavTile} icon="▧" label="税理士レポート" href="#/tax"   color="#059669" />
        </div>
      </div>
    </div>
  `;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'おはようございます';
  if (h < 18) return 'お疲れ様です';
  return 'こんばんは';
}

function Kpi({ label, value, sub, accent, icon }) {
  const colors = {
    primary: 'var(--primary)',
    success: 'var(--success)',
    danger:  'var(--danger)',
  };
  return html`
    <div class="card" style=${{ padding: 18, position: 'relative', overflow: 'hidden' }}>
      <div style=${{
        position: 'absolute', top: -16, right: -16,
        fontSize: 80, opacity: 0.05, fontWeight: 800,
      }}>${icon}</div>
      <div style=${{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600,
                     textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
        ${label}
      </div>
      <div class="num" style=${{
        fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em',
        color: colors[accent] || 'var(--text)',
      }}>${value}</div>
      ${sub && html`<div style=${{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>${sub}</div>`}
    </div>
  `;
}

function NavTile({ icon, label, href, color }) {
  return html`
    <a href=${href} style=${{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '12px 18px', borderRadius: 10,
      background: 'var(--bg-alt)', color: 'var(--text-2)',
      textDecoration: 'none', fontSize: 13, fontWeight: 600,
      border: '1px solid transparent', transition: 'all var(--tx-base)',
    }}
    onMouseOver=${e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.color = color; }}
    onMouseOut=${e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.color = 'var(--text-2)'; }}>
      <span style=${{ fontSize: 16, color }}>${icon}</span>
      ${label}
    </a>
  `;
}

const sectionTitle = {
  fontSize: 13, fontWeight: 700, marginBottom: 14,
  paddingBottom: 8, borderBottom: '1px solid var(--border-2)',
};
