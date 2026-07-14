/* ============================================================
   NOVA Core v2 — Payroll / Year-end adjustment (年末調整)
   Annualize income, recompute tax, compare with withheld.

   税制パラメータは対象年で自動切替:
   - 〜2024年分: 2020年改正（基礎控除48万・給与所得控除最低55万）
   - 2025年分〜: 令和7年度税制改正（給与所得控除最低65万、
     基礎控除は合計所得金額に応じ95万〜58万。88/68/63万の
     上乗せは令和7・8年分限定、2027年分以降は95万/58万の2段階）
   出典: 国税庁「令和７年度税制改正による所得税の基礎控除の
   見直し等について」 https://www.nta.go.jp/users/gensen/2025kiso/
   ※特定親族特別控除（19〜22歳）・生命保険料控除等は未対応。
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useMemo } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection, where } from '../../store.js';
import { formatYen, asArray, toCsv, downloadTextFile } from '../../shared.js';
import { EMP_TYPE_MAP } from './constants.js';

const html = htm.bind(h);

// ---- Tax calculation helpers（テスト用に export）---------------------------

/**
 * 給与所得控除。
 * - 〜2024年分: 最低保障 55万円（2020年改正）
 * - 2025年分〜: 最低保障 65万円（令和7年度改正。控除率の区分は不変のため、
 *   収入190万円以下は実質65万円が適用される）
 */
export function salaryIncomeDeduction(annualIncome, year) {
  const y = Math.max(0, annualIncome);
  const minDed = Number(year) >= 2025 ? 650000 : 550000;
  let ded;
  if      (y <= 1625000) ded = 550000;
  else if (y <= 1800000) ded = Math.round(y * 0.40 - 100000);
  else if (y <= 3600000) ded = Math.round(y * 0.30 +  80000);
  else if (y <= 6600000) ded = Math.round(y * 0.20 + 440000);
  else if (y <= 8500000) ded = Math.round(y * 0.10 + 1100000);
  else                   ded = 1950000;
  return Math.max(minDed, ded);
}

/** 所得税の累進計算 (基本税額) */
export function progressiveIncomeTax(taxableIncome) {
  const t = Math.max(0, taxableIncome);
  if (t <= 1950000)  return Math.round(t * 0.05);
  if (t <= 3300000)  return Math.round(t * 0.10 -   97500);
  if (t <= 6950000)  return Math.round(t * 0.20 -  427500);
  if (t <= 9000000)  return Math.round(t * 0.23 -  636000);
  if (t <= 18000000) return Math.round(t * 0.33 - 1536000);
  if (t <= 40000000) return Math.round(t * 0.40 - 2796000);
  return Math.round(t * 0.45 - 4796000);
}

/**
 * 基礎控除（合計所得金額に応じる）。
 * - 〜2024年分: 48万円（2400万円超は逓減）
 * - 2025年分〜（令和7年度改正）:
 *     132万円以下 → 95万円（恒久）
 *     132万円超336万円以下 → 88万円 ┐
 *     336万円超489万円以下 → 68万円 ├ 令和7・8年分限定の上乗せ
 *     489万円超655万円以下 → 63万円 ┘（2027年分以降は58万円）
 *     655万円超2350万円以下 → 58万円（恒久）
 *     2350万円超は従来どおり 48万/32万/16万/0円 に逓減
 */
export function basicDeduction(totalIncome, year) {
  const y = Number(year) || 0;
  const i = totalIncome;
  if (y <= 2024) {
    if (i <= 24000000) return 480000;
    if (i <= 24500000) return 320000;
    if (i <= 25000000) return 160000;
    return 0;
  }
  if (i <= 1320000) return 950000;
  if (y <= 2026) {  // 88/68/63万円の上乗せは令和7・8年分（2025・2026年分）限定
    if (i <= 3360000) return 880000;
    if (i <= 4890000) return 680000;
    if (i <= 6550000) return 630000;
  }
  if (i <= 23500000) return 580000;
  if (i <= 24000000) return 480000;
  if (i <= 24500000) return 320000;
  if (i <= 25000000) return 160000;
  return 0;
}

/** 扶養控除 (一般扶養親族) */
export function dependentDeduction(dependents) {
  return Math.max(0, Number(dependents) || 0) * 380000;
}

/**
 * 年間所得税額計算（簡易版）
 * @param annualGross 給与等の収入金額の年計（非課税通勤手当を除く・社保控除前）
 * @param year        年末調整の対象年（税制パラメータの切替に使用）
 * 生命保険料控除等は未対応。実運用で必要なら追加。
 */
export function calcAnnualTax(annualGross, annualSocial, dependents, year) {
  const salDed   = salaryIncomeDeduction(annualGross, year);
  const income   = annualGross - salDed;               // 給与所得
  const basic    = basicDeduction(income, year);
  const depDed   = dependentDeduction(dependents);
  const taxable  = Math.max(0, income - annualSocial - basic - depDed);
  const baseTax  = progressiveIncomeTax(taxable);
  const reconstructionTax = Math.round(baseTax * 0.021);  // 復興特別所得税
  return {
    salDed, income, basic, depDed,
    taxable, baseTax, reconstructionTax,
    totalTax: baseTax + reconstructionTax,
  };
}

// ---- Main component -------------------------------------------------------

export function YearEndTab() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear - (new Date().getMonth() < 10 ? 1 : 0));

  const employees = useCollection(repos.payrollEmployees);
  const records = useCollection(
    repos.payrollRecords,
    () => [
      where('month', '>=', year + '-01'),
      where('month', '<=', year + '-12'),
    ],
    [year],
  );
  const bonuses = useCollection(
    repos.payrollBonus,
    () => [
      where('month', '>=', year + '-01'),
      where('month', '<=', year + '-12'),
    ],
    [year],
  );

  const empList = asArray(employees.data);

  const summary = useMemo(() => {
    const m = new Map();
    for (const e of empList) {
      m.set(e.id, {
        emp: e,
        monthsCount: 0,
        annualGross: 0,
        annualSocial: 0,
        annualWithheld: 0,
      });
    }
    for (const r of asArray(records.data)) {
      const row = m.get(r.empId);
      if (!row) continue;
      row.monthsCount  += 1;
      // 「給与等の収入金額」= 課税支給額（非課税通勤手当を除く・社保控除前）。
      // r.taxable は社保控除後の金額なのでここでは使わない。
      row.annualGross  += Math.max(0, (Number(r.gross) || 0) - (Number(r.commuteNonTaxable) || 0));
      row.annualSocial += Number(r.social) || 0;
      row.annualWithheld += Number(r.incomeTax) || 0;
    }
    for (const b of asArray(bonuses.data)) {
      const row = m.get(b.empId);
      if (!row) continue;
      row.annualGross    += Number(b.amount) || 0;
      row.annualSocial   += Number(b.social) || 0;
      row.annualWithheld += Number(b.incomeTax) || 0;
    }
    for (const row of m.values()) {
      const calc = calcAnnualTax(row.annualGross, row.annualSocial, row.emp.dependents || 0, year);
      row.calc = calc;
      row.diff = calc.totalTax - row.annualWithheld;  // +: 追徴, -: 還付
    }
    return m;
  }, [empList, records.data, bonuses.data, year]);

  function exportCsv() {
    const rows = [['氏名', '年間収入（課税支給）', '社保計', '給与所得控除', '課税所得',
                   '基礎控除', '扶養控除', '課税対象', '算出年税', '復興特別', '年税合計',
                   '源泉徴収済', '差引（+追徴 / -還付）']];
    for (const emp of empList) {
      const s = summary.get(emp.id);
      if (!s) continue;
      rows.push([
        emp.name,
        s.annualGross, s.annualSocial,
        s.calc.salDed, s.calc.income,
        s.calc.basic, s.calc.depDed,
        s.calc.taxable, s.calc.baseTax, s.calc.reconstructionTax,
        s.calc.totalTax, s.annualWithheld,
        s.diff,
      ]);
    }
    downloadTextFile(toCsv(rows), `year_end_${year}.csv`);
  }

  return html`
    <div>
      <div style=${{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <button class="btn btn-ghost" onClick=${() => setYear(year - 1)}>◀</button>
        <div style=${{ fontSize: 16, fontWeight: 700, minWidth: 120, textAlign: 'center' }}>
          ${year}年 年末調整
        </div>
        <button class="btn btn-ghost" onClick=${() => setYear(year + 1)}>▶</button>

        <div style=${{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button class="btn btn-ghost" onClick=${exportCsv} disabled=${empList.length === 0}>
            📥 CSV出力
          </button>
        </div>
      </div>

      <div class="note note-info">
        ${year}年の月次給与＋賞与を集計し、年間所得税を再計算します（非課税通勤手当は年収から除外）。<br/>
        源泉徴収済額との差額が「還付（−）」または「追徴（＋）」となり、通常 <strong>12月の給与</strong> で精算します。<br/>
        ※ 税制パラメータは対象年で自動切替（2025年分〜は令和7年度改正: 給与所得控除最低65万円・基礎控除95万〜58万円）。<br/>
        ※ 生命保険料控除・地震保険料控除・住宅ローン控除・特定親族特別控除などは未対応。必要な場合は別途加味してください。
      </div>

      ${empList.length === 0 ? html`
        <div class="note note-warn">従業員が未登録です。</div>
      ` : html`
        <div class="card" style=${{ padding: 0, overflow: 'auto' }}>
          <table style=${{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style=${{ background: 'var(--bg-alt)' }}>
                <th style=${th}>従業員</th>
                <th style=${{ ...th, textAlign: 'right' }}>年間収入（課税）</th>
                <th style=${{ ...th, textAlign: 'right' }}>社保計</th>
                <th style=${{ ...th, textAlign: 'right' }}>給与所得</th>
                <th style=${{ ...th, textAlign: 'right' }}>課税所得</th>
                <th style=${{ ...th, textAlign: 'right' }}>年税（計算）</th>
                <th style=${{ ...th, textAlign: 'right' }}>源泉徴収</th>
                <th style=${{ ...th, textAlign: 'right' }}>過不足</th>
              </tr>
            </thead>
            <tbody>
              ${empList.map(emp => {
                const s = summary.get(emp.id);
                if (!s) return null;
                return html`
                  <${Row} key=${emp.id} emp=${emp} sum=${s} />
                `;
              })}
            </tbody>
          </table>
        </div>

        <${DetailCards} empList=${empList} summary=${summary} />
      `}
    </div>
  `;
}

function Row({ emp, sum }) {
  const diff = sum.diff;
  const refund = diff < 0;
  const type = EMP_TYPE_MAP[emp.type] || EMP_TYPE_MAP.regular;
  return html`
    <tr style=${{ borderTop: '1px solid var(--border-2)' }}>
      <td style=${td}>
        <div style=${{ fontSize: 13, fontWeight: 600 }}>${emp.name}</div>
        <div style=${{ fontSize: 10, color: 'var(--text-3)' }}>
          ${type.label} · ${sum.monthsCount}ヶ月分 · 扶養${emp.dependents || 0}人
        </div>
      </td>
      <td class="num" style=${{ ...td, textAlign: 'right' }}>${formatYen(sum.annualGross)}</td>
      <td class="num" style=${{ ...td, textAlign: 'right', color: 'var(--text-2)' }}>${formatYen(sum.annualSocial)}</td>
      <td class="num" style=${{ ...td, textAlign: 'right', color: 'var(--text-2)' }}>${formatYen(sum.calc.income)}</td>
      <td class="num" style=${{ ...td, textAlign: 'right', color: 'var(--text-2)' }}>${formatYen(sum.calc.taxable)}</td>
      <td class="num" style=${{ ...td, textAlign: 'right', fontWeight: 700 }}>${formatYen(sum.calc.totalTax)}</td>
      <td class="num" style=${{ ...td, textAlign: 'right' }}>${formatYen(sum.annualWithheld)}</td>
      <td class="num" style=${{
        ...td, textAlign: 'right', fontWeight: 800,
        color: refund ? 'var(--success)' : (diff > 0 ? 'var(--danger)' : 'var(--text-3)'),
      }}>
        ${diff === 0 ? '±0' : (diff > 0 ? '＋' : '−') + formatYen(Math.abs(diff)).replace('¥', '¥')}
        <div style=${{ fontSize: 10, fontWeight: 500, opacity: 0.8 }}>
          ${diff === 0 ? '過不足なし' : refund ? '還付' : '追徴'}
        </div>
      </td>
    </tr>
  `;
}

function DetailCards({ empList, summary }) {
  const [expandedId, setExpandedId] = useState(null);
  return html`
    <div style=${{ marginTop: 18 }}>
      <div style=${{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
        詳細内訳（クリックで展開）
      </div>
      <div style=${{ display: 'grid', gap: 6 }}>
        ${empList.map(emp => {
          const s = summary.get(emp.id);
          if (!s) return null;
          const open = expandedId === emp.id;
          return html`
            <div key=${emp.id} class="card" style=${{ padding: 0, overflow: 'hidden' }}>
              <div onClick=${() => setExpandedId(open ? null : emp.id)}
                   style=${{ padding: '11px 14px', cursor: 'pointer', display: 'flex',
                             justifyContent: 'space-between', alignItems: 'center' }}>
                <div style=${{ fontSize: 13, fontWeight: 600 }}>${emp.name}</div>
                <div style=${{ fontSize: 12, color: 'var(--text-3)' }}>
                  ${open ? '▲ 閉じる' : '▼ 詳細'}
                </div>
              </div>
              ${open && html`
                <div style=${{
                  padding: '14px 18px', borderTop: '1px solid var(--border-2)',
                  background: 'var(--bg-alt)',
                }}>
                  <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20, fontSize: 12 }}>
                    <div>
                      <${Kv} label="年間収入（課税支給）" value=${s.annualGross} />
                      <${Kv} label="給与所得控除" value=${-s.calc.salDed} />
                      <${Kv} label="給与所得金額" value=${s.calc.income} strong />
                    </div>
                    <div>
                      <${Kv} label="社会保険料控除" value=${-s.annualSocial} />
                      <${Kv} label="基礎控除" value=${-s.calc.basic} />
                      <${Kv} label="扶養控除" value=${-s.calc.depDed} />
                      <${Kv} label="課税所得" value=${s.calc.taxable} strong />
                    </div>
                  </div>
                  <div style=${{
                    marginTop: 14, paddingTop: 10,
                    borderTop: '1px solid var(--border)',
                    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, fontSize: 12,
                  }}>
                    <div><${Kv} label="算出所得税" value=${s.calc.baseTax} /></div>
                    <div><${Kv} label="復興特別(2.1%)" value=${s.calc.reconstructionTax} /></div>
                    <div><${Kv} label="年税合計" value=${s.calc.totalTax} strong /></div>
                  </div>
                </div>
              `}
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

function Kv({ label, value, strong }) {
  return html`
    <div style=${{
      display: 'flex', justifyContent: 'space-between', padding: '3px 0',
      fontWeight: strong ? 700 : 400,
    }}>
      <span style=${{ color: 'var(--text-3)' }}>${label}</span>
      <span class="num">${value === 0 ? '-' : formatYen(value)}</span>
    </div>
  `;
}

const th = {
  padding: '10px 14px', textAlign: 'left',
  color: 'var(--text-3)', fontWeight: 600, fontSize: 11,
  textTransform: 'uppercase', letterSpacing: '0.04em',
};
const td = { padding: '11px 14px' };
