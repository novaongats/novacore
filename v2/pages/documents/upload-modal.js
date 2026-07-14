/* ============================================================
   NOVA Core v2 — Documents / Upload/Edit modal
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useRef } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, uploadFile, deleteFile } from '../../store.js';
import { today, uid } from '../../shared.js';
import { DOC_DEPTS, DOC_TYPES, DOC_STATUSES } from './constants.js';

const html = htm.bind(h);

const MAX_FILE_SIZE = 10 * 1024 * 1024;  // 10MB
const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const EMPTY = {
  type: 'invoice_out',
  dept: 'honbu',
  name: '',
  partner: '',
  date: today(),
  amount: '',
  status: 'active',
  memo: '',
};

export function UploadModal({ initial, onClose }) {
  const isNew = !initial?.id;
  const [form, setForm] = useState({ ...EMPTY, ...initial, amount: initial?.amount || '' });
  const [newFile, setNewFile] = useState(null);   // user selected File
  const [removedFile, setRemovedFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const fileInputRef = useRef(null);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function handleFilePick(file) {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setErr(`ファイルサイズが ${(MAX_FILE_SIZE / 1024 / 1024).toFixed(0)}MB を超えています`);
      return;
    }
    if (!ALLOWED_MIME.includes(file.type)) {
      setErr('PDF / JPG / PNG / GIF / WebP のみ対応しています');
      return;
    }
    setErr(null);
    setNewFile(file);
    setRemovedFile(false);
    // Auto-fill name if empty
    if (!form.name.trim()) set('name', file.name);
  }

  function handleRemoveFile() {
    setNewFile(null);
    setRemovedFile(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function save() {
    setErr(null);
    if (!form.name.trim()) { setErr('ファイル名/書類名は必須です'); return; }
    if (!form.date) { setErr('日付は必須です'); return; }

    setBusy(true);
    let uploadedNew = null; // 今回アップロードした新ファイル（upsert 失敗時のロールバック用）
    try {
      let fileUrl        = initial?.fileUrl || '';
      let storagePath    = initial?.storagePath || '';
      let originalName   = initial?.originalFileName || '';

      // 差し替えは「新アップロード → doc 更新成功 → 旧削除」の順。
      // （先に旧を消すと、アップロードや保存の失敗でファイルが失われるため）
      if (newFile) {
        uploadedNew = await uploadFile(newFile, 'nova_documents', form.dept, form.type);
        fileUrl        = uploadedNew.url;
        storagePath    = uploadedNew.storagePath;
        originalName   = uploadedNew.originalName;
      } else if (removedFile && initial?.storagePath) {
        // ファイル明示削除: doc 更新成功後に Storage から消す
        fileUrl = storagePath = originalName = '';
      }

      const docData = {
        id: initial?.id || uid('doc_'),
        type: form.type,
        dept: form.dept,
        name: form.name.trim(),
        partner: form.partner.trim(),
        date: form.date,
        amount: Number(String(form.amount).replace(/[^\d.-]/g, '')) || 0,
        status: form.status,
        memo: form.memo.trim(),
        fileUrl,
        storagePath,
        originalFileName: originalName,
        source: initial?.source || 'manual',
      };

      await repos.documents.upsert(docData);

      // doc 更新が成功してから旧ファイルを削除。
      // 削除失敗は warn のみ（Storage に孤児が残るのは許容）。
      const oldPath = initial?.storagePath;
      if (oldPath && oldPath !== storagePath && (newFile || removedFile)) {
        await deleteFile(oldPath).catch(e =>
          console.warn('[documents] old file delete failed (orphan left):', oldPath, e));
      }

      onClose();
    } catch (e) {
      console.error('[documents] save failed', e);
      // Storage 孤児防止: 新アップロード成功後に doc 保存が失敗したら
      // アップロード済みの新ファイルを削除してロールバック（scan.js と同じ対称処理）。
      if (uploadedNew?.storagePath) {
        try { await deleteFile(uploadedNew.storagePath); }
        catch (e2) { console.warn('[documents] rollback delete failed (orphan left):', uploadedNew.storagePath, e2); }
      }
      setErr('保存に失敗: ' + (e.message || e));
      setBusy(false);
    }
  }

  async function remove() {
    if (!initial?.id) return;
    if (!confirm(`「${initial.name}」を削除しますか？\nファイルも削除されます。`)) return;
    setBusy(true);
    try {
      if (initial.storagePath) await deleteFile(initial.storagePath).catch(() => {});
      await repos.documents.remove(initial.id);
      onClose();
    } catch (e) {
      console.error('[documents] delete failed', e);
      setErr('削除に失敗: ' + (e.message || e));
      setBusy(false);
    }
  }

  const hasCurrentFile = !removedFile && (initial?.fileUrl || newFile);
  const fileLabel = newFile
    ? newFile.name + ' (' + (newFile.size / 1024).toFixed(1) + ' KB)'
    : initial?.originalFileName || initial?.name || '';
  const fileIcon = (newFile?.type || initial?.fileUrl || '').match(/pdf/i) ? '📕' : '🖼';

  return html`
    <div style=${modalBackdrop} onClick=${e => e.target === e.currentTarget && onClose()}>
      <div style=${modalCard}>
        <div style=${modalHeader}>
          <div style=${{ fontWeight: 700, fontSize: 16 }}>
            ${isNew ? '📄 書類を登録' : '📄 書類を編集'}
          </div>
          <button class="btn btn-ghost" onClick=${onClose} disabled=${busy}>✕</button>
        </div>

        <div style=${{ padding: 20, display: 'grid', gap: 14 }}>
          ${err && html`<div class="note note-err">${err}</div>`}

          <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div class="field">
              <label>書類の種別 *</label>
              <select value=${form.type} onChange=${e => set('type', e.target.value)}
                      disabled=${busy} style=${selectStyle}>
                ${DOC_TYPES.filter(t => t.id !== 'all').map(t => html`
                  <option key=${t.id} value=${t.id}>${t.icon} ${t.label}</option>
                `)}
              </select>
            </div>
            <div class="field">
              <label>事業部 *</label>
              <select value=${form.dept} onChange=${e => set('dept', e.target.value)}
                      disabled=${busy} style=${selectStyle}>
                ${DOC_DEPTS.filter(d => d.id !== 'all' && !d.synthetic).map(d => html`
                  <option key=${d.id} value=${d.id}>${d.icon} ${d.label}</option>
                `)}
              </select>
            </div>
          </div>

          <div class="field">
            <label>ファイル名 / 書類名 *</label>
            <input type="text" value=${form.name}
                   onInput=${e => set('name', e.target.value)} disabled=${busy}
                   placeholder="例: INV-2026-001_ABCメディア.pdf" />
          </div>

          <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div class="field">
              <label>取引先 / 発行元</label>
              <input type="text" value=${form.partner}
                     onInput=${e => set('partner', e.target.value)} disabled=${busy} />
            </div>
            <div class="field">
              <label>日付 *</label>
              <input type="date" value=${form.date}
                     onInput=${e => set('date', e.target.value)} disabled=${busy} />
            </div>
          </div>

          <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div class="field">
              <label>金額</label>
              <input type="text" inputmode="numeric" value=${form.amount}
                     onInput=${e => set('amount', e.target.value)} disabled=${busy}
                     style=${{ textAlign: 'right', fontFamily: 'var(--font-num)' }} />
            </div>
            <div class="field">
              <label>ステータス</label>
              <select value=${form.status} onChange=${e => set('status', e.target.value)}
                      disabled=${busy} style=${selectStyle}>
                ${DOC_STATUSES.map(s => html`
                  <option key=${s.id} value=${s.id}>${s.label}</option>
                `)}
              </select>
            </div>
          </div>

          <div class="field">
            <label>メモ</label>
            <input type="text" value=${form.memo}
                   onInput=${e => set('memo', e.target.value)} disabled=${busy} />
          </div>

          <div class="field">
            <label>📎 ファイル（PDF / 画像）</label>
            <input ref=${fileInputRef} type="file"
                   accept=".pdf,.jpg,.jpeg,.png,.gif,.webp"
                   onChange=${e => handleFilePick(e.target.files?.[0])}
                   disabled=${busy}
                   style=${{ display: 'none' }} />
            ${hasCurrentFile ? html`
              <div style=${{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px',
                background: newFile ? '#eff6ff' : 'var(--success-soft)',
                border: '1px solid ' + (newFile ? '#bfdbfe' : 'rgba(16,185,129,0.2)'),
                borderRadius: 10,
              }}>
                <div style=${{ fontSize: 20 }}>${fileIcon}</div>
                <div style=${{ flex: 1, minWidth: 0 }}>
                  <div style=${{
                    fontSize: 13, fontWeight: 600,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>${fileLabel}</div>
                  <div style=${{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                    ${newFile ? '新規選択（保存時にアップロード）' : 'アップロード済み'}
                  </div>
                </div>
                <button class="btn btn-ghost" onClick=${handleRemoveFile} disabled=${busy}>削除</button>
              </div>
            ` : html`
              <div onClick=${() => fileInputRef.current?.click()}
                   style=${{
                     border: '2px dashed var(--border)', borderRadius: 10,
                     padding: '20px', textAlign: 'center', cursor: 'pointer',
                     background: '#fafbff', color: 'var(--text-3)',
                   }}>
                <div style=${{ fontSize: 28, marginBottom: 6 }}>📄</div>
                <div style=${{ fontSize: 13 }}>クリックしてファイルを選択</div>
                <div style=${{ fontSize: 11, color: 'var(--text-4)', marginTop: 4 }}>
                  PDF / JPG / PNG / GIF / WebP（最大 10MB）
                </div>
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
              ${busy ? '保存中...' : (isNew ? '登録' : '更新')}
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ---- Styles ----------------------------------------------------------------

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
