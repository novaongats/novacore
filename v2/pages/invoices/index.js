/* ============================================================
   NOVA Core v2 — Invoices page (tab container)
   Tabs: 履歴 / 作成・編集 / 顧客 / 振込先 / 自社情報

   編集中ガード: EditorTab がダーティフラグを dirtyRef（useRef）に
   書き込み、タブ切替時に参照して confirm する（無警告破棄の防止）。
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useRef } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { IssuerTab } from './issuer.js';
import { ClientsTab } from './clients.js';
import { BanksTab } from './banks.js';
import { EditorTab } from './editor.js';
import { HistoryTab } from './history.js';

const html = htm.bind(h);

const TABS = [
  { id: 'history', label: '📑 発行履歴' },
  { id: 'editor',  label: '✏️ 作成・編集' },
  { id: 'clients', label: '🧑 顧客マスタ' },
  { id: 'banks',   label: '🏦 振込先マスタ' },
  { id: 'issuer',  label: '🏢 自社情報' },
];

export function InvoicesPage({ user }) {
  const [tab, setTab] = useState('history');
  // When set, the editor tab opens that document. `null` = new doc.
  const [editingDocId, setEditingDocId] = useState(null);
  // EditorTab が編集中（未保存差分あり）かどうか。子から書き込まれる。
  const editorDirtyRef = useRef(false);

  function switchTab(next) {
    if (next === tab) return;
    if (tab === 'editor' && editorDirtyRef.current) {
      if (!confirm('編集中の内容が保存されていません。破棄して移動しますか？')) return;
      editorDirtyRef.current = false;
    }
    setTab(next);
  }

  function openEditor(docId = null) {
    setEditingDocId(docId);
    setTab('editor');
  }
  function closeEditor() {
    // EditorTab 側で保存/破棄の確認済み — ここではガードしない
    setEditingDocId(null);
    setTab('history');
  }

  return html`
    <div>
      <div class="tabbar">
        ${TABS.map(t => html`
          <button key=${t.id}
            class=${'tab' + (tab === t.id ? ' active' : '')}
            onClick=${() => switchTab(t.id)}>
            ${t.label}
          </button>
        `)}
      </div>
      <div style=${{ marginTop: 20 }}>
        ${tab === 'history' && html`<${HistoryTab} onEdit=${openEditor} onNew=${() => openEditor(null)} />`}
        ${tab === 'editor'  && html`<${EditorTab}  docId=${editingDocId} onDone=${closeEditor} dirtyRef=${editorDirtyRef} />`}
        ${tab === 'clients' && html`<${ClientsTab} />`}
        ${tab === 'banks'   && html`<${BanksTab} />`}
        ${tab === 'issuer'  && html`<${IssuerTab} />`}
      </div>
    </div>
  `;
}
