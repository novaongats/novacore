/* ============================================================
   NOVA Core v2 — Payroll page (tab container)
   9 tabs covering the full monthly/annual payroll workflow.
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

import { EmployeesTab }  from './employees.js';
import { MonthlyTab }    from './monthly.js';
import { BonusTab }      from './bonus.js';
import { ListTab }       from './list.js';
import { AnnualTab }     from './annual.js';
import { AssessmentTab } from './assessment.js';
import { YearEndTab }    from './year-end.js';
import { RatesTab }      from './rates.js';
import { BanksTab }      from './banks.js';

const html = htm.bind(h);

const TABS = [
  { id: 'employees',  label: '👥 従業員マスタ' },
  { id: 'monthly',    label: '💰 月次給与' },
  { id: 'bonus',      label: '🎁 賞与' },
  { id: 'list',       label: '📋 給与一覧' },
  { id: 'annual',     label: '📈 年収管理' },
  { id: 'assessment', label: '📐 算定基礎届' },
  { id: 'year-end',   label: '🎊 年末調整' },
  { id: 'banks',      label: '🏦 振込口座' },
  { id: 'rates',      label: '⚙ 料率設定' },
];

export function PayrollPage({ user }) {
  const [tab, setTab] = useState('monthly');

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
        ${tab === 'employees'  && html`<${EmployeesTab} />`}
        ${tab === 'monthly'    && html`<${MonthlyTab} />`}
        ${tab === 'bonus'      && html`<${BonusTab} />`}
        ${tab === 'list'       && html`<${ListTab} />`}
        ${tab === 'annual'     && html`<${AnnualTab} />`}
        ${tab === 'assessment' && html`<${AssessmentTab} />`}
        ${tab === 'year-end'   && html`<${YearEndTab} />`}
        ${tab === 'banks'      && html`<${BanksTab} />`}
        ${tab === 'rates'      && html`<${RatesTab} />`}
      </div>
    </div>
    <style>
      .tabbar { display: flex; gap: 4px; border-bottom: 1px solid var(--border); overflow-x: auto; }
      .tab {
        padding: 10px 16px; border: none; background: transparent;
        color: var(--text-3); font-size: 12.5px; font-weight: 500;
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
