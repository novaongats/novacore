/* ============================================================
   NOVA Core v2 — Payroll / Employees master
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection } from '../../store.js';
import { formatYen, uid, asArray } from '../../shared.js';
import { EMP_TYPES, EMP_TYPE_MAP, PREFECTURES } from './constants.js';
import { getHealthStandard, findGrade } from './calc.js';

const html = htm.bind(h);

const EMPTY = {
  name: '',
  nameKana: '',
  type: 'regular',
  prefecture: 'aichi',
  joinDate: '',
  monthlySalary: '',
  hourlyWage: '',
  baseHours: '',
  dependents: 0,
  residentTax: '',
  careEligible: false,
  stdRemuneration: '',  // 手動上書き可能
  memo: '',
};

export function EmployeesTab() {
  const { data, loading, error } = useCollection(repos.payrollEmployees);
  const [editing, setEditing] = useState(null);

  const list = [...asArray(data)].sort((a, b) =>
    (a.joinDate || '').localeCompare(b.joinDate || '') ||
    (a.name || '').localeCompare(b.name || '', 'ja')
  );

  return html`
    <div>
      <div style=${{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 16,
      }}>
        <div style=${{ fontSize: 13, color: 'var(--text-3)' }}>
          全 ${list.length} 名
        </div>
        <button class="btn" onClick=${() => setEditing({})}>＋ 従業員を追加</button>
      </div>

      ${error && html`<div class="note note-err">読込エラー: ${error.message}</div>`}

      ${loading ? html`<div style=${{ color: 'var(--text-3)' }}>読込中...</div>` :
        list.length === 0 ? html`
          <div class="card" style=${{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-3)' }}>
            <div style=${{ fontSize: 32, marginBottom: 10, opacity: .4 }}>👥</div>
            従業員がまだ登録されていません
            <div style=${{ marginTop: 12 }}>
              <button class="btn" onClick=${() => setEditing({})}>＋ 最初の従業員を追加</button>
            </div>
          </div>
        ` : html`
          <div class="card" style=${{ padding: 0, overflow: 'hidden' }}>
            <div style=${tableHead}>
              <div>氏名</div>
              <div>雇用形態</div>
              <div style=${{ textAlign: 'right' }}>基本給</div>
              <div style=${{ textAlign: 'center' }}>扶養</div>
              <div style=${{ textAlign: 'center' }}>標準報酬</div>
              <div></div>
            </div>
            ${list.map(e => html`
              <${Row} key=${e.id} emp=${e} onEdit=${() => setEditing(e)} />
            `)}
          </div>
        `}

      ${editing && html`
        <${EmployeeModal} initial=${editing} onClose=${() => setEditing(null)} />
      `}
    </div>
  `;
}

function Row({ emp, onEdit }) {
  const t = EMP_TYPE_MAP[emp.type] || EMP_TYPE_MAP.regular;
  const std = emp.stdRemuneration || getHealthStandard(emp.monthlySalary || emp.hourlyWage * (emp.baseHours || 160));
  const grade = findGrade(std);
  return html`
    <div style=${tableRow} onClick=${onEdit}>
      <div>
        <div style=${{ fontSize: 13, fontWeight: 600 }}>${emp.name || '(無名)'}</div>
        ${emp.nameKana && html`
          <div style=${{ fontSize: 11, color: 'var(--text-3)' }}>${emp.nameKana}</div>
        `}
      </div>
      <div>
        <span style=${{
          fontSize: 11, padding: '3px 10px', borderRadius: 999, fontWeight: 600,
          background: 'var(--primary-soft)', color: 'var(--primary)',
        }}>${t.label}</span>
      </div>
      <div class="num" style=${{ textAlign: 'right', fontWeight: 600 }}>
        ${t.isSalary
          ? formatYen(emp.monthlySalary)
          : '¥' + (emp.hourlyWage || 0) + ' /h'}
      </div>
      <div style=${{ textAlign: 'center', fontSize: 12 }}>
        ${emp.dependents || 0}人
      </div>
      <div style=${{ textAlign: 'center', fontSize: 11 }}>
        ${std ? html`
          <span class="num" style=${{ fontWeight: 600 }}>${formatYen(std)}</span>
          ${grade && html`<span style=${{ color: 'var(--text-4)', marginLeft: 4 }}>(${grade}級)</span>`}
        ` : '-'}
      </div>
      <div style=${{ textAlign: 'right' }}>
        <button class="btn btn-ghost" onClick=${(e) => { e.stopPropagation(); onEdit(); }}>編集</button>
      </div>
    </div>
  `;
}

function EmployeeModal({ initial, onClose }) {
  const isNew = !initial.id;
  const [form, setForm] = useState({ ...EMPTY, ...initial });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const typeInfo = EMP_TYPE_MAP[form.type] || EMP_TYPE_MAP.regular;
  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  // Auto-calc standard remuneration from salary (if not manually set)
  const autoStd = getHealthStandard(
    typeInfo.isSalary
      ? Number(form.monthlySalary) || 0
      : (Number(form.hourlyWage) || 0) * (Number(form.baseHours) || 160)
  );

  async function save() {
    setErr(null);
    if (!form.name.trim()) { setErr('氏名は必須です'); return; }
    setBusy(true);
    try {
      await repos.payrollEmployees.upsert({
        id: initial.id || uid('emp_'),
        name: form.name.trim(),
        nameKana: (form.nameKana || '').trim(),
        type: form.type,
        prefecture: form.prefecture,
        joinDate: form.joinDate || '',
        monthlySalary: Number(form.monthlySalary) || 0,
        hourlyWage:    Number(form.hourlyWage) || 0,
        baseHours:     Number(form.baseHours) || 0,
        dependents:    Math.max(0, Number(form.dependents) || 0),
        residentTax:   Number(form.residentTax) || 0,
        careEligible:  !!form.careEligible,
        stdRemuneration: Number(form.stdRemuneration) || 0,  // 0 = auto
        memo: (form.memo || '').trim(),
      });
      onClose();
    } catch (e) {
      console.error('[payroll/employees] save failed', e);
      setErr('保存に失敗: ' + (e.message || e));
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`「${initial.name}」を削除しますか？\n過去の給与履歴は残ります。`)) return;
    setBusy(true);
    try {
      await repos.payrollEmployees.remove(initial.id);
      onClose();
    } catch (e) {
      console.error('[payroll/employees] delete failed', e);
      setErr('削除に失敗: ' + (e.message || e));
      setBusy(false);
    }
  }

  return html`
    <div style=${modalBackdrop} onClick=${e => e.target === e.currentTarget && onClose()}>
      <div style=${modalCard}>
        <div style=${modalHeader}>
          <div style=${{ fontWeight: 700, fontSize: 16 }}>
            ${isNew ? '従業員を追加' : '従業員を編集'}
          </div>
          <button class="btn btn-ghost" onClick=${onClose} disabled=${busy}>✕</button>
        </div>

        <div style=${{ padding: 20, display: 'grid', gap: 14 }}>
          ${err && html`<div class="note note-err">${err}</div>`}

          <div style=${{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <div class="field">
              <label>氏名 *</label>
              <input type="text" value=${form.name}
                     onInput=${e => set('name', e.target.value)} disabled=${busy} />
            </div>
            <div class="field">
              <label>フリガナ</label>
              <input type="text" value=${form.nameKana}
                     onInput=${e => set('nameKana', e.target.value)} disabled=${busy} />
            </div>
          </div>

          <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div class="field">
              <label>雇用形態</label>
              <select value=${form.type} onChange=${e => set('type', e.target.value)}
                      disabled=${busy} style=${selectStyle}>
                ${EMP_TYPES.map(t => html`
                  <option key=${t.id} value=${t.id}>${t.label}</option>
                `)}
              </select>
              <div style=${{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
                ${typeInfo.note}
              </div>
            </div>
            <div class="field">
              <label>入社日</label>
              <input type="date" value=${form.joinDate}
                     onInput=${e => set('joinDate', e.target.value)} disabled=${busy} />
            </div>
          </div>

          ${typeInfo.isSalary ? html`
            <div class="field">
              <label>月給 *</label>
              <input type="number" value=${form.monthlySalary}
                     onInput=${e => set('monthlySalary', e.target.value)} disabled=${busy}
                     style=${{ textAlign: 'right', fontFamily: 'var(--font-num)' }}
                     placeholder="250000" />
            </div>
          ` : html`
            <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div class="field">
                <label>時給 *</label>
                <input type="number" value=${form.hourlyWage}
                       onInput=${e => set('hourlyWage', e.target.value)} disabled=${busy}
                       style=${{ textAlign: 'right', fontFamily: 'var(--font-num)' }}
                       placeholder="1200" />
              </div>
              <div class="field">
                <label>月平均労働時間</label>
                <input type="number" value=${form.baseHours}
                       onInput=${e => set('baseHours', e.target.value)} disabled=${busy}
                       style=${{ textAlign: 'right', fontFamily: 'var(--font-num)' }}
                       placeholder="160" />
              </div>
            </div>
          `}

          <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div class="field">
              <label>都道府県（健保料率）</label>
              <select value=${form.prefecture} onChange=${e => set('prefecture', e.target.value)}
                      disabled=${busy} style=${selectStyle}>
                ${PREFECTURES.map(p => html`
                  <option key=${p.id} value=${p.id}>${p.label}</option>
                `)}
              </select>
            </div>
            <div class="field">
              <label>扶養親族等</label>
              <input type="number" min="0" value=${form.dependents}
                     onInput=${e => set('dependents', e.target.value)} disabled=${busy} />
            </div>
            <div class="field">
              <label>住民税（月額）</label>
              <input type="number" value=${form.residentTax}
                     onInput=${e => set('residentTax', e.target.value)} disabled=${busy}
                     style=${{ textAlign: 'right', fontFamily: 'var(--font-num)' }} />
            </div>
          </div>

          <label style=${checkLabel}>
            <input type="checkbox" checked=${form.careEligible}
                   onChange=${e => set('careEligible', e.target.checked)} disabled=${busy} />
            介護保険対象（満40歳以上）
          </label>

          <div class="card" style=${{ padding: 14, background: 'var(--primary-soft)' }}>
            <div style=${{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
              標準報酬月額
            </div>
            <div style=${{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="number" value=${form.stdRemuneration}
                     onInput=${e => set('stdRemuneration', e.target.value)} disabled=${busy}
                     placeholder="自動計算"
                     style=${{ ...selectStyle, width: 180, textAlign: 'right', fontFamily: 'var(--font-num)' }} />
              <span style=${{ fontSize: 12, color: 'var(--text-3)' }}>
                空欄で自動計算 → <strong>${formatYen(autoStd)}</strong>
                (${findGrade(autoStd) || '-'}級)
              </span>
            </div>
          </div>

          <div class="field">
            <label>メモ</label>
            <input type="text" value=${form.memo}
                   onInput=${e => set('memo', e.target.value)} disabled=${busy} />
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
            <button class="btn" onClick=${save} disabled=${busy}>${busy ? '保存中...' : '保存'}</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ---- Styles ---------------------------------------------------------------

const selectStyle = {
  width: '100%', padding: '12px 16px',
  border: '1px solid var(--border)', borderRadius: 10,
  background: '#f8f9fc', fontFamily: 'inherit', fontSize: 14,
};
const checkLabel = {
  display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
  fontSize: 13, color: 'var(--text-2)', fontWeight: 500,
};
const tableHead = {
  display: 'grid',
  gridTemplateColumns: '200px 150px 140px 80px 180px 80px',
  gap: 12, padding: '10px 16px', background: 'var(--bg-alt)',
  fontSize: 11, color: 'var(--text-3)', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.04em',
};
const tableRow = {
  display: 'grid',
  gridTemplateColumns: '200px 150px 140px 80px 180px 80px',
  gap: 12, padding: '12px 16px',
  borderBottom: '1px solid var(--border-2)',
  alignItems: 'center', cursor: 'pointer',
};
const modalBackdrop = {
  position: 'fixed', inset: 0, background: 'rgba(12,12,20,0.5)',
  backdropFilter: 'blur(6px)', zIndex: 9999,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const modalCard = {
  background: 'var(--surface)', borderRadius: 18,
  maxWidth: 640, width: '100%', maxHeight: '90vh', overflow: 'auto',
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
