/* ============================================================
   NOVA Core v2 — Payroll / Monthly calculation
   Calculate & save monthly paycheck per employee.
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useEffect, useMemo } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection, useDoc, where } from '../../store.js';
import { formatYen, thisMonth, monthLabel, addMonths, asArray } from '../../shared.js';
import { EMP_TYPES, EMP_TYPE_MAP, DEFAULT_HEALTH_RATES, DEFAULT_EMPLOYMENT_RATES,
         DEFAULT_CARE_RATE, PENSION_RATE } from './constants.js';
import { calcMonthlyPaycheck } from './calc.js';
import { PayslipOverlay } from './payslip.js';

const html = htm.bind(h);

export function MonthlyTab() {
  const [month, setMonth] = useState(thisMonth());
  const [selectedEmpId, setSelectedEmpId] = useState(null);
  const [previewRecord, setPreviewRecord] = useState(null);
  const [showBatchModal, setShowBatchModal] = useState(false);

  const employees = useCollection(repos.payrollEmployees);
  const records   = useCollection(
    repos.payrollRecords,
    () => [where('month', '==', month)],
    [month],
  );

  const healthRatesQ  = useDoc(repos.settings, 'payroll_health_rates');
  const empRatesQ     = useDoc(repos.settings, 'payroll_employment_rates');
  const otherRatesQ   = useDoc(repos.settings, 'payroll_other_rates');

  const rates = useMemo(() => ({
    health: healthRatesQ.data?.rates || DEFAULT_HEALTH_RATES,
    employmentEmployee:
      empRatesQ.data?.employee ?? DEFAULT_EMPLOYMENT_RATES.employee,
    employmentEmployer:
      empRatesQ.data?.employer ?? DEFAULT_EMPLOYMENT_RATES.employer,
    careRate:    otherRatesQ.data?.care    ?? DEFAULT_CARE_RATE,
    pensionRate: otherRatesQ.data?.pension ?? PENSION_RATE,
  }), [healthRatesQ.data, empRatesQ.data, otherRatesQ.data]);

  const empList = asArray(employees.data);
  const recordMap = new Map(asArray(records.data).map(r => [r.empId, r]));

  const selectedEmp = empList.find(e => e.id === selectedEmpId);

  return html`
    <div>
      <div style=${{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18,
        flexWrap: 'wrap',
      }}>
        <button class="btn btn-ghost" onClick=${() => setMonth(addMonths(month, -1))}>◀</button>
        <div style=${{ fontSize: 16, fontWeight: 700, minWidth: 120, textAlign: 'center' }}>
          ${monthLabel(month)} 給与計算
        </div>
        <button class="btn btn-ghost" onClick=${() => setMonth(addMonths(month, 1))}>▶</button>
        <button class="btn btn-ghost" onClick=${() => setMonth(thisMonth())}>今月</button>

        <div style=${{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button class="btn" onClick=${() => setShowBatchModal(true)} disabled=${empList.length === 0}>
            📊 一括計算
          </button>
          <button class="btn btn-ghost"
                  onClick=${() => {
                    const all = Array.from(recordMap.values());
                    if (all.length === 0) { alert('まだ計算された明細がありません'); return; }
                    setPreviewRecord({ multi: true, records: all });
                  }}
                  disabled=${recordMap.size === 0}>
            🖨 全員の明細を印刷
          </button>
        </div>
      </div>

      ${empList.length === 0 ? html`
        <div class="note note-warn">
          従業員が未登録です。「従業員マスタ」タブから追加してください。
        </div>
      ` : html`
        <div style=${{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, alignItems: 'start' }}>
          <${EmpSelector}
            employees=${empList}
            recordMap=${recordMap}
            selectedId=${selectedEmpId}
            onSelect=${setSelectedEmpId}
          />
          <div>
            ${selectedEmp ? html`
              <${CalcPanel}
                key=${selectedEmp.id + '|' + month}
                emp=${selectedEmp}
                month=${month}
                rates=${rates}
                existing=${recordMap.get(selectedEmp.id)}
                onPreview=${(rec) => setPreviewRecord({ multi: false, records: [rec] })}
              />
            ` : html`
              <div class="card" style=${{ padding: '40px', textAlign: 'center', color: 'var(--text-3)' }}>
                左側から従業員を選択してください
              </div>
            `}
          </div>
        </div>
      `}

      ${showBatchModal && html`
        <${BatchModal}
          employees=${empList}
          recordMap=${recordMap}
          month=${month}
          rates=${rates}
          onClose=${() => setShowBatchModal(false)}
        />
      `}

      ${previewRecord && html`
        <${PayslipOverlay}
          records=${previewRecord.records.map(r => ({ ...r, month: r.month || month }))}
          onClose=${() => setPreviewRecord(null)}
        />
      `}
    </div>
  `;
}

// ---- Left: employee selector with status badges ---------------------------

function EmpSelector({ employees, recordMap, selectedId, onSelect }) {
  return html`
    <div class="card" style=${{ padding: 0, overflow: 'hidden' }}>
      <div style=${{
        padding: '10px 14px', fontSize: 12, fontWeight: 700, color: 'var(--text-3)',
        background: 'var(--bg-alt)', textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>
        従業員 (${employees.length}名)
      </div>
      ${employees.map(e => {
        const rec = recordMap.get(e.id);
        const done = !!rec;
        const active = selectedId === e.id;
        const type = EMP_TYPE_MAP[e.type] || EMP_TYPE_MAP.regular;
        return html`
          <div key=${e.id} onClick=${() => onSelect(e.id)}
               style=${{
                 padding: '11px 14px',
                 borderBottom: '1px solid var(--border-2)',
                 cursor: 'pointer',
                 background: active ? 'var(--primary-soft)' : 'transparent',
                 borderLeft: active ? '3px solid var(--primary)' : '3px solid transparent',
               }}>
            <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style=${{ fontSize: 13, fontWeight: 600,
                             color: active ? 'var(--primary)' : 'var(--text)' }}>
                ${e.name}
              </div>
              ${done && html`<span style=${{
                fontSize: 10, padding: '1px 6px', borderRadius: 999,
                background: 'var(--success-soft)', color: 'var(--success)', fontWeight: 600,
              }}>✓ 済</span>`}
            </div>
            <div style=${{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
              ${type.label} · ${done ? formatYen(rec.net) : '未計算'}
            </div>
          </div>
        `;
      })}
    </div>
  `;
}

// ---- Right: calc form + result --------------------------------------------

function CalcPanel({ emp, month, rates, existing, onPreview }) {
  const typeInfo = EMP_TYPE_MAP[emp.type] || EMP_TYPE_MAP.regular;

  // Initialize from existing record if present
  const [input, setInput] = useState(() => ({
    basePay:     existing?.basePay     ?? (typeInfo.isSalary ? emp.monthlySalary : ''),
    hours:       existing?.hours       ?? '',
    commission:  existing?.commission  ?? '',
    allowance:   existing?.allowance   ?? '',
    deduction:   existing?.deduction   ?? '',
    residentTax: existing?.residentTax ?? emp.residentTax ?? '',
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  function set(k, v) { setInput(i => ({ ...i, [k]: v })); }

  // Compute paycheck live
  const calc = useMemo(() => calcMonthlyPaycheck(emp, {
    basePay:     Number(input.basePay)     || 0,
    hours:       Number(input.hours)       || 0,
    commission:  Number(input.commission)  || 0,
    allowance:   Number(input.allowance)   || 0,
    deduction:   Number(input.deduction)   || 0,
    residentTax: Number(input.residentTax) || 0,
    rates: {
      healthRate:         rates.health?.[emp.prefecture],
      careRate:           rates.careRate,
      pensionRate:        rates.pensionRate,
      employmentEmployee: rates.employmentEmployee,
    },
  }), [emp, input, rates]);

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      const id = `${month}_${emp.id}`;
      await repos.payrollRecords.setId(id, {
        month,
        empId: emp.id,
        empName: emp.name,
        empType: emp.type,
        // Inputs
        basePay:    calc.basePay,
        hours:      Number(input.hours) || 0,
        commission: calc.commission,
        allowance:  calc.allowance,
        deduction:  calc.deduction,
        // Computed
        gross:        calc.gross,
        stdRemuneration: calc.stdRemuneration,
        health:       calc.health,
        pension:      calc.pension,
        care:         calc.care,
        employment:   calc.employment,
        social:       calc.social,
        incomeTax:    calc.incomeTax,
        residentTax:  calc.residentTax,
        totalDed:     calc.totalDed,
        net:          calc.net,
      });
    } catch (e) {
      console.error('[payroll/monthly] save failed', e);
      setErr('保存に失敗: ' + (e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function clearRecord() {
    if (!existing) return;
    if (!confirm(`${monthLabel(month)}の${emp.name}の計算結果を削除しますか？`)) return;
    setBusy(true);
    try {
      await repos.payrollRecords.remove(`${month}_${emp.id}`);
    } catch (e) {
      console.error('[payroll/monthly] clear failed', e);
      setErr('削除に失敗: ' + (e.message || e));
    } finally {
      setBusy(false);
    }
  }

  return html`
    <div>
      <div class="card" style=${{ padding: 20, marginBottom: 14 }}>
        <div style=${{ display: 'flex', justifyContent: 'space-between',
                       alignItems: 'baseline', marginBottom: 14 }}>
          <div>
            <div style=${{ fontSize: 18, fontWeight: 700 }}>${emp.name}</div>
            <div style=${{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
              ${typeInfo.label} · ${monthLabel(month)}
            </div>
          </div>
          ${existing && html`
            <span style=${{
              fontSize: 11, padding: '3px 10px', borderRadius: 999,
              background: 'var(--success-soft)', color: 'var(--success)', fontWeight: 600,
            }}>✓ 計算済</span>
          `}
        </div>

        ${err && html`<div class="note note-err">${err}</div>`}

        <!-- 支給項目 -->
        <div style=${{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)',
                       marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          支給
        </div>

        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
          ${typeInfo.isSalary ? html`
            <${Field} label="基本給（月給）" value=${input.basePay}
                     onInput=${v => set('basePay', v)} disabled=${busy} money />
          ` : html`
            <${Field} label="労働時間 (h)" value=${input.hours}
                     onInput=${v => set('hours', v)} disabled=${busy} />
            <div>
              <div class="payroll-field-label">時給</div>
              <div style=${readOnlyStyle}>¥${(emp.hourlyWage || 0).toLocaleString()}</div>
            </div>
            <div>
              <div class="payroll-field-label">基本給計</div>
              <div style=${readOnlyStyle}><strong>${formatYen(calc.basePay)}</strong></div>
            </div>
          `}
          <${Field} label="歩合給" value=${input.commission}
                   onInput=${v => set('commission', v)} disabled=${busy} money />
          <${Field} label="諸手当" value=${input.allowance}
                   onInput=${v => set('allowance', v)} disabled=${busy} money />
          <${Field} label="その他控除（支給側）" value=${input.deduction}
                   onInput=${v => set('deduction', v)} disabled=${busy} money />
          <${Field} label="住民税（月額）" value=${input.residentTax}
                   onInput=${v => set('residentTax', v)} disabled=${busy} money />
        </div>

        <!-- 結果表示 -->
        <div style=${{
          padding: 16, background: 'var(--bg-alt)', borderRadius: 10,
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14,
        }}>
          <div>
            <div style=${{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700,
                           marginBottom: 6 }}>控除内訳</div>
            ${typeInfo.hasHealth && html`<${Line} label="健康保険" value=${calc.health} />`}
            ${typeInfo.hasPension && html`<${Line} label="厚生年金" value=${calc.pension} />`}
            ${typeInfo.hasHealth && emp.careEligible && html`<${Line} label="介護保険" value=${calc.care} />`}
            ${typeInfo.hasEmployment && html`<${Line} label="雇用保険" value=${calc.employment} />`}
            <${Line} label="所得税" value=${calc.incomeTax} />
            <${Line} label="住民税" value=${calc.residentTax} />
          </div>
          <div>
            <div style=${{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700,
                           marginBottom: 6 }}>集計</div>
            <${Line} label="総支給額" value=${calc.gross} bold />
            <${Line} label="控除合計" value=${-calc.totalDed} />
            <div style=${{
              borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8,
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            }}>
              <span style=${{ fontSize: 13, fontWeight: 700 }}>差引支給額</span>
              <span class="num" style=${{
                fontSize: 22, fontWeight: 800, color: 'var(--primary)',
              }}>${formatYen(calc.net)}</span>
            </div>
          </div>
        </div>
      </div>

      <div style=${{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div>
          ${existing && html`
            <button class="btn btn-danger" onClick=${clearRecord} disabled=${busy}>
              計算結果を削除
            </button>
          `}
        </div>
        <div style=${{ display: 'flex', gap: 8 }}>
          <button class="btn btn-ghost"
                  onClick=${() => onPreview({
                    month,
                    empId: emp.id,
                    empName: emp.name,
                    empType: emp.type,
                    ...calc,
                  })}
                  disabled=${busy}>
            👁 明細プレビュー
          </button>
          <button class="btn" onClick=${save} disabled=${busy}>
            ${busy ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  `;
}

function Field({ label, value, onInput, disabled, money }) {
  return html`
    <div>
      <div class="payroll-field-label">${label}</div>
      <input type="text" inputmode=${money ? 'numeric' : 'decimal'}
             value=${value ?? ''}
             onInput=${e => onInput(e.target.value.replace(/[^\d.-]/g, ''))}
             disabled=${disabled}
             style=${{
               width: '100%', padding: '9px 12px',
               border: '1px solid var(--border)', borderRadius: 8,
               background: '#f8f9fc', textAlign: 'right',
               fontFamily: 'var(--font-num)', fontSize: 13,
             }} />
    </div>
    <style>
      .payroll-field-label {
        font-size: 11px; color: var(--text-3); font-weight: 600; margin-bottom: 4px;
      }
    </style>
  `;
}

function Line({ label, value, bold }) {
  return html`
    <div style=${{
      display: 'flex', justifyContent: 'space-between', padding: '4px 0',
      fontSize: 12.5, fontWeight: bold ? 700 : 400,
      color: bold ? 'var(--text)' : 'var(--text-2)',
    }}>
      <span>${label}</span>
      <span class="num">${formatYen(value || 0)}</span>
    </div>
  `;
}

const readOnlyStyle = {
  padding: '9px 12px',
  background: '#f0f3fa',
  borderRadius: 8,
  fontSize: 13,
  textAlign: 'right',
  color: 'var(--text-2)',
  fontFamily: 'var(--font-num)',
};

// ---- Batch calculation modal ----------------------------------------------

function BatchModal({ employees, recordMap, month, rates, onClose }) {
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const [done, setDone] = useState(false);

  async function run() {
    setBusy(true);
    setLog([]);
    setDone(false);
    const lines = [];
    for (const emp of employees) {
      // Skip if already calculated, or compute from stored monthlySalary/hourlyWage
      const typeInfo = EMP_TYPE_MAP[emp.type] || EMP_TYPE_MAP.regular;
      try {
        const calc = calcMonthlyPaycheck(emp, {
          basePay: typeInfo.isSalary ? (emp.monthlySalary || 0) : 0,
          hours: typeInfo.isSalary ? 0 : (emp.baseHours || 0),
          residentTax: emp.residentTax || 0,
          rates: {
            healthRate:         rates.health?.[emp.prefecture],
            careRate:           rates.careRate,
            pensionRate:        rates.pensionRate,
            employmentEmployee: rates.employmentEmployee,
          },
        });
        const id = `${month}_${emp.id}`;
        await repos.payrollRecords.setId(id, {
          month, empId: emp.id, empName: emp.name, empType: emp.type,
          basePay: calc.basePay, hours: Number(emp.baseHours) || 0,
          commission: 0, allowance: 0, deduction: 0,
          gross: calc.gross, stdRemuneration: calc.stdRemuneration,
          health: calc.health, pension: calc.pension, care: calc.care,
          employment: calc.employment, social: calc.social,
          incomeTax: calc.incomeTax, residentTax: calc.residentTax,
          totalDed: calc.totalDed, net: calc.net,
        });
        lines.push(`✓ ${emp.name}: 差引 ${formatYen(calc.net)}`);
      } catch (e) {
        lines.push(`✗ ${emp.name}: ${e.message}`);
      }
      setLog([...lines]);
    }
    setBusy(false);
    setDone(true);
  }

  return html`
    <div style=${modalBackdrop} onClick=${e => e.target === e.currentTarget && !busy && onClose()}>
      <div style=${modalCard}>
        <div style=${modalHeader}>
          <div style=${{ fontWeight: 700, fontSize: 16 }}>
            📊 ${monthLabel(month)} 一括計算
          </div>
          <button class="btn btn-ghost" onClick=${onClose} disabled=${busy}>✕</button>
        </div>
        <div style=${{ padding: 20 }}>
          <div class="note note-info">
            従業員マスタの「月給」「時給 × 月平均労働時間」をベースに自動計算します。<br>
            歩合給・諸手当などは手動で個別調整してください。<br>
            <strong>既存の計算結果は上書きされます。</strong>
          </div>

          ${log.length > 0 && html`
            <div style=${{
              background: '#0f172a', color: '#e2e8f0', padding: 14,
              borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: 12,
              maxHeight: 300, overflow: 'auto', marginTop: 14,
            }}>
              ${log.map((l, i) => html`<div key=${i}>${l}</div>`)}
            </div>
          `}
        </div>
        <div style=${modalFooter}>
          <div></div>
          <div style=${{ display: 'flex', gap: 8 }}>
            ${done
              ? html`<button class="btn" onClick=${onClose}>閉じる</button>`
              : html`
                <button class="btn btn-ghost" onClick=${onClose} disabled=${busy}>キャンセル</button>
                <button class="btn" onClick=${run} disabled=${busy}>
                  ${busy ? '計算中...' : `${employees.length}名を計算`}
                </button>
              `}
          </div>
        </div>
      </div>
    </div>
  `;
}

// ---- Styles ---------------------------------------------------------------

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
};
