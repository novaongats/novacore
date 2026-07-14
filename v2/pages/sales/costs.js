/* ============================================================
   NOVA Core v2 — Sales / Monthly costs tab
   Per-category × month cost sheets.
   Doc id shape: `${yearMonth}_${catId}` → items: [{type, amount, memo}]
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useMemo } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection, where, orderBy } from '../../store.js';
import {
  dayjs, EXPENSE_ACCOUNTS,
  deptLabel, deptColor, accountLabel,
  formatYen, today, thisMonth, monthLabel, addMonths,
  sumBy, asArray,
} from '../../shared.js';
import { useDepts } from '../../depts.js';

const html = htm.bind(h);

// ---- Main tab --------------------------------------------------------------

export function CostsTab() {
  const [month, setMonth] = useState(thisMonth());
  const [editing, setEditing] = useState(null); // { cat, costDoc }

  const cats = useCollection(repos.salesCategories);

  const costs = useCollection(
    repos.salesCosts,
    () => [where('yearMonth', '==', month)],
    [month],
  );

  const monthStart = month + '-01';
  const monthEnd = dayjs(monthStart).add(1, 'month').format('YYYY-MM-DD');
  const entries = useCollection(
    repos.salesEntries,
    () => [
      where('date', '>=', monthStart),
      where('date', '<',  monthEnd),
    ],
    [month],
  );

  // Build catId → { revenue, manualCost, revShareCost, totalCost, costDoc }
  const perCat = useMemo(() => {
    const m = new Map();
    for (const c of asArray(cats.data)) {
      m.set(c.id, {
        cat: c,
        revenue: 0,
        manualCost: 0,
        revShareCost: 0,
        costDoc: null,
      });
    }
    for (const e of asArray(entries.data)) {
      const row = m.get(e.catId);
      if (row) row.revenue += Number(e.amount || 0);
    }
    for (const d of asArray(costs.data)) {
      const row = m.get(d.catId);
      if (row) {
        row.manualCost = sumBy(asArray(d.items), i => i.amount);
        row.costDoc = d;
      }
    }
    for (const row of m.values()) {
      const rs = row.cat.revShare;
      if (rs?.enabled) {
        const pct = Math.max(0, Math.min(100, Number(rs.companyPct) || 0));
        row.revShareCost = Math.round(row.revenue * (100 - pct) / 100);
      }
    }
    return m;
  }, [cats.data, entries.data, costs.data]);

  // Orphan cost docs (catId not found in current categories)
  const orphans = useMemo(() => {
    const knownIds = new Set(asArray(cats.data).map(c => c.id));
    return asArray(costs.data).filter(d => !knownIds.has(d.catId));
  }, [cats.data, costs.data]);

  const totalRevenue = useMemo(
    () => sumBy(Array.from(perCat.values()), r => r.revenue), [perCat]);
  const totalCost = useMemo(
    () => sumBy(Array.from(perCat.values()), r => r.manualCost + r.revShareCost), [perCat]);
  const orphanCost = useMemo(
    () => sumBy(orphans, d => sumBy(asArray(d.items), i => i.amount)), [orphans]);

  const loading = cats.loading || costs.loading || entries.loading;

  return html`
    <div>
      <${MonthBar} month=${month} onChange=${setMonth} />

      <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <${KpiCard} label="当月売上合計" value=${formatYen(totalRevenue)} accent="primary" />
        <${KpiCard} label="当月コスト合計" value=${formatYen(totalCost + orphanCost)} accent="danger" />
        <${KpiCard} label="粗利（売上−コスト）" value=${formatYen(totalRevenue - totalCost - orphanCost)}
                    accent=${totalRevenue - totalCost - orphanCost >= 0 ? 'success' : 'danger'} />
      </div>

      ${cats.loading ? html`<div style=${{ color: 'var(--text-3)', padding: 20 }}>読込中...</div>`
        : cats.data.length === 0 ? html`
          <div class="note note-warn">
            カテゴリが未登録です。先に「カテゴリ」タブでカテゴリを作成してください。
          </div>
        ` : html`
          <${CategoryList}
            perCat=${perCat}
            onEdit=${(cat, costDoc) => setEditing({ cat, costDoc, month })}
          />
        `}

      ${orphans.length > 0 && html`
        <${OrphanSection} orphans=${orphans} month=${month}
                         onEdit=${(orphan) => setEditing({
                           cat: { id: orphan.catId, name: '(削除済みカテゴリ)', dept: 'other' },
                           costDoc: orphan, month,
                         })} />
      `}

      ${editing && html`
        <${CostSheetModal}
          month=${editing.month}
          cat=${editing.cat}
          costDoc=${editing.costDoc}
          revenue=${perCat.get(editing.cat.id)?.revenue || 0}
          onClose=${() => setEditing(null)}
        />
      `}
    </div>
  `;
}

// ---- Month nav -------------------------------------------------------------

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

function KpiCard({ label, value, accent }) {
  const colors = {
    primary: 'var(--primary)',
    success: 'var(--success)',
    danger:  'var(--danger)',
  };
  return html`
    <div class="card" style=${{ padding: 18 }}>
      <div style=${{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600,
                     textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
        ${label}
      </div>
      <div class="num" style=${{
        fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em',
        color: colors[accent] || 'var(--text)',
      }}>
        ${value}
      </div>
    </div>
  `;
}

// ---- Category list ---------------------------------------------------------

function CategoryList({ perCat, onEdit }) {
  const depts = useDepts();
  // Group by dept
  const rows = Array.from(perCat.values());
  const grouped = new Map();
  for (const r of rows) {
    const k = r.cat.dept || 'other';
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(r);
  }
  // Sort groups by dept order
  const orderedKeys = depts.map(d => d.key).filter(k => grouped.has(k));
  for (const k of grouped.keys()) if (!orderedKeys.includes(k)) orderedKeys.push(k);

  return html`
    <div>
      ${orderedKeys.map(deptKey => html`
        <div key=${deptKey} style=${{ marginBottom: 20 }}>
          <div style=${{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
            fontSize: 12, fontWeight: 700, color: deptColor(deptKey),
          }}>
            <span style=${{
              width: 3, height: 16, background: deptColor(deptKey), borderRadius: 2,
            }}></span>
            ${deptLabel(deptKey)}
          </div>
          <div class="card" style=${{ padding: 0, overflow: 'hidden' }}>
            ${grouped.get(deptKey).map(row => html`
              <${CategoryRow} key=${row.cat.id} row=${row}
                             onEdit=${() => onEdit(row.cat, row.costDoc)} />
            `)}
          </div>
        </div>
      `)}
    </div>
  `;
}

function CategoryRow({ row, onEdit }) {
  const { cat, revenue, manualCost, revShareCost } = row;
  const totalCost = manualCost + revShareCost;
  const profit = revenue - totalCost;
  const hasCost = manualCost > 0 || revShareCost > 0;
  const hasRev = revenue > 0;

  return html`
    <div style=${{
      display: 'grid',
      gridTemplateColumns: 'minmax(150px, 1.5fr) repeat(3, 1fr) auto',
      alignItems: 'center', gap: 10, padding: '12px 16px',
      borderBottom: '1px solid var(--border-2)',
    }}>
      <div style=${{ minWidth: 0 }}>
        <div style=${{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>${cat.name}</div>
        <div style=${{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
          ${cat.group || '-'}
          ${cat.revShare?.enabled && html`<span style=${{
            marginLeft: 6, fontSize: 10, padding: '1px 6px',
            background: 'var(--primary-soft)', color: 'var(--primary)', borderRadius: 4,
          }}>レベシェア ${cat.revShare.companyPct}%</span>`}
        </div>
      </div>
      <div class="num" style=${{ textAlign: 'right', color: hasRev ? 'var(--text)' : 'var(--text-4)' }}>
        ${hasRev ? formatYen(revenue) : '-'}
      </div>
      <div class="num" style=${{ textAlign: 'right', color: hasCost ? 'var(--danger)' : 'var(--text-4)' }}>
        ${hasCost ? formatYen(totalCost) : '-'}
        ${revShareCost > 0 && html`<div style=${{ fontSize: 10, color: 'var(--text-3)', fontWeight: 400 }}>
          (手入力 ${formatYen(manualCost)} + レベ ${formatYen(revShareCost)})
        </div>`}
      </div>
      <div class="num" style=${{
        textAlign: 'right', fontWeight: 700,
        color: !hasRev && !hasCost ? 'var(--text-4)' : (profit >= 0 ? 'var(--success)' : 'var(--danger)'),
      }}>
        ${!hasRev && !hasCost ? '-' : formatYen(profit)}
      </div>
      <button class="btn btn-ghost" onClick=${onEdit}>コスト編集</button>
    </div>
  `;
}

// ---- Orphan section --------------------------------------------------------

function OrphanSection({ orphans, month, onEdit }) {
  return html`
    <div style=${{ marginTop: 24 }}>
      <div class="note note-warn">
        ⚠ 削除済みカテゴリに紐付くコストが ${orphans.length} 件あります。
        編集して新しいカテゴリへ付け替えるか、削除してください。
      </div>
      <div class="card" style=${{ padding: 0, overflow: 'hidden' }}>
        ${orphans.map(o => html`
          <div key=${o.id} style=${{
            display: 'flex', alignItems: 'center', padding: '12px 16px',
            borderBottom: '1px solid var(--border-2)', gap: 10,
          }}>
            <div style=${{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              catId: ${o.catId}
              <div style=${{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                ${asArray(o.items).length}項目 / ${formatYen(sumBy(asArray(o.items), i => i.amount))}
              </div>
            </div>
            <button class="btn btn-ghost" onClick=${() => onEdit(o)}>編集</button>
          </div>
        `)}
      </div>
    </div>
  `;
}

// ---- Cost-sheet edit modal -------------------------------------------------

function CostSheetModal({ month, cat, costDoc, revenue, onClose }) {
  const [items, setItems] = useState(() =>
    asArray(costDoc?.items).map(i => ({
      key: Math.random().toString(36).slice(2),
      type: i.type || 'misc',
      amount: String(i.amount ?? ''),
      memo: i.memo || '',
    }))
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  function update(idx, patch) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  }
  function addRow() {
    setItems(prev => [
      ...prev,
      { key: Math.random().toString(36).slice(2), type: 'outsource', amount: '', memo: '' },
    ]);
  }
  function removeRow(idx) {
    setItems(prev => prev.filter((_, i) => i !== idx));
  }

  const total = sumBy(items, i => Number(String(i.amount).replace(/[^\d.-]/g, '')) || 0);
  const revShareCost = cat.revShare?.enabled
    ? Math.round(revenue * (100 - (Number(cat.revShare.companyPct) || 0)) / 100)
    : 0;

  async function save() {
    setErr(null);
    // Validate rows
    const cleaned = [];
    for (const it of items) {
      const amt = Number(String(it.amount).replace(/[^\d.-]/g, '')) || 0;
      if (amt === 0) continue; // skip zero-amount rows silently
      cleaned.push({
        type: it.type || 'misc',
        amount: Math.round(amt),
        memo: (it.memo || '').trim(),
      });
    }
    setBusy(true);
    try {
      const id = `${month}_${cat.id}`;
      if (cleaned.length === 0 && costDoc) {
        // Everything removed → delete the doc
        await repos.salesCosts.remove(id);
      } else if (cleaned.length > 0) {
        await repos.salesCosts.setId(id, {
          yearMonth: month,
          catId: cat.id,
          items: cleaned,
        }, { merge: false });
      }
      onClose();
    } catch (e) {
      console.error('[costs] save failed', e);
      setErr('保存に失敗: ' + (e.message || e));
      setBusy(false);
    }
  }

  return html`
    <div style=${modalBackdrop} onClick=${e => e.target === e.currentTarget && onClose()}>
      <div style=${{ ...modalCard, maxWidth: 760 }}>
        <div style=${modalHeader}>
          <div>
            <div style=${{ fontWeight: 700, fontSize: 16 }}>月次コスト編集</div>
            <div style=${{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
              ${monthLabel(month)} · ${deptLabel(cat.dept)} / ${cat.name}
            </div>
          </div>
          <button class="btn btn-ghost" onClick=${onClose} disabled=${busy}>✕</button>
        </div>

        <div style=${{ padding: 20, display: 'grid', gap: 14 }}>
          ${err && html`<div class="note note-err">${err}</div>`}

          ${cat.revShare?.enabled && html`
            <div style=${{
              padding: 12, background: 'var(--primary-soft)', borderRadius: 10,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              fontSize: 13,
            }}>
              <div>
                <strong>レベシェア自動計算</strong>
                <div style=${{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                  売上 ${formatYen(revenue)} × ${100 - cat.revShare.companyPct}% 外注費
                </div>
              </div>
              <div class="num" style=${{ fontWeight: 700, color: 'var(--primary)' }}>
                ${formatYen(revShareCost)}
              </div>
            </div>
          `}

          ${items.length === 0 ? html`
            <div style=${{
              padding: 24, textAlign: 'center', color: 'var(--text-3)',
              border: '1px dashed var(--border)', borderRadius: 10,
            }}>
              コスト項目がまだありません
            </div>
          ` : html`
            <div style=${{
              display: 'grid', gridTemplateColumns: '180px 130px 1fr 40px', gap: 8,
              fontSize: 11, color: 'var(--text-3)', fontWeight: 600, padding: '0 4px',
            }}>
              <div>勘定科目</div>
              <div style=${{ textAlign: 'right' }}>金額</div>
              <div>メモ</div>
              <div></div>
            </div>
            ${items.map((it, idx) => html`
              <div key=${it.key} style=${{
                display: 'grid', gridTemplateColumns: '180px 130px 1fr 40px', gap: 8,
                alignItems: 'center',
              }}>
                <select value=${it.type} onChange=${e => update(idx, { type: e.target.value })}
                        disabled=${busy} style=${inputStyle}>
                  ${EXPENSE_ACCOUNTS.map(a => html`
                    <option key=${a.key} value=${a.key}>${a.label}</option>
                  `)}
                </select>
                <input type="text" inputmode="numeric" value=${it.amount}
                       onInput=${e => update(idx, { amount: e.target.value })}
                       disabled=${busy}
                       style=${{ ...inputStyle, textAlign: 'right', fontFamily: 'var(--font-num)' }} />
                <input type="text" value=${it.memo}
                       onInput=${e => update(idx, { memo: e.target.value })}
                       disabled=${busy} placeholder="メモ（任意）"
                       style=${inputStyle} />
                <button class="btn btn-ghost" onClick=${() => removeRow(idx)} disabled=${busy}
                        style=${{ padding: '6px 10px' }} title="行を削除">×</button>
              </div>
            `)}
          `}

          <div>
            <button class="btn btn-ghost" onClick=${addRow} disabled=${busy}>＋ 行を追加</button>
          </div>

          <div style=${{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            padding: '10px 14px', background: 'var(--bg-alt)', borderRadius: 10,
            fontSize: 13,
          }}>
            <div>
              <span style=${{ color: 'var(--text-3)' }}>手入力合計</span>
              <span class="num" style=${{ marginLeft: 8, fontWeight: 700 }}>${formatYen(total)}</span>
              ${revShareCost > 0 && html`
                <span style=${{ color: 'var(--text-3)', marginLeft: 14 }}>+ レベシェア</span>
                <span class="num" style=${{ marginLeft: 8, fontWeight: 700, color: 'var(--primary)' }}>${formatYen(revShareCost)}</span>
              `}
            </div>
            <div>
              <span style=${{ color: 'var(--text-3)' }}>合計</span>
              <span class="num" style=${{ marginLeft: 8, fontWeight: 800, fontSize: 18, color: 'var(--danger)' }}>
                ${formatYen(total + revShareCost)}
              </span>
            </div>
          </div>
        </div>

        <div style=${modalFooter}>
          <div></div>
          <div style=${{ display: 'flex', gap: 8 }}>
            <button class="btn btn-ghost" onClick=${onClose} disabled=${busy}>キャンセル</button>
            <button class="btn" onClick=${save} disabled=${busy}>${busy ? '保存中...' : '保存'}</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ---- Styles ----------------------------------------------------------------

const inputStyle = {
  padding: '9px 12px',
  border: '1px solid var(--border)', borderRadius: 8,
  background: '#f8f9fc', fontFamily: 'inherit', fontSize: 13,
  width: '100%',
};

const modalBackdrop = {
  position: 'fixed', inset: 0, background: 'rgba(12,12,20,0.5)',
  backdropFilter: 'blur(6px)', zIndex: 9999,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const modalCard = {
  background: 'var(--surface)', borderRadius: 18,
  width: '100%', maxHeight: '90vh', overflow: 'auto',
  boxShadow: 'var(--shadow-lg)',
};
const modalHeader = {
  padding: 20, borderBottom: '1px solid var(--border)',
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
};
const modalFooter = {
  padding: 16, borderTop: '1px solid var(--border)',
  display: 'flex', justifyContent: 'space-between',
  position: 'sticky', bottom: 0, background: 'var(--surface)',
};
