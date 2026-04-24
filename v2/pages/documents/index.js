/* ============================================================
   NOVA Core v2 — Documents page
   Folder tree + list + upload + preview.
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useMemo } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection, orderBy } from '../../store.js';
import { formatYen, formatNum, asArray } from '../../shared.js';
import {
  DOC_DEPTS, DOC_TYPES, DOC_DIRS, DOC_STATUSES,
  DEPT_MAP, TYPE_MAP, STATUS_MAP,
  resolveDept, resolveType, resolveStatus, typeDir,
} from './constants.js';
import { UploadModal } from './upload-modal.js';

const html = htm.bind(h);

// ---- Main page -------------------------------------------------------------

export function DocumentsPage({ user }) {
  const { data, loading, error } = useCollection(
    repos.documents,
    () => [orderBy('date', 'desc')],
  );

  const [filterDept, setFilterDept]   = useState('all');
  const [filterType, setFilterType]   = useState('all');
  const [filterDir,  setFilterDir]    = useState('all');
  const [search, setSearch]           = useState('');
  const [sort, setSort]               = useState('date-desc');
  const [editing, setEditing]         = useState(null);
  const [previewing, setPreviewing]   = useState(null);

  // Apply all filters + sort
  const filtered = useMemo(() => {
    let rows = asArray(data);
    if (filterDept !== 'all') rows = rows.filter(r => (r.dept || 'unknown') === filterDept);
    if (filterType !== 'all') rows = rows.filter(r => r.type === filterType);
    if (filterDir !== 'all') {
      rows = rows.filter(r => {
        const d = typeDir(r.type);
        return d === 'both' || d === filterDir;
      });
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        (r.name || '').toLowerCase().includes(q) ||
        (r.partner || '').toLowerCase().includes(q) ||
        (r.memo || '').toLowerCase().includes(q) ||
        String(r.amount || '').includes(q)
      );
    }
    // Sort (server-side already does date desc; client-side for other options)
    rows = [...rows];
    if (sort === 'date-asc')    rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    else if (sort === 'date-desc') rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    else if (sort === 'amount-desc') rows.sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));
    else if (sort === 'name-asc') rows.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
    return rows;
  }, [data, filterDept, filterType, filterDir, search, sort]);

  // Stats
  const totalAmount = useMemo(() => filtered.reduce((s, r) => s + (Number(r.amount) || 0), 0), [filtered]);
  const deptCounts = useMemo(() => countBy(asArray(data), r => r.dept || 'unknown'), [data]);
  const typeCounts = useMemo(() => countBy(asArray(data), r => r.type), [data]);
  const allCount = asArray(data).length;

  // Dept list: only show legacy/unknown depts if they have data
  const visibleDepts = DOC_DEPTS.filter(d =>
    !d.legacy && !d.synthetic
      ? true
      : (deptCounts.get(d.id) || 0) > 0 || filterDept === d.id
  );

  return html`
    <div style=${{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 18, alignItems: 'start' }}>
      <!-- Sidebar -->
      <aside class="card" style=${{ padding: 14, position: 'sticky', top: 16 }}>
        <${SidebarSection} title="事業部フォルダ">
          ${visibleDepts.map(d => html`
            <${SidebarItem} key=${d.id}
              active=${filterDept === d.id}
              icon=${d.icon}
              label=${d.label}
              count=${d.id === 'all' ? allCount : (deptCounts.get(d.id) || 0)}
              color=${d.color}
              legacy=${d.legacy}
              onClick=${() => setFilterDept(d.id)}
            />
          `)}
        </SidebarSection>

        <${SidebarSection} title="書類の種別">
          ${DOC_TYPES.filter(t => t.id === 'all' || (typeCounts.get(t.id) || 0) > 0 || filterType === t.id).map(t => html`
            <${SidebarItem} key=${t.id}
              active=${filterType === t.id}
              icon=${t.icon}
              label=${t.label}
              count=${t.id === 'all' ? allCount : (typeCounts.get(t.id) || 0)}
              onClick=${() => setFilterType(t.id)}
            />
          `)}
        </SidebarSection>

        <${SidebarSection} title="方向">
          ${DOC_DIRS.map(d => html`
            <${SidebarItem} key=${d.id}
              active=${filterDir === d.id}
              label=${d.label}
              onClick=${() => setFilterDir(d.id)}
            />
          `)}
        </SidebarSection>

        <div style=${{ borderTop: '1px solid var(--border-2)', marginTop: 12, paddingTop: 12,
                       fontSize: 11, color: 'var(--text-3)' }}>
          <div>表示中: <strong>${filtered.length}</strong> 件</div>
          <div style=${{ marginTop: 4 }}>合計金額: <strong>${formatYen(totalAmount)}</strong></div>
        </div>
      </aside>

      <!-- Main list -->
      <div style=${{ minWidth: 0 }}>
        <div style=${{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 14, gap: 10, flexWrap: 'wrap',
        }}>
          <div style=${{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, maxWidth: 520 }}>
            <input type="text" value=${search} onInput=${e => setSearch(e.target.value)}
                   placeholder="🔍 ファイル名・取引先・金額・メモで検索"
                   style=${{
                     flex: 1, padding: '9px 14px',
                     border: '1px solid var(--border)', borderRadius: 8,
                     background: 'var(--surface)', fontSize: 13,
                   }} />
          </div>
          <div style=${{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value=${sort} onChange=${e => setSort(e.target.value)}
                    style=${{
                      padding: '8px 10px', border: '1px solid var(--border)',
                      borderRadius: 8, background: 'var(--surface)', fontSize: 12,
                    }}>
              <option value="date-desc">新しい順</option>
              <option value="date-asc">古い順</option>
              <option value="amount-desc">金額 高→低</option>
              <option value="name-asc">名前順</option>
            </select>
            <button class="btn" onClick=${() => setEditing({})}>＋ 書類を登録</button>
          </div>
        </div>

        <!-- Breadcrumb -->
        <div style=${{ marginBottom: 10, fontSize: 13, color: 'var(--text-3)' }}>
          📂 <strong style=${{ color: 'var(--text)' }}>${resolveDept(filterDept).label}</strong>
          ${filterType !== 'all' && html` / ${resolveType(filterType).label}`}
        </div>

        ${error && html`<div class="note note-err">読込エラー: ${error.message}</div>`}

        ${loading ? html`<div style=${{ color: 'var(--text-3)' }}>読込中...</div>` :
          filtered.length === 0 ? html`
            <div class="card" style=${{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-3)' }}>
              <div style=${{ fontSize: 40, marginBottom: 12, opacity: .4 }}>📂</div>
              <div style=${{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>書類がありません</div>
              <div style=${{ fontSize: 12 }}>
                ${allCount === 0
                  ? '「＋書類を登録」から最初の書類を登録してください'
                  : 'フィルタを変更するか、新しい書類を登録してください'}
              </div>
            </div>
          ` : html`
            <div>
              ${filtered.map(d => html`
                <${DocRow} key=${d.id} doc=${d}
                  onEdit=${() => setEditing(d)}
                  onPreview=${() => setPreviewing(d)}
                />
              `)}
            </div>
          `}
      </div>
    </div>

    ${editing && html`
      <${UploadModal} initial=${editing} onClose=${() => setEditing(null)} />
    `}

    ${previewing && html`
      <${PreviewModal} doc=${previewing} onClose=${() => setPreviewing(null)} />
    `}
  `;
}

// ---- Sidebar components ---------------------------------------------------

function SidebarSection({ title, children }) {
  return html`
    <div style=${{ marginBottom: 16 }}>
      <div style=${{
        fontSize: 10, color: 'var(--text-3)', fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.04em',
        marginBottom: 8,
      }}>${title}</div>
      ${children}
    </div>
  `;
}

function SidebarItem({ active, icon, label, count, color, legacy, onClick }) {
  return html`
    <div onClick=${onClick}
         style=${{
           display: 'flex', alignItems: 'center', gap: 8,
           padding: '7px 10px', borderRadius: 7, cursor: 'pointer',
           fontSize: 13,
           background: active ? 'var(--primary-soft)' : 'transparent',
           color: active ? 'var(--primary)' : 'var(--text-2)',
           fontWeight: active ? 600 : 500,
           transition: 'background var(--tx-fast)',
         }}>
      ${icon && html`<span style=${{ fontSize: 14, width: 18, textAlign: 'center' }}>${icon}</span>`}
      <span style=${{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title=${label}>
        ${label}
        ${legacy && html`<span style=${{ marginLeft: 4, fontSize: 9, color: 'var(--text-4)' }}>legacy</span>`}
      </span>
      ${count !== undefined && html`<span style=${{
        fontSize: 11, color: active ? 'var(--primary)' : 'var(--text-4)', minWidth: 20, textAlign: 'right',
      }}>${count}</span>`}
    </div>
  `;
}

// ---- Document row ----------------------------------------------------------

function DocRow({ doc, onEdit, onPreview }) {
  const type = resolveType(doc.type);
  const dept = resolveDept(doc.dept);
  const status = resolveStatus(doc.status);
  const dir = typeDir(doc.type);
  const hasFile = !!doc.fileUrl;

  return html`
    <div class="card" style=${{ marginBottom: 8, padding: 0, overflow: 'hidden' }}>
      <div style=${{ display: 'flex', alignItems: 'stretch' }}>
        <div style=${{ width: 4, background: dept.color, flexShrink: 0 }}></div>
        <div style=${{
          flex: 1, padding: '14px 16px', display: 'flex',
          alignItems: 'center', gap: 12,
        }}>
          <div onClick=${hasFile ? onPreview : undefined}
               style=${{
                 display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0,
                 cursor: hasFile ? 'pointer' : 'default',
               }}>
            <div style=${{
              width: 40, height: 40, borderRadius: 10, flexShrink: 0,
              background: hasFile ? 'var(--primary-soft)' : 'var(--bg-alt)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18,
            }}>${type.icon}</div>
            <div style=${{ minWidth: 0, flex: 1 }}>
              <div style=${{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style=${{
                  fontSize: 13, fontWeight: 600,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  maxWidth: 360,
                }}>${doc.name || '(無題)'}</span>
                ${dir === 'out' && html`<span style=${badge('#dbeafe', '#1e40af')}>発行</span>`}
                ${dir === 'in' && html`<span style=${badge('#fef3c7', '#92400e')}>受領</span>`}
                ${hasFile
                  ? html`<span style=${badge('var(--success-soft)', 'var(--success)')}>📎 添付あり</span>`
                  : html`<span style=${badge('#fef2f2', '#dc2626')}>未添付</span>`}
              </div>
              <div style=${{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>
                ${doc.partner && html`<strong style=${{ color: 'var(--text-2)' }}>${doc.partner}</strong> · `}
                <span style=${{ color: dept.color }}>${dept.icon} ${dept.label}</span>
                ${' · ' + (doc.date || '-')}
                ${doc.memo && html` · ${doc.memo}`}
              </div>
            </div>
          </div>
          <div style=${{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            ${doc.amount > 0 && html`<span class="num" style=${{ fontSize: 14, fontWeight: 700 }}>
              ${formatYen(doc.amount)}
            </span>`}
            <span style=${{ ...badge(status.color + '15', status.color), fontSize: 10 }}>
              ${status.label}
            </span>
            <div style=${{ display: 'flex', gap: 4 }}>
              ${hasFile && html`
                <button class="btn btn-ghost" onClick=${onPreview} title="プレビュー">👁</button>
              `}
              <button class="btn btn-ghost" onClick=${onEdit}>編集</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ---- Preview modal ---------------------------------------------------------

function PreviewModal({ doc, onClose }) {
  if (!doc) return null;
  const ext = ((doc.originalFileName || doc.name || '').split('.').pop() || '').toLowerCase();
  const isPdf = ext === 'pdf' || /pdf/i.test(doc.fileUrl || '');
  const isImg = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);

  return html`
    <div style=${previewBackdrop} onClick=${e => e.target === e.currentTarget && onClose()}>
      <div style=${previewCard}>
        <div style=${previewHeader}>
          <div style=${{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style=${{ fontSize: 22 }}>${resolveType(doc.type).icon}</div>
            <div style=${{ minWidth: 0 }}>
              <div style=${{
                fontSize: 15, fontWeight: 700, color: '#0f0f1a',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                maxWidth: 500,
              }}>${doc.name}</div>
              <div style=${{ fontSize: 11, color: 'var(--text-3)' }}>
                ${doc.partner && `${doc.partner} · `}
                ${resolveDept(doc.dept).label} · ${doc.date}
                ${doc.amount > 0 && ` · ${formatYen(doc.amount)}`}
              </div>
            </div>
          </div>
          <div style=${{ display: 'flex', gap: 8 }}>
            ${doc.fileUrl && html`
              <a class="btn" href=${doc.fileUrl} target="_blank"
                 style=${{ textDecoration: 'none' }}>⬇ ダウンロード</a>
            `}
            <button class="btn btn-ghost" onClick=${onClose}>✕ 閉じる</button>
          </div>
        </div>

        <div style=${previewBody}>
          ${!doc.fileUrl ? html`
            <div style=${{ textAlign: 'center', color: 'var(--text-3)' }}>
              <div style=${{ fontSize: 48, marginBottom: 12 }}>📄</div>
              <div>この書類にはファイルが添付されていません</div>
            </div>
          ` : isPdf ? html`
            <iframe src=${doc.fileUrl}
                    style=${{ width: '100%', height: '100%', minHeight: 500, border: 'none', borderRadius: 8 }}></iframe>
          ` : isImg ? html`
            <img src=${doc.fileUrl}
                 style=${{ maxWidth: '100%', maxHeight: '75vh', borderRadius: 8,
                           boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
          ` : html`
            <div style=${{ textAlign: 'center', color: 'var(--text-3)' }}>
              <div style=${{ fontSize: 48, marginBottom: 12 }}>📄</div>
              <div style=${{ marginBottom: 12 }}>このファイル形式はプレビューできません</div>
              <a href=${doc.fileUrl} target="_blank" class="btn"
                 style=${{ textDecoration: 'none' }}>⬇ ダウンロードして開く</a>
            </div>
          `}
        </div>
      </div>
    </div>
  `;
}

// ---- Helpers --------------------------------------------------------------

function countBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}
function badge(bg, fg) {
  return {
    display: 'inline-block', padding: '1px 8px', borderRadius: 4,
    fontSize: 10, fontWeight: 600, background: bg, color: fg,
    whiteSpace: 'nowrap',
  };
}

// ---- Styles ---------------------------------------------------------------

const previewBackdrop = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)',
  backdropFilter: 'blur(4px)', zIndex: 99998,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const previewCard = {
  background: 'var(--surface)', borderRadius: 16,
  maxWidth: 900, width: '100%', maxHeight: '90vh',
  display: 'flex', flexDirection: 'column',
  boxShadow: 'var(--shadow-lg)',
};
const previewHeader = {
  padding: '16px 20px', borderBottom: '1px solid var(--border)',
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  flexShrink: 0,
};
const previewBody = {
  flex: 1, overflow: 'auto', padding: 20, background: 'var(--bg)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  minHeight: 400,
};
