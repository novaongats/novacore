/* ============================================================
   NOVA Core v2 — Payroll / Employees master
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection, where, limit } from '../../store.js';
import { formatYen, uid, asArray } from '../../shared.js';
import { EMP_TYPES, EMP_TYPE_MAP, PREFECTURES } from './constants.js';
import { getHealthStandard, findGrade } from './calc.js';

const html = htm.bind(h);

const EMPTY = {
  name: '',
  nameKana: '',
  email: '',
  type: 'regular',
  prefecture: 'aichi',
  joinDate: '',
  birthDate: '',            // 40/65/70/75歳の保険切替を自動判定
  monthlySalary: '',
  hourlyWage: '',
  baseHours: '',
  dependents: 0,
  residentTax: '',
  careEligible: false,
  stdRemuneration: '',      // 手動上書き可能（0=自動計算）
  commuteAllowanceMonthly: '',   // 通勤手当（月額）
  commuteIsPublicTransport: true,
  commuteDistanceKm: '',    // 片道通勤距離(km) — マイカー等の非課税限度額の段階判定用
  onMaternityLeave: false,  // 産休（社保免除）
  onChildcareLeave: false,  // 育休（社保免除）
  archived: false,          // 退職済み（過去データ保護のため削除ではなくアーカイブ）
  memo: '',
};

export function EmployeesTab() {
  const { data, loading, error } = useCollection(repos.payrollEmployees);
  const [editing, setEditing] = useState(null);

  const list = [...asArray(data)].sort((a, b) =>
    (a.archived ? 1 : 0) - (b.archived ? 1 : 0) ||
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
    <div style=${{ ...tableRow, opacity: emp.archived ? 0.45 : 1 }} onClick=${onEdit}>
      <div>
        <div style=${{ fontSize: 13, fontWeight: 600 }}>
          ${emp.name || '(無名)'}
          ${emp.archived && html`<span style=${{
            marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 999,
            background: 'var(--bg-alt)', color: 'var(--text-3)', fontWeight: 600,
          }}>退職済</span>`}
        </div>
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
        email: (form.email || '').trim(),
        type: form.type,
        prefecture: form.prefecture,
        joinDate: form.joinDate || '',
        birthDate: form.birthDate || '',
        monthlySalary: Number(form.monthlySalary) || 0,
        hourlyWage:    Number(form.hourlyWage) || 0,
        baseHours:     Number(form.baseHours) || 0,
        dependents:    Math.max(0, Number(form.dependents) || 0),
        residentTax:   Number(form.residentTax) || 0,
        careEligible:  !!form.careEligible,
        stdRemuneration: Number(form.stdRemuneration) || 0,  // 0 = auto
        commuteAllowanceMonthly: Number(form.commuteAllowanceMonthly) || 0,
        commuteIsPublicTransport: form.commuteIsPublicTransport !== false,
        commuteDistanceKm: Number(form.commuteDistanceKm) || 0,  // 0 = 未入力

        onMaternityLeave: !!form.onMaternityLeave,
        onChildcareLeave: !!form.onChildcareLeave,
        archived: !!form.archived,
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
    setErr(null);
    setBusy(true);
    try {
      // 物理削除ガード: 給与記録（月次/賞与）がある従業員は削除不可（アーカイブを案内）
      const [recs, bons] = await Promise.all([
        repos.payrollRecords.list(where('empId', '==', initial.id), limit(1)),
        repos.payrollBonus.list(where('empId', '==', initial.id), limit(1)),
      ]);
      if (recs.length > 0 || bons.length > 0) {
        alert(`「${initial.name}」には給与記録（月次給与または賞与）が存在するため削除できません。\n` +
              '過去データ保護のため、「退職済み」にチェックを入れてアーカイブしてください。');
        setBusy(false);
        return;
      }
      if (!confirm(`「${initial.name}」を削除しますか？`)) {
        setBusy(false);
        return;
      }
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

          <div style=${{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <div class="field">
              <label>メールアドレス（給与明細の送付先）</label>
              <input type="email" value=${form.email}
                     onInput=${e => set('email', e.target.value)} disabled=${busy}
                     placeholder="taro@example.com" />
            </div>
            <div class="field">
              <label>生年月日</label>
              <input type="date" value=${form.birthDate}
                     onInput=${e => set('birthDate', e.target.value)} disabled=${busy} />
              <div style=${{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
                登録すると介護保険(40歳)等を自動判定
              </div>
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

          <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div class="field">
              <label>通勤手当（月額）</label>
              <input type="number" value=${form.commuteAllowanceMonthly}
                     onInput=${e => set('commuteAllowanceMonthly', e.target.value)} disabled=${busy}
                     style=${{ textAlign: 'right', fontFamily: 'var(--font-num)' }}
                     placeholder="0" />
              <div style=${{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
                非課税限度額（公共交通: 15万円）を自動で分離します
              </div>
            </div>
            <label style=${{ ...checkLabel, marginTop: 22 }}>
              <input type="checkbox" checked=${form.commuteIsPublicTransport !== false}
                     onChange=${e => set('commuteIsPublicTransport', e.target.checked)} disabled=${busy} />
              公共交通機関を利用（オフ=マイカー等）
            </label>
            ${form.commuteIsPublicTransport === false && html`
              <div class="field">
                <label>片道通勤距離 (km)</label>
                <input type="number" min="0" value=${form.commuteDistanceKm}
                       onInput=${e => set('commuteDistanceKm', e.target.value)} disabled=${busy}
                       style=${{ textAlign: 'right', fontFamily: 'var(--font-num)' }}
                       placeholder="例: 12" />
                <div style=${{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
                  マイカー等の非課税限度額を距離段階で判定します（未入力は上限31,600円で計算）
                </div>
              </div>
            `}
          </div>

          <div style=${{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <label style=${checkLabel}>
              <input type="checkbox" checked=${form.careEligible}
                     onChange=${e => set('careEligible', e.target.checked)} disabled=${busy} />
              介護保険対象（生年月日未登録時に使用）
            </label>
            <label style=${checkLabel}>
              <input type="checkbox" checked=${form.onMaternityLeave}
                     onChange=${e => set('onMaternityLeave', e.target.checked)} disabled=${busy} />
              産休中（社保免除）
            </label>
            <label style=${checkLabel}>
              <input type="checkbox" checked=${form.onChildcareLeave}
                     onChange=${e => set('onChildcareLeave', e.target.checked)} disabled=${busy} />
              育休中（社保免除）
            </label>
            ${!isNew && html`
              <label style=${checkLabel}>
                <input type="checkbox" checked=${form.archived}
                       onChange=${e => set('archived', e.target.checked)} disabled=${busy} />
                退職済み（給与計算の対象外にする）
              </label>
            `}
          </div>

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
