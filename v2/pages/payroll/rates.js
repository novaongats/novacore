/* ============================================================
   NOVA Core v2 — Payroll / Rates configuration（適用年月ベースの履歴）

   料率は payrollRates コレクションに「適用開始年月」付きで保存し、
   給与計算時は getRatesFor(month) が該当月に有効な料率を解決する。
   - doc id = effectiveDate ('YYYY-MM')
   - スキーマ: { effectiveDate, health:{tokyo,...}, care, pension,
                employmentEmployee, employmentEmployer, childSupport, note, source }

   旧 settings/payroll_*_rates（単一値）は履歴が無い月のフォールバック
   として引き続き機能する（getRatesFor 参照）。
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection } from '../../store.js';
import { asArray, thisMonth } from '../../shared.js';
import {
  DEFAULT_HEALTH_RATES, DEFAULT_EMPLOYMENT_RATES,
  DEFAULT_CARE_RATE, PENSION_RATE, DEFAULT_CHILD_SUPPORT_RATE,
  PREFECTURES, RATE_PRESETS,
} from './constants.js';

const html = htm.bind(h);

export function RatesTab() {
  const { data, loading, error } = useCollection(repos.payrollRates);
  const [editing, setEditing] = useState(null); // null | {} (new) | doc
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const list = [...asArray(data)]
    .filter(r => r.effectiveDate)
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));

  const current = list.find(r => r.effectiveDate <= thisMonth());

  async function applyPresets() {
    const missing = RATE_PRESETS.filter(p => !list.some(r => r.effectiveDate === p.effectiveDate));
    if (missing.length === 0) {
      setMsg({ kind: 'info', text: 'プリセットはすべて登録済みです' });
      return;
    }
    if (!confirm(`以下のプリセットを登録します:\n\n${missing.map(p => `・${p.effectiveDate}〜: ${p.label}`).join('\n')}\n\nよろしいですか？`)) return;
    setBusy(true);
    try {
      for (const p of missing) {
        const { label, ...doc } = p;
        await repos.payrollRates.setId(p.effectiveDate, { ...doc, source: 'preset' });
      }
      setMsg({ kind: 'ok', text: `${missing.length}件のプリセットを登録しました` });
    } catch (e) {
      console.error('[rates] preset apply failed', e);
      setMsg({ kind: 'err', text: '登録に失敗: ' + (e.message || e) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(r) {
    if (!confirm(`${r.effectiveDate} 適用分の料率を削除しますか？\n（この月以降の給与計算は、それ以前の料率にフォールバックします）`)) return;
    setBusy(true);
    try {
      await repos.payrollRates.remove(r.id);
    } catch (e) {
      setMsg({ kind: 'err', text: '削除に失敗: ' + (e.message || e) });
    } finally {
      setBusy(false);
    }
  }

  return html`
    <div style=${{ maxWidth: 920 }}>
      <div class="note note-info">
        料率は<strong>適用開始年月つきの履歴</strong>で管理します。給与計算は対象月に有効な料率を自動で使います。<br>
        年度改定（健保・介護は3月分〜、雇用保険は4月〜）のたびに行を追加してください。<br>
        「最新プリセットを適用」でアプリに同梱された公表料率をワンクリック登録できます
        （出典: 協会けんぽ・厚生労働省。外部サイトからの自動取得は行いません）。
      </div>

      ${msg && html`<div class=${'note note-' + (msg.kind === 'err' ? 'err' : msg.kind === 'ok' ? 'ok' : 'info')}
                         style=${{ marginTop: 10 }}>${msg.text}</div>`}
      ${error && html`<div class="note note-err">読込エラー: ${error.message}</div>`}

      <div style=${{ display: 'flex', gap: 8, margin: '14px 0' }}>
        <button class="btn" onClick=${() => setEditing({})} disabled=${busy}>＋ 料率を追加</button>
        <button class="btn btn-ghost" onClick=${applyPresets} disabled=${busy}>
          📦 最新プリセットを適用（令和8年度）
        </button>
      </div>

      ${loading ? html`<div style=${{ color: 'var(--text-3)' }}>読込中...</div>` :
        list.length === 0 ? html`
          <div class="card" style=${{ padding: '36px 20px', textAlign: 'center', color: 'var(--text-3)' }}>
            <div style=${{ fontSize: 30, marginBottom: 8, opacity: .4 }}>📊</div>
            料率履歴がまだありません。<br>
            まず「最新プリセットを適用」を押してください。<br>
            <span style=${{ fontSize: 11 }}>
              （履歴が無い月は既定値: 東京${DEFAULT_HEALTH_RATES.tokyo}% / 介護${DEFAULT_CARE_RATE}% /
              厚年${PENSION_RATE}% / 雇保${DEFAULT_EMPLOYMENT_RATES.employee}% で計算されます）
            </span>
          </div>
        ` : html`
          <div class="card" style=${{ padding: 0, overflow: 'auto' }}>
            <table style=${{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style=${{ background: 'var(--bg-alt)' }}>
                  <th style=${th}>適用開始</th>
                  ${PREFECTURES.map(p => html`<th key=${p.id} style=${{ ...th, textAlign: 'right' }}>${p.label.replace(/[都府県]$/, '')}</th>`)}
                  <th style=${{ ...th, textAlign: 'right' }}>介護</th>
                  <th style=${{ ...th, textAlign: 'right' }}>厚年</th>
                  <th style=${{ ...th, textAlign: 'right' }}>雇保(本人)</th>
                  <th style=${{ ...th, textAlign: 'right' }}>支援金</th>
                  <th style=${th}>メモ</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${list.map(r => {
                  const isCurrent = current && r.effectiveDate === current.effectiveDate;
                  return html`
                    <tr key=${r.id} style=${{
                      borderTop: '1px solid var(--border-2)',
                      background: isCurrent ? 'var(--primary-soft)' : 'transparent',
                    }}>
                      <td style=${{ ...td, fontWeight: 700 }}>
                        ${r.effectiveDate}〜
                        ${isCurrent && html`<span style=${{
                          marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 999,
                          background: 'var(--primary)', color: '#fff', fontWeight: 600,
                        }}>適用中</span>`}
                      </td>
                      ${PREFECTURES.map(p => html`
                        <td key=${p.id} class="num" style=${{ ...td, textAlign: 'right' }}>
                          ${r.health?.[p.id] != null ? r.health[p.id] + '%' : '−'}
                        </td>
                      `)}
                      <td class="num" style=${{ ...td, textAlign: 'right' }}>${r.care != null ? r.care + '%' : '−'}</td>
                      <td class="num" style=${{ ...td, textAlign: 'right' }}>${r.pension != null ? r.pension + '%' : '−'}</td>
                      <td class="num" style=${{ ...td, textAlign: 'right' }}>${r.employmentEmployee != null ? r.employmentEmployee + '%' : '−'}</td>
                      <td class="num" style=${{ ...td, textAlign: 'right' }}>${r.childSupport != null ? r.childSupport + '%' : '−'}</td>
                      <td style=${{ ...td, fontSize: 11, color: 'var(--text-3)', maxWidth: 220 }}>${r.note || ''}</td>
                      <td style=${{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button class="btn btn-ghost" style=${{ padding: '4px 8px' }}
                                onClick=${() => setEditing(r)} disabled=${busy}>編集</button>
                        <button class="btn btn-ghost" style=${{ padding: '4px 8px', color: 'var(--danger)' }}
                                onClick=${() => remove(r)} disabled=${busy}>削除</button>
                      </td>
                    </tr>
                  `;
                })}
              </tbody>
            </table>
          </div>
          <div style=${{ marginTop: 10, fontSize: 11, color: 'var(--text-3)' }}>
            ※ 料率はすべて<strong>折半前の総料率</strong>。従業員負担は半額（雇用保険を除く）。<br>
            ※ 子ども・子育て支援金は2026年4月分から健保加入者に適用されます（それ以前の月は自動的に0円）。
          </div>
        `}

      ${editing && html`
        <${RateModal} initial=${editing} existing=${list} onClose=${() => setEditing(null)} />
      `}
    </div>
  `;
}

// ---- 追加・編集モーダル -------------------------------------------------------

function RateModal({ initial, existing, onClose }) {
  const isNew = !initial.id;
  const base = existing[0] || {};  // 直近の履歴を初期値に
  const [form, setForm] = useState(() => ({
    effectiveDate: initial.effectiveDate || thisMonth(),
    health: { ...DEFAULT_HEALTH_RATES, ...(base.health || {}), ...(initial.health || {}) },
    care: initial.care ?? base.care ?? DEFAULT_CARE_RATE,
    pension: initial.pension ?? base.pension ?? PENSION_RATE,
    employmentEmployee: initial.employmentEmployee ?? base.employmentEmployee ?? DEFAULT_EMPLOYMENT_RATES.employee,
    employmentEmployer: initial.employmentEmployer ?? base.employmentEmployer ?? DEFAULT_EMPLOYMENT_RATES.employer,
    childSupport: initial.childSupport ?? base.childSupport ?? DEFAULT_CHILD_SUPPORT_RATE,
    note: initial.note || '',
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }
  function setHealth(pref, v) { setForm(f => ({ ...f, health: { ...f.health, [pref]: v } })); }

  async function save() {
    setErr(null);
    if (!/^\d{4}-\d{2}$/.test(form.effectiveDate)) { setErr('適用開始年月は YYYY-MM 形式で入力してください'); return; }
    if (isNew && existing.some(r => r.effectiveDate === form.effectiveDate)) {
      setErr(`${form.effectiveDate} 適用分は既に存在します（編集してください）`);
      return;
    }
    setBusy(true);
    try {
      const health = {};
      for (const p of PREFECTURES) health[p.id] = Number(form.health[p.id]) || 0;
      // 編集で適用年月を変えた場合は旧docを削除して新idで保存
      if (!isNew && initial.id !== form.effectiveDate) {
        await repos.payrollRates.remove(initial.id);
      }
      await repos.payrollRates.setId(form.effectiveDate, {
        effectiveDate: form.effectiveDate,
        health,
        care: Number(form.care) || 0,
        pension: Number(form.pension) || 0,
        employmentEmployee: Number(form.employmentEmployee) || 0,
        employmentEmployer: Number(form.employmentEmployer) || 0,
        childSupport: Number(form.childSupport) || 0,
        note: (form.note || '').trim(),
        source: 'manual',
      }, { merge: false });
      onClose();
    } catch (e) {
      console.error('[rates] save failed', e);
      setErr('保存に失敗: ' + (e.message || e));
      setBusy(false);
    }
  }

  return html`
    <div style=${modalBackdrop} onClick=${e => e.target === e.currentTarget && onClose()}>
      <div style=${modalCard}>
        <div style=${modalHeader}>
          <div style=${{ fontWeight: 700, fontSize: 16 }}>
            ${isNew ? '料率を追加' : `${initial.effectiveDate} 適用分を編集`}
          </div>
          <button class="btn btn-ghost" onClick=${onClose} disabled=${busy}>✕</button>
        </div>

        <div style=${{ padding: 20, display: 'grid', gap: 14 }}>
          ${err && html`<div class="note note-err">${err}</div>`}

          <div class="field" style=${{ maxWidth: 200 }}>
            <label>適用開始年月 *</label>
            <input type="month" value=${form.effectiveDate}
                   onInput=${e => set('effectiveDate', e.target.value)} disabled=${busy} />
          </div>

          <div>
            <div style=${groupLabel}>健康保険料率（都道府県別、折半前 %）</div>
            <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              ${PREFECTURES.map(p => html`
                <${PctField} key=${p.id} label=${p.label} value=${form.health[p.id]}
                             onInput=${v => setHealth(p.id, v)} disabled=${busy} />
              `)}
            </div>
          </div>

          <div>
            <div style=${groupLabel}>その他の料率（折半前 %）</div>
            <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <${PctField} label="介護保険（40〜64歳）" value=${form.care}
                           onInput=${v => set('care', v)} disabled=${busy} />
              <${PctField} label="厚生年金" value=${form.pension}
                           onInput=${v => set('pension', v)} disabled=${busy} />
              <${PctField} label="子ども・子育て支援金" value=${form.childSupport}
                           onInput=${v => set('childSupport', v)} disabled=${busy} />
            </div>
          </div>

          <div>
            <div style=${groupLabel}>雇用保険料率（一般の事業 %）</div>
            <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              <${PctField} label="従業員負担" value=${form.employmentEmployee}
                           onInput=${v => set('employmentEmployee', v)} disabled=${busy} />
              <${PctField} label="事業主負担（参考）" value=${form.employmentEmployer}
                           onInput=${v => set('employmentEmployer', v)} disabled=${busy} />
            </div>
          </div>

          <div class="field">
            <label>メモ（出典など）</label>
            <input type="text" value=${form.note}
                   onInput=${e => set('note', e.target.value)} disabled=${busy}
                   placeholder="例: 協会けんぽ令和8年度" />
          </div>
        </div>

        <div style=${modalFooter}>
          <div></div>
          <div style=${{ display: 'flex', gap: 8 }}>
            <button class="btn btn-ghost" onClick=${onClose} disabled=${busy}>キャンセル</button>
            <button class="btn" onClick=${save} disabled=${busy}>${busy ? '保存中...' : '保存'}</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function PctField({ label, value, onInput, disabled }) {
  return html`
    <div class="field">
      <label>${label}</label>
      <div style=${{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="number" step="0.01" value=${value ?? ''}
               onInput=${e => onInput(e.target.value)} disabled=${disabled}
               style=${{ ...inputStyle, textAlign: 'right', fontFamily: 'var(--font-num)' }} />
        <span style=${{ fontSize: 13, color: 'var(--text-3)' }}>%</span>
      </div>
    </div>
  `;
}

// ---- Styles ---------------------------------------------------------------

const th = {
  padding: '9px 12px', textAlign: 'left',
  color: 'var(--text-3)', fontWeight: 600, fontSize: 10.5,
  textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap',
};
const td = { padding: '9px 12px', whiteSpace: 'nowrap' };
const groupLabel = {
  fontSize: 12, fontWeight: 700, color: 'var(--text-2)', marginBottom: 8,
};
const inputStyle = {
  flex: 1, padding: '10px 12px',
  border: '1px solid var(--border)', borderRadius: 8,
  background: '#f8f9fc', fontSize: 14, width: '100%',
};
const modalBackdrop = {
  position: 'fixed', inset: 0, background: 'rgba(12,12,20,0.5)',
  backdropFilter: 'blur(6px)', zIndex: 9999,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const modalCard = {
  background: 'var(--surface)', borderRadius: 18,
  maxWidth: 720, width: '100%', maxHeight: '90vh', overflow: 'auto',
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
