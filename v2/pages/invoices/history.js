/* ============================================================
   NOVA Core v2 — Invoices / History list
   Browse & filter issued documents.
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useMemo } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection, orderBy } from '../../store.js';
import { formatYen, shortDateLabel, asArray } from '../../shared.js';
import { DOC_TYPES, DOC_TYPE_MAP, STATUSES, STATUS_MAP } from './calc.js';
import { PreviewOverlay } from './preview.js';

const html = htm.bind(h);

export function HistoryTab({ onEdit, onNew }) {
  const { data, loading, error } = useCollection(
    repos.invoices,
    () => [orderBy('issueDate', 'desc')],
  );

  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [previewDoc, setPreviewDoc] = useState(null);

  const filtered = useMemo(() => {
    let rows = asArray(data);
    if (filterType !== 'all')   rows = rows.filter(r => r.type === filterType);
    if (filterStatus !== 'all') rows = rows.filter(r => (r.status || 'draft') === filterStatus);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        (r.docNumber || '').toLowerCase().includes(q) ||
        (r.clientCompany || '').toLowerCase().includes(q) ||
        (r.clientContact || '').toLowerCase().includes(q) ||
        (r.notes || '').toLowerCase().includes(q)
      );
    }
    return rows;
  }, [data, filterType, filterStatus, search]);

  return html`
    <div>
      <div style=${{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 14, gap: 10, flexWrap: 'wrap',
      }}>
        <div style=${{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="text" value=${search} onInput=${e => setSearch(e.target.value)}
                 placeholder="🔍 書類番号・顧客名"
                 style=${{
                   width: 240, padding: '8px 12px',
                   border: '1px solid var(--border)', borderRadius: 8,
                   background: 'var(--surface)', fontSize: 13,
                 }} />
          <select value=${filterType} onChange=${e => setFilterType(e.target.value)}
                  style=${selectCompact}>
            <option value="all">すべての形式</option>
            ${DOC_TYPES.map(t => html`<option key=${t.id} value=${t.id}>${t.label}</option>`)}
          </select>
          <select value=${filterStatus} onChange=${e => setFilterStatus(e.target.value)}
                  style=${selectCompact}>
            <option value="all">すべてのステータス</option>
            ${STATUSES.map(s => html`<option key=${s.id} value=${s.id}>${s.label}</option>`)}
          </select>
        </div>
        <button class="btn" onClick=${onNew}>＋ 新規作成</button>
      </div>

      ${error && html`<div class="note note-err">読込エラー: ${error.message}</div>`}

      ${loading ? html`<div style=${{ color: 'var(--text-3)' }}>読込中...</div>` :
        filtered.length === 0 ? html`
          <div class="card" style=${{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-3)' }}>
            <div style=${{ fontSize: 32, marginBottom: 10, opacity: .4 }}>📑</div>
            ${asArray(data).length === 0
              ? '書類がまだ作成されていません'
              : 'フィルタ条件に一致する書類がありません'}
            ${asArray(data).length === 0 && html`
              <div style=${{ marginTop: 12 }}>
                <button class="btn" onClick=${onNew}>＋ 最初の書類を作成</button>
              </div>
            `}
          </div>
        ` : html`
          <div class="card" style=${{ padding: 0, overflow: 'hidden' }}>
            <div style=${tableHead}>
              <div>書類</div>
              <div>顧客</div>
              <div style=${{ textAlign: 'right' }}>金額</div>
              <div style=${{ textAlign: 'center' }}>発行日</div>
              <div style=${{ textAlign: 'center' }}>状態</div>
              <div></div>
            </div>
            ${filtered.map(d => html`
              <${Row} key=${d.id} doc=${d}
                     onEdit=${() => onEdit(d.id)}
                     onPreview=${() => setPreviewDoc(d)} />
            `)}
          </div>
          <div style=${{ marginTop: 10, fontSize: 12, color: 'var(--text-3)' }}>
            ${filtered.length} 件 / 全 ${asArray(data).length} 件
          </div>
        `}

      ${previewDoc && html`
        <${PreviewOverlay} doc=${previewDoc} onClose=${() => setPreviewDoc(null)} />
      `}
    </div>
  `;
}

function Row({ doc, onEdit, onPreview }) {
  const typeInfo = DOC_TYPE_MAP[doc.type] || DOC_TYPES[0];
  const statusInfo = STATUS_MAP[doc.status || 'draft'];
  return html`
    <div style=${tableRow} onClick=${onEdit}>
      <div>
        <div style=${{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style=${{
            fontSize: 10, padding: '2px 8px', borderRadius: 999,
            background: typeInfo.color + '15', color: typeInfo.color, fontWeight: 700,
          }}>${typeInfo.label}</span>
          <span class="mono" style=${{ fontSize: 12 }}>${doc.docNumber || '-'}</span>
        </div>
        ${doc.notes && html`<div style=${{ fontSize: 10, color: 'var(--text-4)', marginTop: 3, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${doc.notes}</div>`}
      </div>
      <div style=${{ minWidth: 0 }}>
        <div style=${{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          ${doc.clientCompany || '-'}
        </div>
        ${doc.clientContact && html`
          <div style=${{ fontSize: 11, color: 'var(--text-3)' }}>${doc.clientContact}</div>
        `}
      </div>
      <div class="num" style=${{ textAlign: 'right', fontWeight: 700 }}>
        ${formatYen(doc.totalAmount || 0)}
      </div>
      <div style=${{ textAlign: 'center', fontSize: 12, color: 'var(--text-3)' }}>
        ${shortDateLabel(doc.issueDate)}
      </div>
      <div style=${{ textAlign: 'center' }}>
        <span style=${{
          fontSize: 11, padding: '2px 10px', borderRadius: 999, fontWeight: 600,
          background: statusInfo.color + '15', color: statusInfo.color,
        }}>${statusInfo.label}</span>
      </div>
      <div style=${{ textAlign: 'right', display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        <button class="btn btn-ghost" onClick=${(e) => { e.stopPropagation(); onPreview(); }}
                title="プレビュー">👁</button>
        <button class="btn btn-ghost" onClick=${(e) => { e.stopPropagation(); onEdit(); }}>編集</button>
      </div>
    </div>
  `;
}

// ---- Styles ---------------------------------------------------------------

const selectCompact = {
  padding: '8px 10px', border: '1px solid var(--border)',
  borderRadius: 8, background: 'var(--surface)', fontSize: 12,
};
const tableHead = {
  display: 'grid',
  gridTemplateColumns: '220px 1fr 120px 90px 90px 80px',
  gap: 12, padding: '10px 16px',
  background: 'var(--bg-alt)',
  fontSize: 11, color: 'var(--text-3)', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.04em',
};
const tableRow = {
  display: 'grid',
  gridTemplateColumns: '220px 1fr 120px 90px 90px 80px',
  gap: 12, padding: '12px 16px',
  borderBottom: '1px solid var(--border-2)',
  alignItems: 'center', cursor: 'pointer',
  transition: 'background var(--tx-fast)',
};
