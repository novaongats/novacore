/* ============================================================
   NOVA Core v2 — Payroll / Rates configuration
   Settings docs:
   - settings/payroll_health_rates:      { rates: {tokyo, kanagawa, aichi, gifu} }
   - settings/payroll_employment_rates:  { employee, employer }
   - settings/payroll_other_rates:       { care, pension }
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useEffect } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useDoc } from '../../store.js';
import {
  DEFAULT_HEALTH_RATES, DEFAULT_EMPLOYMENT_RATES,
  DEFAULT_CARE_RATE, PENSION_RATE, PREFECTURES,
} from './constants.js';

const html = htm.bind(h);

export function RatesTab() {
  return html`
    <div style=${{ maxWidth: 760 }}>
      <div class="note note-info">
        社会保険料・雇用保険料の料率設定です。<br>
        毎年改定されるため、最新の公式料率を適宜更新してください。<br>
        （参考: 全国健康保険協会・日本年金機構・厚生労働省）
      </div>
      <${HealthRatesSection} />
      <${OtherRatesSection} />
      <${EmploymentRatesSection} />
    </div>
  `;
}

// ---- 健康保険料率（都道府県別）---------------------------------------------

function HealthRatesSection() {
  const { data, loading } = useDoc(repos.settings, 'payroll_health_rates');
  const [form, setForm] = useState({ ...DEFAULT_HEALTH_RATES });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data?.rates) setForm({ ...DEFAULT_HEALTH_RATES, ...data.rates });
  }, [data]);

  async function save() {
    setMsg(null);
    setBusy(true);
    try {
      const sanitized = {};
      for (const k of Object.keys(form)) {
        sanitized[k] = Number(form[k]) || 0;
      }
      await repos.settings.setId('payroll_health_rates', { rates: sanitized }, { merge: true });
      setMsg({ kind: 'ok', text: '保存しました' });
      setTimeout(() => setMsg(null), 2000);
    } catch (e) {
      console.error('[rates] health save failed', e);
      setMsg({ kind: 'err', text: '保存に失敗: ' + (e.message || e) });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return html`<div style=${{ color: 'var(--text-3)' }}>読込中...</div>`;

  return html`
    <div class="card" style=${{ padding: 20, marginTop: 16 }}>
      <div style=${sectionTitle}>🏥 健康保険料率（都道府県別）</div>
      <div style=${{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12 }}>
        料率 (%) は<strong>折半前の総料率</strong>を入力。従業員負担は半額になります。
      </div>

      ${msg && html`<div class=${'note note-' + msg.kind}>${msg.text}</div>`}

      <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        ${PREFECTURES.map(p => html`
          <div key=${p.id} class="field">
            <label>${p.label}</label>
            <div style=${{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="number" step="0.01"
                     value=${form[p.id] ?? ''}
                     onInput=${e => setForm(f => ({ ...f, [p.id]: e.target.value }))}
                     disabled=${busy}
                     style=${{ ...inputStyle, textAlign: 'right', fontFamily: 'var(--font-num)' }} />
              <span style=${{ fontSize: 13, color: 'var(--text-3)' }}>%</span>
            </div>
          </div>
        `)}
      </div>

      <div style=${{ marginTop: 14 }}>
        <button class="btn" onClick=${save} disabled=${busy}>
          ${busy ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  `;
}

// ---- 厚生年金 + 介護保険料率 ------------------------------------------------

function OtherRatesSection() {
  const { data, loading } = useDoc(repos.settings, 'payroll_other_rates');
  const [pension, setPension] = useState(PENSION_RATE);
  const [care, setCare] = useState(DEFAULT_CARE_RATE);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) {
      if (data.pension != null) setPension(data.pension);
      if (data.care != null)    setCare(data.care);
    }
  }, [data]);

  async function save() {
    setMsg(null);
    setBusy(true);
    try {
      await repos.settings.setId('payroll_other_rates', {
        pension: Number(pension) || 0,
        care: Number(care) || 0,
      }, { merge: true });
      setMsg({ kind: 'ok', text: '保存しました' });
      setTimeout(() => setMsg(null), 2000);
    } catch (e) {
      setMsg({ kind: 'err', text: '保存に失敗: ' + (e.message || e) });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;

  return html`
    <div class="card" style=${{ padding: 20, marginTop: 16 }}>
      <div style=${sectionTitle}>💼 厚生年金・介護保険 料率</div>

      ${msg && html`<div class=${'note note-' + msg.kind}>${msg.text}</div>`}

      <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        <div class="field">
          <label>
            厚生年金保険料率（折半前）
            <div style=${{ fontSize: 10, color: 'var(--text-3)', fontWeight: 400, marginTop: 2 }}>
              2017年以降 18.30% 固定
            </div>
          </label>
          <div style=${{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="number" step="0.01" value=${pension}
                   onInput=${e => setPension(e.target.value)} disabled=${busy}
                   style=${{ ...inputStyle, textAlign: 'right', fontFamily: 'var(--font-num)' }} />
            <span style=${{ fontSize: 13, color: 'var(--text-3)' }}>%</span>
          </div>
        </div>
        <div class="field">
          <label>
            介護保険料率（40歳以上、折半前）
            <div style=${{ fontSize: 10, color: 'var(--text-3)', fontWeight: 400, marginTop: 2 }}>
              全国共通、毎年改定
            </div>
          </label>
          <div style=${{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="number" step="0.01" value=${care}
                   onInput=${e => setCare(e.target.value)} disabled=${busy}
                   style=${{ ...inputStyle, textAlign: 'right', fontFamily: 'var(--font-num)' }} />
            <span style=${{ fontSize: 13, color: 'var(--text-3)' }}>%</span>
          </div>
        </div>
      </div>

      <div style=${{ marginTop: 14 }}>
        <button class="btn" onClick=${save} disabled=${busy}>
          ${busy ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  `;
}

// ---- 雇用保険料率 ----------------------------------------------------------

function EmploymentRatesSection() {
  const { data, loading } = useDoc(repos.settings, 'payroll_employment_rates');
  const [employee, setEmployee] = useState(DEFAULT_EMPLOYMENT_RATES.employee);
  const [employer, setEmployer] = useState(DEFAULT_EMPLOYMENT_RATES.employer);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) {
      if (data.employee != null) setEmployee(data.employee);
      if (data.employer != null) setEmployer(data.employer);
    }
  }, [data]);

  async function save() {
    setMsg(null);
    setBusy(true);
    try {
      await repos.settings.setId('payroll_employment_rates', {
        employee: Number(employee) || 0,
        employer: Number(employer) || 0,
      }, { merge: true });
      setMsg({ kind: 'ok', text: '保存しました' });
      setTimeout(() => setMsg(null), 2000);
    } catch (e) {
      setMsg({ kind: 'err', text: '保存に失敗: ' + (e.message || e) });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;

  return html`
    <div class="card" style=${{ padding: 20, marginTop: 16 }}>
      <div style=${sectionTitle}>🛡️ 雇用保険料率（一般の事業）</div>
      <div style=${{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12 }}>
        雇用保険は折半ではなく、従業員と事業主で負担率が異なります。
      </div>

      ${msg && html`<div class=${'note note-' + msg.kind}>${msg.text}</div>`}

      <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        <div class="field">
          <label>従業員負担率</label>
          <div style=${{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="number" step="0.01" value=${employee}
                   onInput=${e => setEmployee(e.target.value)} disabled=${busy}
                   style=${{ ...inputStyle, textAlign: 'right', fontFamily: 'var(--font-num)' }} />
            <span style=${{ fontSize: 13, color: 'var(--text-3)' }}>%</span>
          </div>
        </div>
        <div class="field">
          <label>事業主負担率（参考・給与計算には不使用）</label>
          <div style=${{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="number" step="0.01" value=${employer}
                   onInput=${e => setEmployer(e.target.value)} disabled=${busy}
                   style=${{ ...inputStyle, textAlign: 'right', fontFamily: 'var(--font-num)' }} />
            <span style=${{ fontSize: 13, color: 'var(--text-3)' }}>%</span>
          </div>
        </div>
      </div>

      <div style=${{ marginTop: 14 }}>
        <button class="btn" onClick=${save} disabled=${busy}>
          ${busy ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  `;
}

// ---- Styles ---------------------------------------------------------------

const sectionTitle = {
  fontSize: 14, fontWeight: 700, marginBottom: 14,
  paddingBottom: 10, borderBottom: '1px solid var(--border-2)',
};
const inputStyle = {
  flex: 1, padding: '10px 12px',
  border: '1px solid var(--border)', borderRadius: 8,
  background: '#f8f9fc', fontSize: 14,
};
