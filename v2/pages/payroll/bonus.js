/* ============================================================
   NOVA Core v2 — Payroll / Bonus calculation
   Tax rate based on prev-month taxable pay (excl. non-taxable
   commute) minus social insurance, from the latest monthly
   record strictly before the bonus month.
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useMemo } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection, useDoc, where, orderBy } from '../../store.js';
import { formatYen, thisMonth, monthLabel, addMonths, asArray } from '../../shared.js';
import { EMP_TYPE_MAP } from './constants.js';
import { calcBonusPaycheck, getRatesFor } from './calc.js';
import { PayslipOverlay } from './payslip.js';

const html = htm.bind(h);

// ---- 前月給与の税率基礎額（テスト用に export）-------------------------------

/**
 * 月次レコードから賞与税率決定用の
 * 「前月の社会保険料等控除後の給与等の金額」を求める。
 * rec.taxable = 総支給 − 非課税通勤手当 − 社保本人負担（＝控除後）なのでそのまま使う。
 * taxable が無い旧データは gross − 非課税通勤手当 − 社保 で代替。
 */
export function prevMonthTaxBasis(rec) {
  if (!rec) return 0;
  if (rec.taxable != null) return Math.max(0, Number(rec.taxable) || 0);
  return Math.max(0,
    (Number(rec.gross) || 0)
    - (Number(rec.commuteNonTaxable) || 0)
    - (Number(rec.social) || 0));
}

/**
 * 賞与対象月（bonusMonth）より前の月のうち最新の月次レコードを従業員ごとに選ぶ。
 * @param records 月次レコード配列（month 降順ソート済みでなくてもよい）
 */
export function pickPrevMonthRecords(records, bonusMonth) {
  const m = new Map();
  for (const r of records || []) {
    if (!r || !r.month || !bonusMonth || r.month >= bonusMonth) continue;
    const cur = m.get(r.empId);
    if (!cur || r.month > cur.month) m.set(r.empId, r);
  }
  return m;
}

export function BonusTab() {
  const [month, setMonth] = useState(thisMonth());
  const [selectedEmpId, setSelectedEmpId] = useState(null);
  const [preview, setPreview] = useState(null);

  const employees = useCollection(repos.payrollEmployees);
  const bonuses   = useCollection(
    repos.payrollBonus,
    () => [where('month', '==', month)],
    [month],
  );

  // For tax rate calculation we need each employee's recent monthly record
  // （賞与対象月より前の月のみ購読。全件購読を避ける）
  const recentMonthly = useCollection(
    repos.payrollRecords,
    () => [where('month', '<', month), orderBy('month', 'desc')],
    [month],
  );

  const ratesHistory = useCollection(repos.payrollRates);
  const healthRatesQ = useDoc(repos.settings, 'payroll_health_rates');
  const empRatesQ    = useDoc(repos.settings, 'payroll_employment_rates');
  const otherRatesQ  = useDoc(repos.settings, 'payroll_other_rates');

  const rates = useMemo(() => getRatesFor(month, asArray(ratesHistory.data), {
    health: healthRatesQ.data?.rates,
    employmentEmployee: empRatesQ.data?.employee,
    care:    otherRatesQ.data?.care,
    pension: otherRatesQ.data?.pension,
  }), [month, ratesHistory.data, healthRatesQ.data, empRatesQ.data, otherRatesQ.data]);

  const empList = asArray(employees.data).filter(e => !e.archived);
  const bonusMap = new Map(asArray(bonuses.data).map(b => [b.empId, b]));
  // 賞与対象月より前の月のうち最新の月次レコード（税率決定の「前月給与」）
  const prevByEmp = useMemo(
    () => pickPrevMonthRecords(asArray(recentMonthly.data), month),
    [recentMonthly.data, month],
  );

  const selectedEmp = empList.find(e => e.id === selectedEmpId);

  return html`
    <div>
      <div style=${{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <button class="btn btn-ghost" onClick=${() => setMonth(addMonths(month, -1))}>◀</button>
        <div style=${{ fontSize: 16, fontWeight: 700, minWidth: 140, textAlign: 'center' }}>
          ${monthLabel(month)} 賞与計算
        </div>
        <button class="btn btn-ghost" onClick=${() => setMonth(addMonths(month, 1))}>▶</button>
        <button class="btn btn-ghost" onClick=${() => setMonth(thisMonth())}>今月</button>

        <div style=${{ marginLeft: 'auto' }}>
          <button class="btn btn-ghost"
                  onClick=${() => {
                    const all = [...bonusMap.values()];
                    if (all.length === 0) { alert('まだ計算された賞与がありません'); return; }
                    setPreview({ records: all, kind: 'bonus' });
                  }}
                  disabled=${bonusMap.size === 0}>
            🖨 全員の明細を印刷
          </button>
        </div>
      </div>

      ${rates.source === 'default' && html`
        <div class="note note-warn" style=${{ marginBottom: 12 }}>
          ⚠ 料率履歴が未設定のため既定値（令和8年度）で計算しています。設定→給与料率でプリセットを適用してください。
        </div>
      `}

      ${empList.length === 0 ? html`
        <div class="note note-warn">
          従業員が未登録です。「従業員マスタ」タブから追加してください。
        </div>
      ` : html`
        <div style=${{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, alignItems: 'start' }}>
          <${EmpSelector}
            employees=${empList}
            bonusMap=${bonusMap}
            selectedId=${selectedEmpId}
            onSelect=${setSelectedEmpId}
          />
          <div>
            ${(bonuses.loading || recentMonthly.loading) ? html`
              <div class="card" style=${{ padding: '40px', textAlign: 'center', color: 'var(--text-3)' }}>
                ${monthLabel(month)} の賞与データを読込中...
              </div>
            ` : selectedEmp ? html`
              <${BonusPanel}
                key=${selectedEmp.id + '|' + month}
                emp=${selectedEmp}
                month=${month}
                rates=${rates}
                existing=${bonusMap.get(selectedEmp.id)}
                recentRec=${prevByEmp.get(selectedEmp.id)}
                onPreview=${(rec) => setPreview({ records: [rec], kind: 'bonus' })}
              />
            ` : html`
              <div class="card" style=${{ padding: '40px', textAlign: 'center', color: 'var(--text-3)' }}>
                左側から従業員を選択してください
              </div>
            `}
          </div>
        </div>
      `}

      ${preview && html`
        <${PayslipOverlay}
          records=${preview.records.map(r => ({ ...r, month: r.month || month }))}
          kind=${preview.kind}
          onClose=${() => setPreview(null)}
        />
      `}
    </div>
  `;
}

function EmpSelector({ employees, bonusMap, selectedId, onSelect }) {
  return html`
    <div class="card" style=${{ padding: 0, overflow: 'hidden' }}>
      <div style=${{
        padding: '10px 14px', fontSize: 12, fontWeight: 700, color: 'var(--text-3)',
        background: 'var(--bg-alt)', textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>従業員 (${employees.length}名)</div>
      ${employees.map(e => {
        const bonus = bonusMap.get(e.id);
        const done = !!bonus;
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
                             color: active ? 'var(--primary)' : 'var(--text)' }}>${e.name}</div>
              ${done && html`<span style=${{
                fontSize: 10, padding: '1px 6px', borderRadius: 999,
                background: 'var(--success-soft)', color: 'var(--success)', fontWeight: 600,
              }}>✓ 済</span>`}
            </div>
            <div style=${{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
              ${type.label} · ${done ? formatYen(bonus.net) : '未計算'}
            </div>
          </div>
        `;
      })}
    </div>
  `;
}

function BonusPanel({ emp, month, rates, existing, recentRec, onPreview }) {
  const typeInfo = EMP_TYPE_MAP[emp.type] || EMP_TYPE_MAP.regular;
  const [amount, setAmount] = useState(() => existing?.amount ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // 前月の「社会保険料等控除後の給与等の金額」— 賞与税率の決定に使用。
  // 非課税通勤手当を除いた課税支給額から社保を引いた金額（= rec.taxable）。
  const prevAfterSocial = useMemo(() => prevMonthTaxBasis(recentRec), [recentRec]);

  const calc = useMemo(() => calcBonusPaycheck(emp, {
    month,
    amount: Number(amount) || 0,
    prevMonthAfterSocial: prevAfterSocial,
    hasPrevRecord: !!recentRec,  // 前月給与なし → 特殊計算（所得税法186条）
    rates,
  }), [emp, month, amount, prevAfterSocial, recentRec, rates]);

  async function save() {
    setErr(null);
    if (!Number(amount) || Number(amount) <= 0) { setErr('賞与額を入力してください'); return; }
    setBusy(true);
    try {
      const id = `${month}_${emp.id}`;
      await repos.payrollBonus.setId(id, {
        month, empId: emp.id, empName: emp.name, empType: emp.type,
        amount: calc.amount,
        health: calc.health, pension: calc.pension, care: calc.care,
        childSupport: calc.childSupport,
        employment: calc.employment, social: calc.social,
        incomeTax: calc.incomeTax, totalDed: calc.totalDed, net: calc.net,
        prevAfterSocial,
        // 特殊計算の種別: null=率方式 / 'no-prev'=前月給与なし / 'over-10x'=前月給与の10倍超
        specialCalc: calc.specialCalc ?? null,
        // 監査用: 料率の解決元と計算時の状態
        ratesSource: rates.source ?? null,
        ratesEffectiveDate: rates.effectiveDate ?? null,
        age: calc.age ?? null,
        insuranceNotes: calc.insuranceNotes || '',
        onLeave: !!calc.onLeave,
      });
    } catch (e) {
      console.error('[payroll/bonus] save failed', e);
      setErr('保存に失敗: ' + (e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function clearRec() {
    if (!existing) return;
    if (!confirm(`${monthLabel(month)}の${emp.name}の賞与計算を削除しますか？`)) return;
    setBusy(true);
    try {
      await repos.payrollBonus.remove(`${month}_${emp.id}`);
    } catch (e) {
      setErr('削除に失敗: ' + (e.message || e));
    } finally { setBusy(false); }
  }

  return html`
    <div>
      <div class="card" style=${{ padding: 20, marginBottom: 14 }}>
        <div style=${{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style=${{ fontSize: 18, fontWeight: 700 }}>${emp.name}</div>
            <div style=${{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
              ${typeInfo.label} · ${monthLabel(month)}
            </div>
          </div>
          ${existing && html`<span style=${{
            fontSize: 11, padding: '3px 10px', borderRadius: 999,
            background: 'var(--success-soft)', color: 'var(--success)', fontWeight: 600,
          }}>✓ 計算済</span>`}
        </div>

        ${err && html`<div class="note note-err">${err}</div>`}

        ${(calc.insuranceNotes || calc.onLeave) && html`
          <div class="note note-warn" style=${{ marginBottom: 12 }}>
            ${calc.onLeave ? '産休・育休中: 社会保険料を免除しています。 ' : ''}${calc.insuranceNotes}
          </div>
        `}

        <div style=${{ marginBottom: 14 }}>
          <label style=${{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600 }}>
            賞与額（税込）
          </label>
          <input type="text" inputmode="numeric" value=${amount}
                 onInput=${e => setAmount(e.target.value.replace(/[^\d.-]/g, ''))}
                 disabled=${busy}
                 style=${{
                   width: '100%', padding: '12px 16px', marginTop: 6,
                   border: '1px solid var(--border)', borderRadius: 10,
                   background: '#f8f9fc', fontSize: 18, fontFamily: 'var(--font-num)',
                   textAlign: 'right', fontWeight: 700,
                 }}
                 placeholder="0" />
        </div>

        <div style=${{
          padding: 14, background: 'var(--primary-soft)', borderRadius: 10,
          marginBottom: 14, fontSize: 12,
        }}>
          <strong>参考: 前月給与（社保控除後）</strong>
          <span class="num" style=${{ marginLeft: 8, fontWeight: 700 }}>
            ${recentRec ? formatYen(prevAfterSocial) : 'なし'}
          </span>
          ${!recentRec && html`<span style=${{ marginLeft: 8, color: 'var(--danger)' }}>
            前月給与なし → 特殊計算（(賞与−社保)÷6 を月額表に適用 ×6）
          </span>`}
          ${recentRec ? html`
            <div style=${{ marginTop: 4, fontSize: 11, color: 'var(--text-3)' }}>
              この金額と扶養人数（${emp.dependents || 0}人）で賞与所得税率が決まります。
              ${recentRec.month !== addMonths(month, -1) && html`<br/>
                ※直近の月次レコード（${monthLabel(recentRec.month)}）を「前月給与」とみなして税率を判定しています。
              `}
              ${calc.specialCalc === 'over-10x' && html`
                <div style=${{ marginTop: 4, color: 'var(--danger)', fontWeight: 600 }}>
                  賞与（社保控除後）が前月給与（社保控除後）の10倍を超えるため、率方式ではなく
                  特殊計算（所得税法186条・国税庁タックスアンサーNo.2523）を適用:
                  税額 = ( 月額表税額((賞与−社保)÷6＋前月給与) − 月額表税額(前月給与) ) × 6。
                  ※賞与の計算期間が6ヶ月超の場合は ÷12×12 ですが、本システムは6ヶ月以下を前提とします。
                </div>
              `}
            </div>
          ` : html`
            <div style=${{ marginTop: 4, fontSize: 11, color: 'var(--text-3)' }}>
              前月中に給与の支払がない場合の本則（所得税法186条）: (賞与−社保)÷6 を
              月額表（甲欄・扶養${emp.dependents || 0}人）に当てた税額 × 6 で源泉徴収します。
              ※賞与の計算期間が6ヶ月超の場合は ÷12×12 ですが、本システムは6ヶ月以下を前提とします。
            </div>
          `}
        </div>

        <div style=${{
          padding: 16, background: 'var(--bg-alt)', borderRadius: 10,
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14,
        }}>
          <div>
            <div style=${{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700, marginBottom: 6 }}>控除内訳</div>
            ${typeInfo.hasHealth && html`<${Line} label="健康保険" value=${calc.health} />`}
            ${typeInfo.hasPension && html`<${Line} label="厚生年金" value=${calc.pension} />`}
            ${calc.care > 0 && html`<${Line} label="介護保険" value=${calc.care} />`}
            ${calc.childSupport > 0 && html`<${Line} label="子育て支援金" value=${calc.childSupport} />`}
            ${typeInfo.hasEmployment && html`<${Line} label="雇用保険" value=${calc.employment} />`}
            <${Line} label="所得税" value=${calc.incomeTax} />
          </div>
          <div>
            <div style=${{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700, marginBottom: 6 }}>集計</div>
            <${Line} label="賞与額" value=${calc.amount} bold />
            <${Line} label="控除合計" value=${-calc.totalDed} />
            <div style=${{
              borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8,
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            }}>
              <span style=${{ fontSize: 13, fontWeight: 700 }}>差引支給額</span>
              <span class="num" style=${{ fontSize: 22, fontWeight: 800, color: 'var(--primary)' }}>
                ${formatYen(calc.net)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div style=${{ display: 'flex', justifyContent: 'space-between' }}>
        <div>
          ${existing && html`<button class="btn btn-danger" onClick=${clearRec} disabled=${busy}>削除</button>`}
        </div>
        <div style=${{ display: 'flex', gap: 8 }}>
          <button class="btn btn-ghost"
                  onClick=${() => onPreview({ month, empId: emp.id, empName: emp.name,
                                              empType: emp.type, ...calc })}
                  disabled=${busy || !Number(amount)}>
            👁 明細プレビュー
          </button>
          <button class="btn" onClick=${save} disabled=${busy || !Number(amount)}>
            ${busy ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
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
