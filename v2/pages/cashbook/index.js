/* ============================================================
   NOVA Core v2 — Cashbook page (tab container)
   Integrates 現金出納帳 + 領収書仕分け (v1 two tools merged).
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { LedgerTab } from './ledger.js';
import { MastersTab } from './masters.js';
import { ScanTab } from './scan.js';

const html = htm.bind(h);

const TABS = [
  { id: 'ledger',  label: '📒 出納帳' },
  { id: 'scan',    label: '🤖 AIスキャン' },
  { id: 'masters', label: '⚙ マスタ管理' },
];

export function CashbookPage({ user }) {
  const [tab, setTab] = useState('ledger');

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
        ${tab === 'ledger'  && html`<${LedgerTab} />`}
        ${tab === 'masters' && html`<${MastersTab} />`}
        ${tab === 'scan'    && html`<${ScanTab} />`}
      </div>
    </div>
    <style>
      .tabbar { display: flex; gap: 4px; border-bottom: 1px solid var(--border); }
      .tab {
        padding: 10px 18px; border: none; background: transparent;
        color: var(--text-3); font-size: 13px; font-weight: 500;
        cursor: pointer; border-bottom: 2px solid transparent;
        margin-bottom: -1px; font-family: var(--font-jp); transition: all var(--tx-base);
      }
      .tab:hover { color: var(--primary); }
      .tab.active {
        color: var(--primary); border-bottom-color: var(--primary); font-weight: 700;
      }
    </style>
  `;
}

