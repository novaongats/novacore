/* ============================================================
   NOVA Core v2 — Sales / Categories tab
   Master list of sales categories (事業カテゴリ).
   Each category belongs to a dept, optional rev-share config.
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useMemo } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection } from '../../store.js';
import { deptLabel, deptColor, uid, asArray } from '../../shared.js';
import { useDepts } from '../../depts.js';

const html = htm.bind(h);

// ---- Main component --------------------------------------------------------

export function CategoriesTab() {
  const { data: cats, loading, error } = useCollection(repos.salesCategories);
  const [editing, setEditing] = useState(null); // null | {new}-object | existing doc
  const depts = useDepts();
  const staff = useCollection(repos.staffMembers);
  const staffMap = useMemo(() => {
    const m = new Map();
    for (const s of asArray(staff.data)) m.set(s.id, s);
    return m;
  }, [staff.data]);

  if (loading) return html`<div style=${{ color: 'var(--text-3)' }}>読込中...</div>`;
  if (error) return html`
    <div class="note note-err">読込エラー: ${error.message || String(error)}</div>
  `;

  // 部門グループは depts マスタの order 順。マスタに無い dept は末尾。
  const deptOrder = new Map(depts.map((d, i) => [d.key, i]));
  const orderOf = (k) => deptOrder.has(k) ? deptOrder.get(k) : 999;
  const sorted = [...cats].sort((a, b) => {
    const da = a.dept || 'other';
    const db = b.dept || 'other';
    if (orderOf(da) !== orderOf(db)) return orderOf(da) - orderOf(db);
    if (da !== db) return da.localeCompare(db); // どちらも未登録部門のとき
    return (a.name || '').localeCompare(b.name || '', 'ja');
  });

  const grouped = new Map();
  for (const c of sorted) {
    const k = c.dept || 'other';
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(c);
  }

  return html`
    <div>
      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style=${{ fontSize: 13, color: 'var(--text-3)' }}>
          全 ${cats.length} 件
        </div>
        <button class="btn" onClick=${() => setEditing({})}>＋ カテゴリ追加</button>
      </div>

      ${cats.length === 0 && html`
        <div class="card" style=${{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-3)' }}>
          <div style=${{ fontSize: 32, marginBottom: 10, opacity: .4 }}>📁</div>
          カテゴリがまだありません。
          <div style=${{ marginTop: 12 }}>
            <button class="btn" onClick=${() => setEditing({})}>＋ 最初のカテゴリを追加</button>
          </div>
        </div>
      `}

      ${Array.from(grouped.entries()).map(([deptKey, list]) => html`
        <div key=${deptKey} style=${{ marginBottom: 20 }}>
          <div style=${{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
            fontSize: 12, fontWeight: 700, color: deptColor(deptKey),
          }}>
            <span style=${{
              width: 3, height: 16, background: deptColor(deptKey), borderRadius: 2,
            }}></span>
            ${deptLabel(deptKey)} <span style=${{ color: 'var(--text-4)', fontWeight: 400 }}>(${list.length})</span>
          </div>
          <div class="card" style=${{ padding: 0, overflow: 'hidden' }}>
            ${list.map(c => html`
              <${CategoryRow} key=${c.id} cat=${c} staffMap=${staffMap} onEdit=${() => setEditing(c)} />
            `)}
          </div>
        </div>
      `)}

      ${editing !== null && html`
        <${CategoryModal}
          initial=${editing}
          staffMembers=${asArray(staff.data)}
          onClose=${() => setEditing(null)}
        />
      `}
    </div>
  `;
}

// ---- Row -------------------------------------------------------------------

function CategoryRow({ cat, staffMap, onEdit }) {
  const rs = cat.revShare;
  const rsText = rs?.enabled ? `レベシェア ${rs.companyPct}%` : '';
  const inputTypeLabel = { daily: '日次入力', monthly: '月次入力', project: '案件単位' }[cat.inputType] || cat.inputType || '-';
  // マスタに無い staffId はそのまま id を出す（不明な担当を無言で隠さない）
  const staffName = cat.staffId ? (staffMap?.get(cat.staffId)?.name || cat.staffId) : '';

  return html`
    <div style=${{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
      borderBottom: '1px solid var(--border-2)',
    }}>
      <div style=${{ flex: 1, minWidth: 0 }}>
        <div style=${{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          ${cat.name || '(無題)'}
          ${cat.group && html`<span style=${{
            marginLeft: 8, fontSize: 11, color: 'var(--text-3)', fontWeight: 400,
          }}>${cat.group}</span>`}
        </div>
        <div style=${{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
          ${inputTypeLabel}
          ${staffName && html`<span style=${{ marginLeft: 8 }}>担当: ${staffName}</span>`}
          ${rsText && html`<span style=${{ marginLeft: 8, color: 'var(--primary)' }}>${rsText}</span>`}
        </div>
      </div>
      <button class="btn btn-ghost" onClick=${onEdit}>編集</button>
    </div>
  `;
}

// ---- Edit/Create modal -----------------------------------------------------

function CategoryModal({ initial, staffMembers, onClose }) {
  const isNew = !initial.id;
  const depts = useDepts();
  const [form, setForm] = useState(() => ({
    name: initial.name || '',
    dept: initial.dept || 'sns',
    group: initial.group || '',
    staffId: initial.staffId || '',
    inputType: initial.inputType || 'monthly',
    revShareEnabled: !!initial.revShare?.enabled,
    revSharePct: initial.revShare?.companyPct ?? 100,
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // アーカイブ済み部門は選択肢から除外。ただし編集中カテゴリの現在値は残す
  const deptOptions = depts
    .filter(d => !d.archived || d.key === form.dept)
    .map(d => ({ value: d.key, label: d.label + (d.archived ? '（アーカイブ済）' : '') }));

  // 担当者選択肢: アーカイブ除外。ただし編集中カテゴリの現在値（アーカイブ済み・
  // マスタに無い id）は選択肢に残す — 開いて保存しただけで値が壊れないように。
  const members = staffMembers || [];
  const staffOptions = [{ value: '', label: '（担当なし）' }]
    .concat(members
      .filter(s => !s.archived || s.id === form.staffId)
      .map(s => ({ value: s.id, label: s.name + (s.archived ? '（アーカイブ済）' : '') })));
  if (form.staffId && !members.some(s => s.id === form.staffId)) {
    staffOptions.push({ value: form.staffId, label: `（未登録: ${form.staffId}）` });
  }

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function save() {
    setErr(null);
    if (!form.name.trim()) { setErr('名称は必須です'); return; }
    setBusy(true);
    try {
      const data = {
        id: initial.id || uid('cat_'),
        name: form.name.trim(),
        dept: form.dept,
        group: form.group.trim(),
        staffId: form.staffId.trim(),
        inputType: form.inputType,
        revShare: form.revShareEnabled
          ? { enabled: true, companyPct: Math.max(0, Math.min(100, Number(form.revSharePct) || 0)) }
          : null,
      };
      await repos.salesCategories.upsert(data);
      onClose();
    } catch (e) {
      console.error('[categories] save failed', e);
      setErr('保存に失敗: ' + (e.message || e));
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`「${initial.name}」を削除しますか？\n(このカテゴリに紐づく過去の売上データは残りますが、表示が「不明」になります)`)) return;
    setBusy(true);
    try {
      await repos.salesCategories.remove(initial.id);
      onClose();
    } catch (e) {
      console.error('[categories] delete failed', e);
      setErr('削除に失敗: ' + (e.message || e));
      setBusy(false);
    }
  }

  return html`
    <div style=${modalBackdrop} onClick=${e => e.target === e.currentTarget && onClose()}>
      <div style=${modalCard}>
        <div style=${modalHeader}>
          <div style=${{ fontWeight: 700, fontSize: 16 }}>
            ${isNew ? 'カテゴリ追加' : 'カテゴリ編集'}
          </div>
          <button class="btn btn-ghost" onClick=${onClose} disabled=${busy}>✕</button>
        </div>

        <div style=${{ padding: 20, display: 'grid', gap: 14 }}>
          ${err && html`<div class="note note-err">${err}</div>`}

          <div class="field">
            <label>カテゴリ名 *</label>
            <input type="text" value=${form.name}
                   onInput=${e => set('name', e.target.value)} disabled=${busy}
                   placeholder="例: Instagram運用代行" />
          </div>

          <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div class="field">
              <label>事業（部門） *</label>
              <${Select} value=${form.dept} onChange=${v => set('dept', v)} disabled=${busy}
                         options=${deptOptions} />
            </div>
            <div class="field">
              <label>グループ（任意）</label>
              <input type="text" value=${form.group}
                     onInput=${e => set('group', e.target.value)} disabled=${busy}
                     placeholder="例: A.アフィリエイト" />
            </div>
          </div>

          <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div class="field">
              <label>入力方式</label>
              <${Select} value=${form.inputType} onChange=${v => set('inputType', v)} disabled=${busy}
                         options=${[
                           { value: 'daily',   label: '日次（毎日入力）' },
                           { value: 'monthly', label: '月次（月末まとめ）' },
                           { value: 'project', label: '案件単位' },
                         ]} />
            </div>
            <div class="field">
              <label>担当者</label>
              <${Select} value=${form.staffId} onChange=${v => set('staffId', v)} disabled=${busy}
                         options=${staffOptions} />
            </div>
          </div>

          <div class="card" style=${{ padding: 14, background: 'var(--primary-soft)' }}>
            <label style=${{
              display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
              fontSize: 13, fontWeight: 600,
            }}>
              <input type="checkbox" checked=${form.revShareEnabled}
                     onChange=${e => set('revShareEnabled', e.target.checked)} disabled=${busy}
                     style=${{ accentColor: 'var(--primary)' }} />
              レベシェア（収益分配）を有効化
            </label>
            ${form.revShareEnabled && html`
              <div style=${{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style=${{ fontSize: 12, color: 'var(--text-3)' }}>弊社取分</label>
                <input type="number" min="0" max="100" value=${form.revSharePct}
                       onInput=${e => set('revSharePct', e.target.value)} disabled=${busy}
                       style=${{ width: 80, textAlign: 'center' }} />
                <span style=${{ fontSize: 12, color: 'var(--text-2)' }}>%</span>
                <span style=${{ fontSize: 11, color: 'var(--text-3)', marginLeft: 8 }}>
                  → 外注費 ${100 - (Number(form.revSharePct) || 0)}% 自動計上
                </span>
              </div>
            `}
          </div>
        </div>

        <div style=${modalFooter}>
          <div>
            ${!isNew && html`
              <button class="btn btn-danger" onClick=${remove} disabled=${busy}>削除</button>
            `}
          </div>
          <div style=${{ display: 'flex', gap: 8 }}>
            <button class="btn btn-ghost" onClick=${onClose} disabled=${busy}>キャンセル</button>
            <button class="btn" onClick=${save} disabled=${busy}>
              ${busy ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ---- Small local components ------------------------------------------------

function Select({ value, onChange, options, disabled }) {
  return html`
    <select value=${value} onChange=${e => onChange(e.target.value)} disabled=${disabled}
            style=${{
              width: '100%', padding: '12px 16px',
              border: '1px solid var(--border)', borderRadius: 10,
              background: '#f8f9fc', fontFamily: 'inherit', fontSize: 14,
            }}>
      ${options.map(o => html`<option key=${o.value} value=${o.value}>${o.label}</option>`)}
    </select>
  `;
}

// ---- Styles ----------------------------------------------------------------

const modalBackdrop = {
  position: 'fixed', inset: 0, background: 'rgba(12,12,20,0.5)',
  backdropFilter: 'blur(6px)', zIndex: 9999,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const modalCard = {
  background: 'var(--surface)', borderRadius: 18,
  maxWidth: 560, width: '100%', maxHeight: '90vh', overflow: 'auto',
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
