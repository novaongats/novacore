/* ============================================================
   NOVA Core v2 — Sales page (tab container)
   Integrates 売上入力 + 売上管理 from v1.
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { CategoriesTab } from './categories.js';
import { EntriesTab } from './entries.js';
import { CostsTab } from './costs.js';
import { DashboardTab } from './dashboard.js';

const html = htm.bind(h);

const TABS = [
  { id: 'dashboard',  label: 'ダッシュボード' },
  { id: 'entries',    label: '日次売上' },
  { id: 'costs',      label: '月次コスト' },
  { id: 'categories', label: 'カテゴリ' },
];

export function SalesPage({ user }) {
  const [tab, setTab] = useState('dashboard');

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
        ${tab === 'dashboard'  && html`<${DashboardTab} />`}
        ${tab === 'entries'    && html`<${EntriesTab} />`}
        ${tab === 'costs'      && html`<${CostsTab} />`}
        ${tab === 'categories' && html`<${CategoriesTab} />`}
      </div>
    </div>
  `;
}
