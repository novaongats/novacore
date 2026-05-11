/* ============================================================
   NOVA Core v2 — Invoices / Issuer (自社情報)
   Single document at settings/invoiceIssuer
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useEffect } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useDoc } from '../../store.js';

const html = htm.bind(h);

const DOC_ID = 'invoiceIssuer';

const EMPTY = {
  companyName: '有限会社NOVA',
  contact: '',
  postal: '',
  address: '',
  phone: '',
  email: '',
  invoiceNumber: '',  // インボイス登録番号（T+13桁）
  defaultNotes: '',
};

export function IssuerTab() {
  const { data, loading } = useDoc(repos.settings, DOC_ID);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  // Sync in when remote doc loads/changes
  useEffect(() => {
    if (data) setForm({ ...EMPTY, ...data });
  }, [data]);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function save() {
    setMsg(null);
    setBusy(true);
    try {
      await repos.settings.setId(DOC_ID, { ...form }, { merge: true });
      setMsg({ kind: 'ok', text: '保存しました' });
      setTimeout(() => setMsg(null), 2000);
    } catch (e) {
      console.error('[issuer] save failed', e);
      setMsg({ kind: 'err', text: '保存に失敗: ' + (e.message || e) });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return html`<div style=${{ color: 'var(--text-3)' }}>読込中...</div>`;

  return html`
    <div class="card" style=${{ padding: 24, maxWidth: 720 }}>
      <div style=${{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>
        🏢 自社情報
      </div>
      <div style=${{ fontSize: 12, color: 'var(--text-3)', marginBottom: 18, lineHeight: 1.7 }}>
        ここに登録した情報は、新規作成する請求書・領収書・見積書・納品書の
        「発行元」欄に自動的に入ります。作成時に個別変更も可能です。
      </div>

      ${msg && html`<div class=${'note note-' + msg.kind}>${msg.text}</div>`}

      <div style=${{ display: 'grid', gap: 14 }}>
        <div class="field">
          <label>会社名 *</label>
          <input type="text" value=${form.companyName}
                 onInput=${e => set('companyName', e.target.value)} disabled=${busy} />
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
                   onInput=${e => set('address', e.target.value)} disabled=${busy}
                   placeholder="愛知県蒲郡市..." />
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
          <label>担当者名</label>
          <input type="text" value=${form.contact}
                 onInput=${e => set('contact', e.target.value)} disabled=${busy}
                 placeholder="例: 代表取締役 佐藤" />
        </div>
        <div class="field">
          <label>
            インボイス登録番号
            <span style=${{ fontSize: 10, color: 'var(--text-3)', marginLeft: 8, fontWeight: 400 }}>
              T+13桁 (適格請求書発行事業者)
            </span>
          </label>
          <input type="text" value=${form.invoiceNumber}
                 onInput=${e => set('invoiceNumber', e.target.value)} disabled=${busy}
                 placeholder="T0000000000000"
                 style=${{ fontFamily: 'var(--font-mono)' }} />
        </div>
        <div class="field">
          <label>
            デフォルト備考文
            <span style=${{ fontSize: 10, color: 'var(--text-3)', marginLeft: 8, fontWeight: 400 }}>
              新規作成時に初期値として入ります
            </span>
          </label>
          <textarea rows="3" value=${form.defaultNotes}
                    onInput=${e => set('defaultNotes', e.target.value)} disabled=${busy}
                    style=${{
                      width: '100%', padding: '12px 16px',
                      border: '1px solid var(--border)', borderRadius: 10,
                      background: '#f8f9fc', fontFamily: 'inherit', fontSize: 14,
                      resize: 'vertical',
                    }}
                    placeholder="例: ご不明な点はお気軽にお問い合わせください。"></textarea>
        </div>
      </div>

      <div style=${{ marginTop: 20 }}>
        <button class="btn" onClick=${save} disabled=${busy}>
          ${busy ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  `;
}
