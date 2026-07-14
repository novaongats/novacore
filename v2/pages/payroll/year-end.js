/* ============================================================
   NOVA Core v2 — Payroll / Year-end adjustment (年末調整)
   Annualize income, recompute tax, compare with withheld.

   税制パラメータは対象年で自動切替:
   - 〜2024年分: 2020年改正（基礎控除48万・給与所得控除最低55万）
   - 2025年分: 令和7年度税制改正（給与所得控除最低65万、
     基礎控除は合計所得金額に応じ95万〜58万）
   - 2026・2027年分: 令和8年度税制改正（令和7年12月26日閣議決定、
     令和8年12月1日施行・令和8年分以後適用）
     給与所得控除最低74万（本則69万+令和8・9年分特例5万）、
     基礎控除は合計所得489万以下104万 / 655万以下67万 / 2,350万以下62万
   - 2028年分以降: 特例終了（給与所得控除最低69万・基礎控除99万/62万）。
     物価連動の見直しが予定されているため公表され次第更新すること。
   給与所得控除は収入660万円未満につき所得税法別表第五
   「年末調整等のための給与所得控除後の給与等の金額の表」を
   算式で再現（収入÷4の千円未満切捨てを基準にした区分算式）。
   出典: 国税庁「令和７年度税制改正による所得税の基礎控除の見直し等について」
         https://www.nta.go.jp/users/gensen/2025kiso/
         国税庁「令和８年度税制改正による所得税の基礎控除の引上げ等について」
         https://www.nta.go.jp/users/gensen/2026kiso/index.htm
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
 * 給与所得控除後の給与等の金額（年末調整用・表引き相当）。
 * 収入660万円未満は所得税法別表第五「年末調整等のための給与所得控除後の
 * 給与等の金額の表」を算式で再現する（速算式の割合計算とは端数の出方が
 * 異なるため、年末調整では表引きが法定）:
 *   A = 収入 ÷ 4 の千円未満切捨て。表の4,000円刻み区分は A を基準にした算式。
 * 660万円以上は表の適用外のため速算式。
 */
function salaryIncomeAfterDeduction(y, year) {
  const yr = Number(year) || 0;
  if (y >= 6600000) {
    // 660万円以上: 表の適用外・速算式（全年分共通）
    const ded = y < 8500000 ? Math.round(y * 0.10 + 1100000) : 1950000;
    return Math.max(0, y - ded);
  }
  // A = 収入÷4 の千円未満切捨て（例: 1,701,000 → 425,000）
  const A = Math.floor(y / 4000) * 1000;
  if (yr <= 2024) {
    // 〜令和6年分（最低保障55万円）— 所得税法別表第五
    if (y <=  550999) return 0;
    if (y <= 1618999) return y - 550000;
    if (y <= 1619999) return 1069000;  // 固定額帯（別表第五）
    if (y <= 1621999) return 1070000;
    if (y <= 1623999) return 1072000;
    if (y <= 1627999) return 1074000;
    if (y <= 1799999) return A * 2.4 + 100000;
    if (y <= 3599999) return A * 2.8 -  80000;
    return A * 3.2 - 440000;
  }
  if (yr === 2025) {
    // 令和7年分（令和7年度改正: 最低保障65万円）
    // 収入190万円以下は一律「収入−65万円」となり固定額帯は消滅
    if (y <=  650999) return 0;
    if (y <= 1899999) return y - 650000;
    if (y <= 3599999) return A * 2.8 -  80000;
    return A * 3.2 - 440000;
  }
  if (yr <= 2027) {
    // 令和8・9年分（令和8年度改正: 最低保障74万円 = 本則69万+特例5万）
    // 収入220万円未満は一律74万円。2,190,000〜2,199,999円は固定額帯。
    if (y <=  740999) return 0;
    if (y <= 2189999) return y - 740000;
    if (y <= 2199999) return 1450000;  // 固定額帯（74万円ゾーンの上端）
    if (y <= 3599999) return A * 2.8 -  80000;
    return A * 3.2 - 440000;
  }
  // 2028年分（令和10年分）以降: 特例5万円が終了し本則69万円。
  // TODO: 令和8年度改正で創設された物価連動の見直しによる表の改定が
  //       公表され次第、この区分を正式な表に置き換えること（暫定計算）。
  if (y <= 690999) return 0;
  const banded = y <= 3599999 ? A * 2.8 - 80000 : A * 3.2 - 440000;
  return Math.min(y - 690000, Math.max(0, banded));
}

/**
 * 給与所得控除。
 * - 〜2024年分: 最低保障 55万円（2020年改正）
 * - 2025年分: 最低保障 65万円（令和7年度改正。収入190万円以下は一律65万円）
 * - 2026・2027年分: 最低保障 74万円（令和8年度改正: 本則69万+特例5万。
 *   収入220万円未満は一律74万円）
 * - 2028年分以降: 本則 69万円（物価連動見直しの公表待ち・暫定）
 * 660万円未満は「給与所得控除後の給与等の金額の表」（別表第五）方式、
 * 660万円以上は速算式。
 */
export function salaryIncomeDeduction(annualIncome, year) {
  const y = Math.max(0, Math.floor(Number(annualIncome) || 0));
  return y - salaryIncomeAfterDeduction(y, year);
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
 * - 2025年分（令和7年度改正）:
 *     132万円以下95万 / 336万円以下88万 / 489万円以下68万
 *     / 655万円以下63万 / 2,350万円以下58万、以降逓減
 * - 2026・2027年分（令和8年度改正: 本則58万→62万＋令和8・9年分限定の特例上乗せ）:
 *     合計所得489万円以下 → 104万円（62万+42万）
 *     489万円超655万円以下 → 67万円（62万+5万）
 *     655万円超2,350万円以下 → 62万円
 *     2,350万円超は従来どおり 48万/32万/16万/0円 に逓減
 *   ※令和7年度改正の95万〜63万の区分は令和8年分から本改正で置き換え
 * - 2028年分（令和10年分）以降: 特例終了。132万円以下99万円（62万+37万恒久）
 *   / 2,350万円以下62万円。
 *   TODO: 物価連動の見直し（令和8年度改正で創設）が公表され次第更新すること。
 * 出典: 国税庁「令和８年度税制改正による所得税の基礎控除の引上げ等について」
 *       https://www.nta.go.jp/users/gensen/2026kiso/index.htm
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
  if (y === 2025) {          // 令和7年分（令和7年度改正）
    if (i <= 1320000) return 950000;
    if (i <= 3360000) return 880000;
    if (i <= 4890000) return 680000;
    if (i <= 6550000) return 630000;
  } else if (y <= 2027) {    // 令和8・9年分（令和8年度改正の特例上乗せ）
    if (i <= 4890000) return 1040000;
    if (i <= 6550000) return 670000;
  } else {                   // 令和10年分以降（現行法ベースの暫定）
    if (i <= 1320000) return 990000;
  }
  if (i <= 23500000) return y === 2025 ? 580000 : 620000;
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
  const income   = Math.max(0, annualGross - salDed);  // 給与所得（下限0）
  const basic    = basicDeduction(income, year);
  const depDed   = dependentDeduction(dependents);
  // 課税給与所得金額: 1,000円未満切捨て（年末調整の法定端数処理）
  const taxable  = Math.floor(Math.max(0, income - annualSocial - basic - depDed) / 1000) * 1000;
  const baseTax  = progressiveIncomeTax(taxable);
  // 年調年税額 = 算出所得税額 × 102.1%（復興特別所得税込み）の100円未満切捨て
  // baseTax × 1021 は整数演算なので浮動小数点誤差なし
  const totalTax = Math.floor(baseTax * 1021 / 100000) * 100;
  // 復興特別所得税相当（100円未満切捨て後の差分）。極小の税額では
  // 切捨てで差分が負になり得るため表示用に0で下限（年税合計は影響なし）。
  const reconstructionTax = Math.max(0, totalTax - baseTax);
  return {
    salDed, income, basic, depDed,
    taxable, baseTax, reconstructionTax,
    totalTax,
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
        legacyMonths: 0,
        annualGross: 0,
        annualSocial: 0,
        annualWithheld: 0,
      });
    }
    for (const r of asArray(records.data)) {
      const row = m.get(r.empId);
      if (!row) continue;
      row.monthsCount  += 1;
      // 移行データ（commuteNonTaxable フィールドなし）は非課税通勤手当を
      // 分離できず課税扱いで過大計上になるため、件数を数えて画面に注記する。
      if (r.commuteNonTaxable == null) row.legacyMonths += 1;
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

      <div class="note note-warn">
        <strong>本計算は簡易版です</strong> — 扶養控除は一律38万円（特定扶養親族63万円・老人扶養親族・
        16歳未満の扶養親族の区別なし）。特定親族特別控除・配偶者控除／配偶者特別控除・
        生命保険料控除等の各種保険料控除・住宅ローン控除は未対応。
        給与収入は本システムで計算した月次給与・賞与のみを集計します。
        正式な年末調整は必ず税理士に確認してください。
      </div>

      <div class="note note-info">
        ${year}年の月次給与＋賞与を集計し、年間所得税を再計算します（非課税通勤手当は年収から除外）。<br/>
        源泉徴収済額との差額が「還付（−）」または「追徴（＋）」となり、通常 <strong>12月の給与</strong> で精算します。<br/>
        ※ 税制パラメータは対象年で自動切替 — 2025年分: 令和7年度改正（給与所得控除最低65万円・基礎控除95万〜58万円）／
        2026・2027年分: 令和8年度改正（給与所得控除最低74万円・基礎控除最大104万円。令和8年12月1日施行・年末調整で精算）。<br/>
        ※ 2028年分（令和10年分）以降は物価連動の見直しが予定されているため、公表され次第パラメータを更新します（現在は暫定値）。
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
        ${sum.legacyMonths > 0 && html`
          <div style=${{ fontSize: 10, color: '#d97706', fontWeight: 600, marginTop: 2 }}>
            ⚠ ${sum.legacyMonths}ヶ月分は移行データのため通勤手当が課税扱いで集計されています
          </div>
        `}
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
