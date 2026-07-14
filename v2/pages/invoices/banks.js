/* ============================================================
   NOVA Core v2 — Invoices / Bank master (振込先マスタ)
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection } from '../../store.js';
import { uid } from '../../shared.js';

const html = htm.bind(h);

const EMPTY = {
  bankName: '',
  branch: '',
  branchCode: '',
  accountType: '普通',
  accountNumber: '',
  accountHolder: '',
  accountHolderKana: '',
  isDefault: false,
};

export function BanksTab() {
  const { data, loading, error } = useCollection(repos.invoiceBanks);
  const [editing, setEditing] = useState(null);

  return html`
    <div>
      <div style=${{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 16,
      }}>
        <div style=${{ fontSize: 13, color: 'var(--text-3)' }}>
          全 ${(data || []).length} 件
        </div>
        <button class="btn" onClick=${() => setEditing({})}>＋ 口座追加</button>
      </div>

      ${error && html`<div class="note note-err">読込エラー: ${error.message}</div>`}

      ${loading ? html`<div style=${{ color: 'var(--text-3)' }}>読込中...</div>` :
        (data || []).length === 0 ? html`
          <div class="card" style=${{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-3)' }}>
            <div style=${{ fontSize: 32, marginBottom: 10, opacity: .4 }}>🏦</div>
            振込先口座がまだ登録されていません
            <div style=${{ marginTop: 12 }}>
              <button class="btn" onClick=${() => setEditing({})}>＋ 最初の口座を追加</button>
            </div>
          </div>
        ` : html`
          <div class="card" style=${{ padding: 0, overflow: 'hidden' }}>
            ${data.map(b => html`
              <${BankRow} key=${b.id} bank=${b} onEdit=${() => setEditing(b)} />
            `)}
          </div>
        `}

      ${editing && html`
        <${BankModal} initial=${editing} banks=${data || []} onClose=${() => setEditing(null)} />
      `}
    </div>
  `;
}

function BankRow({ bank, onEdit }) {
  return html`
    <div style=${{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
      borderBottom: '1px solid var(--border-2)',
    }}>
      <div style=${{ flex: 1, minWidth: 0 }}>
        <div style=${{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          ${bank.bankName || '(銀行名なし)'} / ${bank.branch || ''}
          ${bank.isDefault && html`<span style=${{
            fontSize: 10, padding: '1px 8px', borderRadius: 999,
            background: 'var(--primary-soft)', color: 'var(--primary)', fontWeight: 600,
          }}>デフォルト</span>`}
        </div>
        <div style=${{ fontSize: 11, color: 'var(--text-3)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
          ${bank.accountType} ${bank.accountNumber}
          ${bank.accountHolder && html`<span style=${{ fontFamily: 'inherit', marginLeft: 10 }}>
            ${bank.accountHolder}
            ${bank.accountHolderKana && html`<span style=${{ color: 'var(--text-4)' }}>
              (${bank.accountHolderKana})
            </span>`}
          </span>`}
        </div>
      </div>
      <button class="btn btn-ghost" onClick=${onEdit}>編集</button>
    </div>
  `;
}

function BankModal({ initial, banks, onClose }) {
  const isNew = !initial.id;
  const [form, setForm] = useState({ ...EMPTY, ...initial });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function save() {
    setErr(null);
    if (!form.bankName.trim()) { setErr('銀行名は必須です'); return; }
    if (!form.accountNumber.trim()) { setErr('口座番号は必須です'); return; }
    setBusy(true);
    try {
      const id = initial.id || uid('bank_');
      await repos.invoiceBanks.upsert({
        id,
        bankName: form.bankName.trim(),
        branch: (form.branch || '').trim(),
        branchCode: (form.branchCode || '').trim(),
        accountType: form.accountType || '普通',
        accountNumber: form.accountNumber.trim(),
        accountHolder: (form.accountHolder || '').trim(),
        accountHolderKana: (form.accountHolderKana || '').trim(),
        isDefault: !!form.isDefault,
      });
      // デフォルトの排他: この口座をデフォルトにしたら他口座の isDefault を落とす
      if (form.isDefault) {
        const others = (banks || []).filter(b => b.isDefault && b.id !== id);
        await Promise.all(others.map(b =>
          repos.invoiceBanks.upsert({ id: b.id, isDefault: false })
        ));
      }
      onClose();
    } catch (e) {
      console.error('[banks] save failed', e);
      setErr('保存に失敗: ' + (e.message || e));
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`「${initial.bankName} ${initial.branch}」を削除しますか？`)) return;
    setBusy(true);
    try {
      await repos.invoiceBanks.remove(initial.id);
      onClose();
    } catch (e) {
      console.error('[banks] delete failed', e);
      setErr('削除に失敗: ' + (e.message || e));
      setBusy(false);
    }
  }

  return html`
    <div style=${modalBackdrop} onClick=${e => e.target === e.currentTarget && onClose()}>
      <div style=${modalCard}>
        <div style=${modalHeader}>
          <div style=${{ fontWeight: 700, fontSize: 16 }}>${isNew ? '口座追加' : '口座編集'}</div>
          <button class="btn btn-ghost" onClick=${onClose} disabled=${busy}>✕</button>
        </div>
        <div style=${{ padding: 20, display: 'grid', gap: 14 }}>
          ${err && html`<div class="note note-err">${err}</div>`}

          <div style=${{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <div class="field">
              <label>銀行名 *</label>
              <input type="text" value=${form.bankName}
                     onInput=${e => set('bankName', e.target.value)} disabled=${busy}
                     placeholder="例: みずほ銀行" />
            </div>
            <div class="field">
              <label>支店コード</label>
              <input type="text" value=${form.branchCode}
                     onInput=${e => set('branchCode', e.target.value)} disabled=${busy}
                     placeholder="例: 123"
                     style=${{ fontFamily: 'var(--font-mono)' }} />
            </div>
          </div>

          <div class="field">
            <label>支店名</label>
            <input type="text" value=${form.branch}
                   onInput=${e => set('branch', e.target.value)} disabled=${busy}
                   placeholder="例: 蒲郡支店" />
          </div>

          <div style=${{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10 }}>
            <div class="field">
              <label>口座種別</label>
              <select value=${form.accountType} onChange=${e => set('accountType', e.target.value)}
                      disabled=${busy} style=${selectStyle}>
                <option value="普通">普通</option>
                <option value="当座">当座</option>
              </select>
            </div>
            <div class="field">
              <label>口座番号 *</label>
              <input type="text" value=${form.accountNumber}
                     onInput=${e => set('accountNumber', e.target.value)} disabled=${busy}
                     placeholder="1234567"
                     style=${{ fontFamily: 'var(--font-mono)' }} />
            </div>
          </div>

          <div class="field">
            <label>口座名義</label>
            <input type="text" value=${form.accountHolder}
                   onInput=${e => set('accountHolder', e.target.value)} disabled=${busy}
                   placeholder="例: 有限会社NOVA" />
          </div>
          <div class="field">
            <label>口座名義（カナ）</label>
            <input type="text" value=${form.accountHolderKana}
                   onInput=${e => set('accountHolderKana', e.target.value)} disabled=${busy}
                   placeholder="例: ユ)ノヴァ" />
          </div>

          <label style=${{
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            padding: '8px 12px', background: 'var(--primary-soft)', borderRadius: 8,
            fontSize: 13, fontWeight: 500,
          }}>
            <input type="checkbox" checked=${form.isDefault}
                   onChange=${e => set('isDefault', e.target.checked)} disabled=${busy}
                   style=${{ accentColor: 'var(--primary)' }} />
            新規請求書のデフォルト振込先として使用
          </label>
        </div>
        <div style=${modalFooter}>
          <div>
            ${!isNew && html`
              <button class="btn btn-danger" onClick=${remove} disabled=${busy}>削除</button>
            `}
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

const selectStyle = {
  width: '100%', padding: '12px 16px',
  border: '1px solid var(--border)', borderRadius: 10,
  background: '#f8f9fc', fontFamily: 'inherit', fontSize: 14,
};
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
