/* ============================================================
   NOVA Core v2 — Invoices page (tab container)
   Tabs: 履歴 / 作成・編集 / 顧客 / 振込先 / 自社情報
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState } from 'https://esm.sh/preact@10.22.0/hooks';
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

  function openEditor(docId = null) {
    setEditingDocId(docId);
    setTab('editor');
  }
  function closeEditor() {
    setEditingDocId(null);
    setTab('history');
  }

  return html`
    <div>
      <div class="tabbar">
        ${TABS.map(t => html`
          <button key=${t.id}
            class=${'tab' + (tab === t.id ? ' active' : '')}
            onClick=${() => setTab(t.id)}>
            ${t.label}
          </button>
        `)}
      </div>
      <div style=${{ marginTop: 20 }}>
        ${tab === 'history' && html`<${HistoryTab} onEdit=${openEditor} onNew=${() => openEditor(null)} />`}
        ${tab === 'editor'  && html`<${EditorTab}  docId=${editingDocId} onDone=${closeEditor} />`}
        ${tab === 'clients' && html`<${ClientsTab} />`}
        ${tab === 'banks'   && html`<${BanksTab} />`}
        ${tab === 'issuer'  && html`<${IssuerTab} />`}
      </div>
    </div>
    <style>
      .tabbar { display: flex; gap: 4px; border-bottom: 1px solid var(--border); overflow-x: auto; }
      .tab {
        padding: 10px 18px; border: none; background: transparent;
        color: var(--text-3); font-size: 13px; font-weight: 500;
        cursor: pointer; border-bottom: 2px solid transparent;
        margin-bottom: -1px; font-family: var(--font-jp); transition: all var(--tx-base);
        white-space: nowrap;
      }
      .tab:hover { color: var(--primary); }
      .tab.active {
        color: var(--primary); border-bottom-color: var(--primary); font-weight: 700;
      }
    </style>
  `;
}
