/* ============================================================
   NOVA Core v2 — Invoices / Clients master (顧客マスタ)
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection } from '../../store.js';
import { uid } from '../../shared.js';

const html = htm.bind(h);

const EMPTY = {
  companyName: '',
  contactName: '',
  postal: '',
  address: '',
  phone: '',
  email: '',
  honorific: '御中',  // 御中/様
  defaultPaymentTerms: '',  // 支払条件メモ
  memo: '',
};

export function ClientsTab() {
  const { data, loading, error } = useCollection(repos.invoiceClients);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');

  const filtered = (data || []).filter(c => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (c.companyName || '').toLowerCase().includes(q) ||
      (c.contactName || '').toLowerCase().includes(q) ||
      (c.memo || '').toLowerCase().includes(q)
    );
  });

  return html`
    <div>
      <div style=${{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 16, gap: 10,
      }}>
        <input type="text" value=${search} onInput=${e => setSearch(e.target.value)}
               placeholder="🔍 会社名・担当者名・メモで検索"
               style=${{
                 flex: 1, maxWidth: 400, padding: '9px 14px',
                 border: '1px solid var(--border)', borderRadius: 8,
                 background: 'var(--surface)', fontSize: 13,
               }} />
        <button class="btn" onClick=${() => setEditing({})}>＋ 顧客追加</button>
      </div>

      ${error && html`<div class="note note-err">読込エラー: ${error.message}</div>`}

      ${loading ? html`<div style=${{ color: 'var(--text-3)' }}>読込中...</div>` :
        filtered.length === 0 ? html`
          <div class="card" style=${{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-3)' }}>
            <div style=${{ fontSize: 32, marginBottom: 10, opacity: .4 }}>🧑</div>
            ${search ? '該当する顧客がいません' : '顧客がまだ登録されていません'}
            ${!search && html`
              <div style=${{ marginTop: 12 }}>
                <button class="btn" onClick=${() => setEditing({})}>＋ 最初の顧客を追加</button>
              </div>
            `}
          </div>
        ` : html`
          <div class="card" style=${{ padding: 0, overflow: 'hidden' }}>
            ${filtered.map(c => html`
              <${ClientRow} key=${c.id} client=${c} onEdit=${() => setEditing(c)} />
            `)}
          </div>
          <div style=${{ marginTop: 10, fontSize: 12, color: 'var(--text-3)' }}>
            ${filtered.length} 件 / 全 ${(data || []).length} 件
          </div>
        `}

      ${editing && html`
        <${ClientModal} initial=${editing} onClose=${() => setEditing(null)} />
      `}
    </div>
  `;
}

function ClientRow({ client, onEdit }) {
  return html`
    <div style=${{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
      borderBottom: '1px solid var(--border-2)',
    }}>
      <div style=${{ flex: 1, minWidth: 0 }}>
        <div style=${{ fontSize: 13, fontWeight: 600 }}>
          ${client.companyName || '(無名)'}
          <span style=${{ marginLeft: 6, fontSize: 11, color: 'var(--text-3)', fontWeight: 400 }}>
            ${client.honorific || '御中'}
          </span>
        </div>
        <div style=${{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
          ${client.contactName && html`<span>${client.contactName}</span>`}
          ${client.phone && html`<span style=${{ marginLeft: 10 }}>📞 ${client.phone}</span>`}
          ${client.email && html`<span style=${{ marginLeft: 10 }}>✉ ${client.email}</span>`}
          ${client.address && html`<span style=${{ marginLeft: 10 }}>📍 ${client.address}</span>`}
        </div>
      </div>
      <button class="btn btn-ghost" onClick=${onEdit}>編集</button>
    </div>
  `;
}

function ClientModal({ initial, onClose }) {
  const isNew = !initial.id;
  const [form, setForm] = useState({ ...EMPTY, ...initial });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function save() {
    setErr(null);
    if (!form.companyName.trim()) { setErr('会社名は必須です'); return; }
    setBusy(true);
    try {
      await repos.invoiceClients.upsert({
        id: initial.id || uid('client_'),
        companyName: form.companyName.trim(),
        contactName: (form.contactName || '').trim(),
        postal: (form.postal || '').trim(),
        address: (form.address || '').trim(),
        phone: (form.phone || '').trim(),
        email: (form.email || '').trim(),
        honorific: form.honorific || '御中',
        defaultPaymentTerms: (form.defaultPaymentTerms || '').trim(),
        memo: (form.memo || '').trim(),
      });
      onClose();
    } catch (e) {
      console.error('[clients] save failed', e);
      setErr('保存に失敗: ' + (e.message || e));
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`「${initial.companyName}」を削除しますか？\n過去の請求書データは残ります。`)) return;
    setBusy(true);
    try {
      await repos.invoiceClients.remove(initial.id);
      onClose();
    } catch (e) {
      console.error('[clients] delete failed', e);
      setErr('削除に失敗: ' + (e.message || e));
      setBusy(false);
    }
  }

  return html`
    <div style=${modalBackdrop} onClick=${e => e.target === e.currentTarget && onClose()}>
      <div style=${modalCard}>
        <div style=${modalHeader}>
          <div style=${{ fontWeight: 700, fontSize: 16 }}>${isNew ? '顧客追加' : '顧客編集'}</div>
          <button class="btn btn-ghost" onClick=${onClose} disabled=${busy}>✕</button>
        </div>
        <div style=${{ padding: 20, display: 'grid', gap: 14 }}>
          ${err && html`<div class="note note-err">${err}</div>`}

          <div style=${{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <div class="field">
              <label>会社名 / 顧客名 *</label>
              <input type="text" value=${form.companyName}
                     onInput=${e => set('companyName', e.target.value)} disabled=${busy} />
            </div>
            <div class="field">
              <label>敬称</label>
              <select value=${form.honorific} onChange=${e => set('honorific', e.target.value)}
                      disabled=${busy} style=${selectStyle}>
                <option value="御中">御中</option>
                <option value="様">様</option>
                <option value="">（なし）</option>
              </select>
            </div>
          </div>

          <div class="field">
            <label>担当者名</label>
            <input type="text" value=${form.contactName}
                   onInput=${e => set('contactName', e.target.value)} disabled=${busy}
                   placeholder="例: 田中 太郎" />
          </div>

          <div style=${{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 10 }}>
            <div class="field">
              <label>郵便番号</label>
              <input type="text" value=${form.postal}
                     onInput=${e => set('postal', e.target.value)} disabled=${busy}
                     placeholder="443-0056" />
            </div>
            <div class="field">
              <label>住所</label>
              <input type="text" value=${form.address}
                     onInput=${e => set('address', e.target.value)} disabled=${busy} />
            </div>
          </div>

          <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div class="field">
              <label>電話番号</label>
              <input type="text" value=${form.phone}
                     onInput=${e => set('phone', e.target.value)} disabled=${busy} />
            </div>
            <div class="field">
              <label>メール</label>
              <input type="email" value=${form.email}
                     onInput=${e => set('email', e.target.value)} disabled=${busy} />
            </div>
          </div>

          <div class="field">
            <label>支払条件メモ（任意）</label>
            <input type="text" value=${form.defaultPaymentTerms}
                   onInput=${e => set('defaultPaymentTerms', e.target.value)} disabled=${busy}
                   placeholder="例: 月末締め翌月末払い" />
          </div>
          <div class="field">
            <label>メモ（社内用）</label>
            <input type="text" value=${form.memo}
                   onInput=${e => set('memo', e.target.value)} disabled=${busy} />
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
  maxWidth: 600, width: '100%', maxHeight: '90vh', overflow: 'auto',
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
