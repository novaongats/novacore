/* ============================================================
   NOVA Core v2 — 事業（部門）マスタ管理
   設定 → 会社・事業 タブに埋め込まれるセクション。
   追加・編集・並べ替え・アーカイブ（削除は不可 — 過去データ保護）。
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos } from '../store.js';
import { useDepts } from '../depts.js';

const html = htm.bind(h);

const COLOR_CHOICES = [
  '#6366f1', '#7c3aed', '#0ea5e9', '#059669', '#f59e0b',
  '#e11d48', '#ec4899', '#8b5cf6', '#14b8a6', '#64748b',
];

export function DeptsAdminSection() {
  const depts = useDepts({ includeArchived: true });
  const [editing, setEditing] = useState(null); // null | {} | dept
  const [err, setErr] = useState(null);

  async function toggleArchive(d) {
    const msg = d.archived
      ? `「${d.label}」のアーカイブを解除しますか？（入力の選択肢に復活します）`
      : `「${d.label}」をアーカイブしますか？\n新規入力の選択肢から消えますが、過去のデータ・集計はそのまま残ります。`;
    if (!confirm(msg)) return;
    try {
      await repos.salesDepts.setId(d.key, { archived: !d.archived });
    } catch (e) {
      setErr('更新に失敗: ' + (e.message || e));
    }
  }

  async function move(d, dir) {
    // order を隣と入れ替え
    const sorted = [...depts].sort((a, b) => a.order - b.order);
    const i = sorted.findIndex(x => x.key === d.key);
    const j = i + dir;
    if (j < 0 || j >= sorted.length) return;
    try {
      await repos.salesDepts.setId(sorted[i].key, { order: sorted[j].order });
      await repos.salesDepts.setId(sorted[j].key, { order: sorted[i].order });
    } catch (e) {
      setErr('並べ替えに失敗: ' + (e.message || e));
    }
  }

  return html`
    <div class="card settings-card">
      <h3 style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>🏢 事業（部門）マスタ</span>
        <button class="btn" onClick=${() => setEditing({})}>＋ 事業を追加</button>
      </h3>
      <div class="note note-info">
        ここで登録した事業が、売上入力・ダッシュボード・税理士レポートの部門として使われます。<br/>
        使わなくなった事業は「アーカイブ」してください（過去データ保護のため削除はできません）。
      </div>
      ${err && html`<div class="note note-err">${err}</div>`}

      <table style=${{ width: '100%', fontSize: 13 }}>
        <tbody>
          ${depts.map((d, i) => html`
            <tr key=${d.key} style=${{
              borderTop: '1px solid var(--border-2)',
              opacity: d.archived ? 0.5 : 1,
            }}>
              <td style=${{ padding: '9px 4px', width: 30 }}>
                <span style=${{
                  display: 'inline-block', width: 14, height: 14,
                  borderRadius: 4, background: d.color,
                }}></span>
              </td>
              <td style=${{ padding: '9px 4px', fontWeight: 600 }}>
                ${d.label}
                <span style=${{ marginLeft: 8, fontSize: 11, color: 'var(--text-4)',
                                fontFamily: 'var(--font-mono)' }}>${d.key}</span>
                ${d.archived && html`<span style=${{
                  marginLeft: 8, fontSize: 10, padding: '1px 6px', borderRadius: 999,
                  background: 'var(--bg-alt)', color: 'var(--text-3)', fontWeight: 600,
                }}>アーカイブ済</span>`}
              </td>
              <td style=${{ padding: '9px 4px', color: 'var(--text-3)', fontSize: 12 }}>${d.short}</td>
              <td style=${{ padding: '9px 4px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button class="btn btn-ghost" style=${btnSm} title="上へ"
                        onClick=${() => move(d, -1)} disabled=${i === 0}>▲</button>
                <button class="btn btn-ghost" style=${btnSm} title="下へ"
                        onClick=${() => move(d, +1)} disabled=${i === depts.length - 1}>▼</button>
                <button class="btn btn-ghost" style=${btnSm}
                        onClick=${() => setEditing(d)}>編集</button>
                <button class="btn btn-ghost" style=${{ ...btnSm, color: d.archived ? 'var(--success)' : 'var(--danger)' }}
                        onClick=${() => toggleArchive(d)}>
                  ${d.archived ? '復活' : 'アーカイブ'}
                </button>
              </td>
            </tr>
          `)}
        </tbody>
      </table>

      ${editing && html`
        <${DeptModal} initial=${editing} existing=${depts} onClose=${() => setEditing(null)} />
      `}
    </div>
  `;
}

function DeptModal({ initial, existing, onClose }) {
  const isNew = !initial.key;
  const [form, setForm] = useState(() => ({
    key: initial.key || '',
    label: initial.label || '',
    short: initial.short || '',
    color: initial.color || COLOR_CHOICES[existing.length % COLOR_CHOICES.length],
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function save() {
    setErr(null);
    const label = form.label.trim();
    if (!label) { setErr('事業名は必須です'); return; }
    let key = form.key.trim().toLowerCase();
    if (isNew) {
      if (!key) key = 'dept_' + Date.now().toString(36);
      if (!/^[a-z0-9_-]+$/.test(key)) { setErr('IDは半角英数字・ハイフン・アンダースコアのみ'); return; }
      if (existing.some(d => d.key === key)) { setErr(`ID「${key}」は既に使われています`); return; }
    }
    setBusy(true);
    try {
      const maxOrder = Math.max(0, ...existing.map(d => d.order || 0));
      await repos.salesDepts.setId(isNew ? key : initial.key, {
        label,
        short: form.short.trim() || label.slice(0, 2),
        color: form.color,
        ...(isNew ? { order: maxOrder + 1, archived: false } : {}),
      });
      onClose();
    } catch (e) {
      setErr('保存に失敗: ' + (e.message || e));
      setBusy(false);
    }
  }

  return html`
    <div style=${backdrop} onClick=${e => e.target === e.currentTarget && onClose()}>
      <div style=${card}>
        <h3 style=${{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
          ${isNew ? '事業を追加' : `「${initial.label}」を編集`}
        </h3>
        ${err && html`<div class="note note-err">${err}</div>`}

        <div class="field">
          <label>事業名 *</label>
          <input type="text" value=${form.label}
                 onInput=${e => set('label', e.target.value)} disabled=${busy}
                 placeholder="例: 物販事業" />
        </div>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div class="field">
            <label>略称（グラフ表示用）</label>
            <input type="text" value=${form.short}
                   onInput=${e => set('short', e.target.value)} disabled=${busy}
                   placeholder="例: 物販" maxlength="4" />
          </div>
          ${isNew && html`
            <div class="field">
              <label>ID（空欄で自動生成）</label>
              <input type="text" value=${form.key}
                     onInput=${e => set('key', e.target.value)} disabled=${busy}
                     placeholder="例: retail" style=${{ fontFamily: 'var(--font-mono)' }} />
            </div>
          `}
        </div>
        <div class="field">
          <label>カラー</label>
          <div style=${{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            ${COLOR_CHOICES.map(c => html`
              <button key=${c} type="button" onClick=${() => set('color', c)} disabled=${busy}
                      style=${{
                        width: 30, height: 30, borderRadius: 8, background: c,
                        border: form.color === c ? '3px solid var(--text)' : '3px solid transparent',
                        cursor: 'pointer',
                      }}></button>
            `)}
            <input type="color" value=${form.color}
                   onInput=${e => set('color', e.target.value)} disabled=${busy}
                   style=${{ width: 40, height: 30, border: 'none', background: 'transparent', cursor: 'pointer' }} />
          </div>
        </div>

        <div style=${{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button class="btn btn-ghost" onClick=${onClose} disabled=${busy}>キャンセル</button>
          <button class="btn" onClick=${save} disabled=${busy}>${busy ? '保存中...' : '保存'}</button>
        </div>
      </div>
    </div>
  `;
}

const btnSm = { padding: '4px 8px', fontSize: 12 };
const backdrop = {
  position: 'fixed', inset: 0, background: 'rgba(12,12,20,0.5)',
  backdropFilter: 'blur(4px)', zIndex: 9999,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const card = {
  background: 'var(--surface)', borderRadius: 16, padding: 28,
  maxWidth: 480, width: '100%', boxShadow: 'var(--shadow-lg)',
  maxHeight: '90vh', overflow: 'auto',
};
