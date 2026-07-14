/* ============================================================
   NOVA Core v2 — Sales / Entries tab
   Daily sales entry. Quick-add form on top, list below.
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useEffect, useMemo, useRef } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection, where, orderBy } from '../../store.js';
import {
  dayjs, deptLabel, deptColor,
  formatYen, formatNum, today, thisMonth, monthLabel, shortDateLabel,
  addMonths, uid, sumBy, groupBy, asArray,
} from '../../shared.js';
import { useDepts } from '../../depts.js';

const html = htm.bind(h);

// ---- Main tab --------------------------------------------------------------

export function EntriesTab() {
  const [month, setMonth] = useState(thisMonth());
  const [editing, setEditing] = useState(null); // existing entry being edited

  const monthStart = month + '-01';
  const monthEnd   = dayjs(monthStart).add(1, 'month').format('YYYY-MM-DD');

  const entries = useCollection(
    repos.salesEntries,
    () => [
      where('date', '>=', monthStart),
      where('date', '<',  monthEnd),
      orderBy('date', 'desc'),
    ],
    [month],
  );

  const cats = useCollection(repos.salesCategories);
  const depts = useDepts();
  // 新規入力の選択肢からはアーカイブ済み部門（競艇など）のカテゴリを除外
  const activeCats = useMemo(() => {
    const archived = new Set(depts.filter(d => d.archived).map(d => d.key));
    return asArray(cats.data).filter(c => !archived.has(c.dept));
  }, [cats.data, depts]);
  const catMap = useMemo(() => {
    const m = new Map();
    for (const c of asArray(cats.data)) m.set(c.id, c);
    return m;
  }, [cats.data]);

  return html`
    <div>
      <${MonthBar} month=${month} onChange=${setMonth} />

      <${KpiRow} entries=${entries.data} catMap=${catMap} />

      ${cats.data.length === 0 ? html`
        <div class="note note-warn" style=${{ marginTop: 16 }}>
          売上カテゴリが未登録です。先に
          <a onClick=${(e) => { e.preventDefault();
            /* Parent tab switching not wired here; user can click the tab manually. */
          }} style=${{ color: 'var(--primary)', cursor: 'pointer' }}>「カテゴリ」タブ</a>
          からカテゴリを作成してください。
        </div>
      ` : html`
        <${QuickAddForm} cats=${activeCats} defaultMonth=${month} />
      `}

      <${EntryList}
        loading=${entries.loading}
        error=${entries.error}
        entries=${entries.data}
        catMap=${catMap}
        onEdit=${setEditing}
      />

      ${editing && html`
        <${EntryModal}
          initial=${editing}
          cats=${cats.data}
          onClose=${() => setEditing(null)}
        />
      `}
    </div>
  `;
}

// ---- Month bar -------------------------------------------------------------

function MonthBar({ month, onChange }) {
  return html`
    <div style=${{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 16, gap: 10, flexWrap: 'wrap',
    }}>
      <div style=${{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button class="btn btn-ghost" onClick=${() => onChange(addMonths(month, -1))}>◀</button>
        <div style=${{ fontSize: 16, fontWeight: 700, minWidth: 120, textAlign: 'center' }}>
          ${monthLabel(month)}
        </div>
        <button class="btn btn-ghost" onClick=${() => onChange(addMonths(month, 1))}>▶</button>
        <button class="btn btn-ghost" onClick=${() => onChange(thisMonth())}
                style=${{ marginLeft: 8 }}>今月</button>
      </div>
    </div>
  `;
}

// ---- KPI row ---------------------------------------------------------------

function KpiRow({ entries, catMap }) {
  const depts = useDepts();
  const total = sumBy(entries, e => e.amount);
  const count = entries.length;
  const avg   = count > 0 ? Math.round(total / count) : 0;

  // By-dept breakdown using category lookup; fall back to entry.dept for legacy rows.
  const deptTotals = {};
  for (const e of entries) {
    const cat = catMap.get(e.catId);
    const dept = cat?.dept || e.dept || 'other';
    deptTotals[dept] = (deptTotals[dept] || 0) + Number(e.amount || 0);
  }

  return html`
    <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
      <${KpiCard} label="当月売上"       value=${formatYen(total)}  accent="primary" />
      <${KpiCard} label="件数"           value=${count + ' 件'}      />
      <${KpiCard} label="平均単価"       value=${formatYen(avg)}     />
    </div>
    ${Object.keys(deptTotals).length > 0 && html`
      <div class="card" style=${{ padding: 14, marginBottom: 16 }}>
        <div style=${{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, marginBottom: 8,
                       textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          部門別内訳
        </div>
        <div style=${{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          ${depts
            .filter(d => deptTotals[d.key])
            .map(d => html`
              <div key=${d.key} style=${{
                display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
              }}>
                <span style=${{
                  width: 8, height: 8, borderRadius: '50%',
                  background: d.color, flexShrink: 0,
                }}></span>
                <span style=${{ color: 'var(--text-3)' }}>${d.label}</span>
                <span class="num" style=${{ fontWeight: 700 }}>${formatYen(deptTotals[d.key])}</span>
              </div>
            `)}
        </div>
      </div>
    `}
  `;
}

function KpiCard({ label, value, accent }) {
  return html`
    <div class="card" style=${{ padding: 18 }}>
      <div style=${{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600,
                     textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
        ${label}
      </div>
      <div class="num" style=${{
        fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em',
        color: accent === 'primary' ? 'var(--primary)' : 'var(--text)',
      }}>
        ${value}
      </div>
    </div>
  `;
}

// ---- Quick-add form (inline) -----------------------------------------------

function QuickAddForm({ cats, defaultMonth }) {
  // Default date: today if within selected month, else 1st of month.
  const defaultDate = useMemo(() => {
    const t = today();
    return t.startsWith(defaultMonth) ? t : defaultMonth + '-01';
  }, [defaultMonth]);

  const [date, setDate] = useState(defaultDate);
  const [catId, setCatId] = useState(() => cats[0]?.id || '');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [flash, setFlash] = useState(null);
  const amountRef = useRef(null);

  // Keep selected category valid when categories list changes.
  useEffect(() => {
    if (cats.length && !cats.find(c => c.id === catId)) {
      setCatId(cats[0].id);
    }
  }, [cats]);

  // Update default date when month changes
  useEffect(() => {
    setDate(defaultDate);
  }, [defaultDate]);

  async function save(e) {
    if (e) e.preventDefault();
    setErr(null);
    const amtNum = Number(String(amount).replace(/[^\d.-]/g, ''));
    if (!date) { setErr('日付を選択してください'); return; }
    if (!catId) { setErr('カテゴリを選択してください'); return; }
    if (!amtNum || amtNum <= 0) {
      setErr('金額は正の数値で入力してください'); return;
    }

    setBusy(true);
    try {
      await repos.salesEntries.upsert({
        id: uid('e_'),
        date,
        catId,
        amount: Math.round(amtNum),
        memo: memo.trim(),
        source: 'manual',
      });
      setFlash(formatYen(amtNum) + ' を登録しました');
      setAmount('');
      setMemo('');
      setTimeout(() => setFlash(null), 1800);
      amountRef.current?.focus();
    } catch (e) {
      console.error('[entries] save failed', e);
      setErr('保存に失敗: ' + (e.message || e));
    } finally {
      setBusy(false);
    }
  }

  function onAmountKeyDown(e) {
    if (e.key === 'Enter') save(e);
  }

  return html`
    <form class="card" style=${{ padding: 16, marginBottom: 16 }} onSubmit=${save}>
      <div style=${{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>⚡ かんたん入力</div>
      ${err && html`<div class="note note-err">${err}</div>`}
      ${flash && html`<div class="note note-ok" style=${{ animation: 'fadein .2s' }}>✓ ${flash}</div>`}
      <div style=${{ display: 'grid', gridTemplateColumns: '150px 1fr 160px 1fr auto', gap: 10 }}>
        <input type="date" value=${date}
               onInput=${e => setDate(e.target.value)} disabled=${busy}
               style=${inputStyle} />
        <select value=${catId} onChange=${e => setCatId(e.target.value)} disabled=${busy}
                style=${inputStyle}>
          ${cats.map(c => html`
            <option key=${c.id} value=${c.id}>
              ${deptLabel(c.dept)} / ${c.name}
            </option>
          `)}
        </select>
        <input type="text" inputmode="numeric" placeholder="金額" value=${amount}
               ref=${amountRef}
               onInput=${e => setAmount(e.target.value)}
               onKeyDown=${onAmountKeyDown}
               disabled=${busy}
               style=${{ ...inputStyle, textAlign: 'right', fontFamily: 'var(--font-num)' }} />
        <input type="text" placeholder="メモ（任意）" value=${memo}
               onInput=${e => setMemo(e.target.value)} disabled=${busy}
               style=${inputStyle} />
        <button type="submit" class="btn" disabled=${busy} style=${{ whiteSpace: 'nowrap' }}>
          ${busy ? '...' : '登録'}
        </button>
      </div>
    </form>
  `;
}

// ---- Entry list ------------------------------------------------------------

function EntryList({ loading, error, entries, catMap, onEdit }) {
  if (loading) return html`<div style=${{ color: 'var(--text-3)', padding: 20 }}>読込中...</div>`;
  if (error)   return html`<div class="note note-err">読込エラー: ${error.message || String(error)}</div>`;

  if (entries.length === 0) {
    return html`
      <div class="card" style=${{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-3)' }}>
        <div style=${{ fontSize: 28, marginBottom: 10, opacity: .4 }}>📊</div>
        この月の売上データはまだありません
      </div>
    `;
  }

  // Group by date (already sorted desc by firestore)
  const byDate = groupBy(entries, e => e.date);
  const dates = Array.from(byDate.keys()).sort().reverse();

  return html`
    <div>
      ${dates.map(d => html`
        <div key=${d} style=${{ marginBottom: 16 }}>
          <div style=${{
            fontSize: 12, fontWeight: 700, color: 'var(--text-3)',
            padding: '6px 2px', letterSpacing: '0.02em',
          }}>
            ${shortDateLabel(d)}
            <span style=${{ marginLeft: 8, color: 'var(--text-4)', fontWeight: 400 }}>
              ${byDate.get(d).length}件 / ${formatYen(sumBy(byDate.get(d), e => e.amount))}
            </span>
          </div>
          <div class="card" style=${{ padding: 0, overflow: 'hidden' }}>
            ${byDate.get(d).map(e => html`
              <${EntryRow} key=${e.id} entry=${e} catMap=${catMap} onEdit=${() => onEdit(e)} />
            `)}
          </div>
        </div>
      `)}
    </div>
  `;
}

function EntryRow({ entry, catMap, onEdit }) {
  const cat = catMap.get(entry.catId);
  const deptKey = cat?.dept || entry.dept;
  const dept = deptKey ? deptLabel(deptKey) : '-';
  const color = deptColor(deptKey);
  const isLegacy = (entry.source || '').includes('legacy') || !entry.catId;

  return html`
    <div style=${{
      display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px',
      borderBottom: '1px solid var(--border-2)',
    }}>
      <span style=${{
        width: 3, alignSelf: 'stretch', background: color, borderRadius: 2,
        marginRight: 4, flexShrink: 0,
      }}></span>
      <div style=${{ flex: 1, minWidth: 0 }}>
        <div style=${{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          ${cat?.name || entry.memo || '(無題)'}
          ${isLegacy && html`<span style=${{
            marginLeft: 6, fontSize: 10, padding: '1px 6px',
            background: '#fef3c7', color: '#92400e', borderRadius: 4,
          }}>legacy</span>`}
        </div>
        <div style=${{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
          <span style=${{ color, fontWeight: 600 }}>${dept}</span>
          ${cat?.group && html`<span style=${{ marginLeft: 6 }}>· ${cat.group}</span>`}
          ${entry.memo && cat?.name && html`<span style=${{ marginLeft: 6 }}>· ${entry.memo}</span>`}
        </div>
      </div>
      <div class="num" style=${{ fontWeight: 700, minWidth: 110, textAlign: 'right' }}>
        ${formatYen(entry.amount)}
      </div>
      <button class="btn btn-ghost" onClick=${onEdit}>編集</button>
    </div>
  `;
}

// ---- Edit modal ------------------------------------------------------------

function EntryModal({ initial, cats, onClose }) {
  const [date, setDate] = useState(initial.date || today());
  const [catId, setCatId] = useState(initial.catId || cats[0]?.id || '');
  const [amount, setAmount] = useState(String(initial.amount ?? ''));
  const [memo, setMemo] = useState(initial.memo || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function save() {
    setErr(null);
    const amtNum = Number(String(amount).replace(/[^\d.-]/g, ''));
    if (!date || !catId || !amtNum || amtNum <= 0) {
      setErr('日付・カテゴリ・金額（正数）は必須です');
      return;
    }
    setBusy(true);
    try {
      await repos.salesEntries.upsert({
        id: initial.id,
        date,
        catId,
        amount: Math.round(amtNum),
        memo: memo.trim(),
        // Clear legacy markers once the user touches a record.
        source: initial.source?.includes('legacy') ? initial.source : (initial.source || 'manual'),
      });
      onClose();
    } catch (e) {
      console.error('[entries] update failed', e);
      setErr('保存に失敗: ' + (e.message || e));
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm('このレコードを削除しますか？')) return;
    setBusy(true);
    try {
      await repos.salesEntries.remove(initial.id);
      onClose();
    } catch (e) {
      console.error('[entries] delete failed', e);
      setErr('削除に失敗: ' + (e.message || e));
      setBusy(false);
    }
  }

  return html`
    <div style=${modalBackdrop} onClick=${e => e.target === e.currentTarget && onClose()}>
      <div style=${modalCard}>
        <div style=${modalHeader}>
          <div style=${{ fontWeight: 700, fontSize: 16 }}>売上レコード編集</div>
          <button class="btn btn-ghost" onClick=${onClose} disabled=${busy}>✕</button>
        </div>
        <div style=${{ padding: 20, display: 'grid', gap: 14 }}>
          ${err && html`<div class="note note-err">${err}</div>`}
          <div class="field">
            <label>日付 *</label>
            <input type="date" value=${date}
                   onInput=${e => setDate(e.target.value)} disabled=${busy} />
          </div>
          <div class="field">
            <label>カテゴリ *</label>
            <select value=${catId} onChange=${e => setCatId(e.target.value)} disabled=${busy}
                    style=${inputStyle}>
              <option value="">-- 未選択 --</option>
              ${cats.map(c => html`
                <option key=${c.id} value=${c.id}>${deptLabel(c.dept)} / ${c.name}</option>
              `)}
            </select>
          </div>
          <div class="field">
            <label>金額 *</label>
            <input type="text" inputmode="numeric" value=${amount}
                   onInput=${e => setAmount(e.target.value)} disabled=${busy}
                   style=${{ textAlign: 'right', fontFamily: 'var(--font-num)' }} />
          </div>
          <div class="field">
            <label>メモ</label>
            <input type="text" value=${memo}
                   onInput=${e => setMemo(e.target.value)} disabled=${busy} />
          </div>
        </div>
        <div style=${modalFooter}>
          <div>
            <button class="btn btn-danger" onClick=${remove} disabled=${busy}>削除</button>
          </div>
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
  width: '100%', padding: '10px 12px',
  border: '1px solid var(--border)', borderRadius: 8,
  background: '#f8f9fc', fontFamily: 'inherit', fontSize: 14,
};

const modalBackdrop = {
  position: 'fixed', inset: 0, background: 'rgba(12,12,20,0.5)',
  backdropFilter: 'blur(6px)', zIndex: 9999,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const modalCard = {
  background: 'var(--surface)', borderRadius: 18,
  maxWidth: 520, width: '100%', maxHeight: '90vh', overflow: 'auto',
  boxShadow: 'var(--shadow-lg)',
};
const modalHeader = {
  padding: 20, borderBottom: '1px solid var(--border)',
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
};
const modalFooter = {
  padding: 16, borderTop: '1px solid var(--border)',
  display: 'flex', justifyContent: 'space-between',
  position: 'sticky', bottom: 0, background: 'var(--surface)',
};
