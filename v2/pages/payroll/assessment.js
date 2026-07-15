/* ============================================================
   NOVA Core v2 — Payroll / 算定基礎届
   April/May/June mean → determine new standard remuneration.
   Updates emp.stdRemuneration on apply.
   + 随時改定（月額変更届）の簡易チェック（アラートのみ・自動適用なし）
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useMemo } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection, where } from '../../store.js';
import { formatYen, asArray, toCsv, downloadTextFile, thisMonth, addMonths, monthLabel } from '../../shared.js';
import { getHealthStandard, findGrade, autoStdBase } from './calc.js';
import { EMP_TYPE_MAP } from './constants.js';

const html = htm.bind(h);

export function AssessmentTab() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [busyId, setBusyId] = useState(null);

  const employees = useCollection(repos.payrollEmployees);
  // Pull April + May + June records for the selected year
  const records = useCollection(
    repos.payrollRecords,
    () => [
      where('month', '>=', `${year}-04`),
      where('month', '<=', `${year}-06`),
    ],
    [year],
  );

  // 随時改定チェック用: 直近13ヶ月の給与レコード（変動月+3ヶ月の判定に十分な範囲）
  const revFrom = useMemo(() => addMonths(thisMonth(), -13), []);
  const recentRecords = useCollection(
    repos.payrollRecords,
    () => [where('month', '>=', revFrom)],
    [revFrom],
  );

  const empList = asArray(employees.data);
  const recByKey = useMemo(() => {
    const m = new Map();
    for (const r of asArray(records.data)) m.set(`${r.month}|${r.empId}`, r);
    return m;
  }, [records.data]);

  function rowFor(emp) {
    const m4 = recByKey.get(`${year}-04|${emp.id}`);
    const m5 = recByKey.get(`${year}-05|${emp.id}`);
    const m6 = recByKey.get(`${year}-06|${emp.id}`);
    const got = [m4, m5, m6].filter(Boolean);
    const avg = got.length > 0
      ? Math.round(got.reduce((s, r) => s + (Number(r.gross) || 0), 0) / got.length)
      : null;
    const newStd = avg != null ? getHealthStandard(avg) : null;
    // 現標準報酬の自動判定は autoStdBase（基本給+通勤手当）で3画面統一
    const curStd = emp.stdRemuneration || (autoStdBase(emp) > 0 ? getHealthStandard(autoStdBase(emp)) : 0);
    const diff = newStd != null ? newStd - curStd : 0;
    const gradeChange = newStd != null ? (findGrade(newStd) || 0) - (findGrade(curStd) || 0) : 0;
    return { m4, m5, m6, avg, newStd, curStd, diff, gradeChange };
  }

  async function apply(emp, newStd) {
    setBusyId(emp.id);
    try {
      await repos.payrollEmployees.upsert({ id: emp.id, stdRemuneration: newStd });
    } catch (e) {
      console.error('[payroll/assessment] apply failed', e);
      alert('更新に失敗: ' + (e.message || e));
    } finally {
      setBusyId(null);
    }
  }

  async function applyAll() {
    if (!confirm('全員の標準報酬月額を一括で更新します。よろしいですか？')) return;
    for (const emp of empList) {
      const r = rowFor(emp);
      if (r.newStd != null && r.newStd !== r.curStd) {
        await apply(emp, r.newStd);
      }
    }
  }

  function exportCsv() {
    const rows = [['氏名', '4月', '5月', '6月', '平均', '現標準報酬', '現等級', '新標準報酬', '新等級', '等級変動']];
    for (const emp of empList) {
      const r = rowFor(emp);
      rows.push([
        emp.name,
        r.m4?.gross || 0, r.m5?.gross || 0, r.m6?.gross || 0,
        r.avg || 0,
        r.curStd, findGrade(r.curStd) || '-',
        r.newStd || '-', r.newStd ? (findGrade(r.newStd) || '-') : '-',
        // 数値のまま渡す（'+2' のような文字列は csvCell の数式ガードで «'+2» になるため）
        r.gradeChange,
      ]);
    }
    downloadTextFile(toCsv(rows), `assessment_${year}.csv`);
  }

  return html`
    <div>
      <div style=${{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <button class="btn btn-ghost" onClick=${() => setYear(year - 1)}>◀</button>
        <div style=${{ fontSize: 16, fontWeight: 700, minWidth: 80, textAlign: 'center' }}>
          ${year}年 算定基礎届
        </div>
        <button class="btn btn-ghost" onClick=${() => setYear(year + 1)}>▶</button>
        <button class="btn btn-ghost" onClick=${() => setYear(thisYear)}>今年</button>

        <div style=${{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button class="btn btn-ghost" onClick=${exportCsv} disabled=${empList.length === 0}>
            📥 CSV出力
          </button>
          <button class="btn" onClick=${applyAll} disabled=${empList.length === 0}>
            ✓ 全員の等級を一括更新
          </button>
        </div>
      </div>

      <div class="note note-info">
        ${year}年 4月・5月・6月の月次給与（総支給）平均から標準報酬月額を算定します。<br/>
        日本年金機構への提出期限は毎年 <strong>7月10日</strong>。新しい等級は9月から適用されます。
      </div>

      ${empList.length === 0 ? html`
        <div class="note note-warn">従業員が未登録です。</div>
      ` : html`
        <div class="card" style=${{ padding: 0, overflow: 'auto' }}>
          <table style=${{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style=${{ background: 'var(--bg-alt)' }}>
                <th style=${th} rowspan="2">氏名</th>
                <th style=${{ ...th, textAlign: 'center' }} colspan="4">4〜6月 月次給与</th>
                <th style=${{ ...th, textAlign: 'right' }} rowspan="2">現標準報酬<br/>(等級)</th>
                <th style=${{ ...th, textAlign: 'right' }} rowspan="2">新標準報酬<br/>(等級)</th>
                <th style=${th} rowspan="2">変動</th>
                <th rowspan="2"></th>
              </tr>
              <tr style=${{ background: 'var(--bg-alt)' }}>
                <th style=${{ ...th, textAlign: 'right' }}>4月</th>
                <th style=${{ ...th, textAlign: 'right' }}>5月</th>
                <th style=${{ ...th, textAlign: 'right' }}>6月</th>
                <th style=${{ ...th, textAlign: 'right' }}>平均</th>
              </tr>
            </thead>
            <tbody>
              ${empList.map(emp => {
                const r = rowFor(emp);
                const canApply = r.newStd != null && r.newStd !== r.curStd;
                return html`
                  <tr key=${emp.id} style=${{ borderTop: '1px solid var(--border-2)' }}>
                    <td style=${td}>
                      <div style=${{ fontSize: 13, fontWeight: 600 }}>${emp.name}</div>
                      <div style=${{ fontSize: 10, color: 'var(--text-3)' }}>
                        ${EMP_TYPE_MAP[emp.type]?.label || emp.type}
                      </div>
                    </td>
                    <td class="num" style=${{ ...td, textAlign: 'right' }}>
                      ${r.m4 ? formatYen(r.m4.gross) : '-'}
                    </td>
                    <td class="num" style=${{ ...td, textAlign: 'right' }}>
                      ${r.m5 ? formatYen(r.m5.gross) : '-'}
                    </td>
                    <td class="num" style=${{ ...td, textAlign: 'right' }}>
                      ${r.m6 ? formatYen(r.m6.gross) : '-'}
                    </td>
                    <td class="num" style=${{ ...td, textAlign: 'right', fontWeight: 700 }}>
                      ${r.avg != null ? formatYen(r.avg) : '-'}
                    </td>
                    <td class="num" style=${{ ...td, textAlign: 'right' }}>
                      ${formatYen(r.curStd)}
                      <div style=${{ fontSize: 10, color: 'var(--text-3)' }}>(${findGrade(r.curStd) || '-'}級)</div>
                    </td>
                    <td class="num" style=${{ ...td, textAlign: 'right' }}>
                      ${r.newStd != null ? formatYen(r.newStd) : '-'}
                      ${r.newStd != null && html`<div style=${{ fontSize: 10, color: 'var(--text-3)' }}>
                        (${findGrade(r.newStd) || '-'}級)
                      </div>`}
                    </td>
                    <td style=${td}>
                      ${r.gradeChange !== 0 && html`<span style=${{
                        fontSize: 11, padding: '2px 8px', borderRadius: 999, fontWeight: 600,
                        background: r.gradeChange > 0 ? '#fef3c7' : '#dbeafe',
                        color:      r.gradeChange > 0 ? '#92400e' : '#1e40af',
                      }}>${r.gradeChange > 0 ? '+' : ''}${r.gradeChange}級</span>`}
                    </td>
                    <td style=${{ ...td, textAlign: 'right' }}>
                      ${canApply && html`
                        <button class="btn btn-ghost"
                                onClick=${() => apply(emp, r.newStd)}
                                disabled=${busyId === emp.id}>
                          ${busyId === emp.id ? '...' : '適用'}
                        </button>
                      `}
                    </td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </div>
      `}

      <${SuddenRevisionSection}
        employees=${empList}
        records=${asArray(recentRecords.data)}
        loading=${recentRecords.loading}
      />
    </div>
  `;
}

// ---- 随時改定（月額変更届）簡易チェック --------------------------------------
// 固定的賃金（basePay）が前月と変わった月を起点に、その月からの連続3ヶ月の
// 総支給平均で等級を算定し、現在の標準報酬と2等級以上の差があれば警告する。
// 支払基礎日数（17日以上）などの法定要件は判定しない簡易版。自動適用はしない。

/** 検知ロジック（純関数）。従業員ごとに最新の該当変動のみ返す。 */
export function detectSuddenRevisions(employees, records) {
  const byEmp = new Map();
  for (const r of records) {
    if (!r?.empId || !r?.month) continue;
    if (!byEmp.has(r.empId)) byEmp.set(r.empId, []);
    byEmp.get(r.empId).push(r);
  }
  const alerts = [];
  for (const emp of employees) {
    if (emp.archived) continue;
    const recs = (byEmp.get(emp.id) || [])
      .sort((a, b) => a.month.localeCompare(b.month));
    const byMonth = new Map(recs.map(r => [r.month, r]));
    let hit = null;
    for (let i = 1; i < recs.length; i++) {
      const prev = recs[i - 1];
      const cur = recs[i];
      // 連続する月のみ比較（欠落月をまたぐ比較は誤検知のもと）
      if (addMonths(prev.month, 1) !== cur.month) continue;
      // 固定的賃金（基本給）の変動があった月を起点にする
      if ((Number(cur.basePay) || 0) === (Number(prev.basePay) || 0)) continue;
      const m0 = cur.month;
      const r1 = byMonth.get(addMonths(m0, 1));
      const r2 = byMonth.get(addMonths(m0, 2));
      if (!r1 || !r2) continue;  // 変動後3ヶ月そろってから判定
      const avg = Math.round(
        ((Number(cur.gross) || 0) + (Number(r1.gross) || 0) + (Number(r2.gross) || 0)) / 3);
      const newStd = getHealthStandard(avg);
      const curStd = emp.stdRemuneration
        || (autoStdBase(emp) > 0 ? getHealthStandard(autoStdBase(emp)) : 0);
      const gradeDiff = (findGrade(newStd) || 0) - (findGrade(curStd) || 0);
      if (Math.abs(gradeDiff) >= 2) {
        // 改定月 = 変動月から数えて4ヶ月目（変更届の提出・新等級の適用開始）
        hit = { emp, changeMonth: m0, avg, newStd, curStd, gradeDiff,
                applyMonth: addMonths(m0, 3) };
      }
    }
    if (hit) alerts.push(hit);
  }
  return alerts;
}

function SuddenRevisionSection({ employees, records, loading }) {
  const alerts = useMemo(
    () => detectSuddenRevisions(employees, records),
    [employees, records]);

  return html`
    <div class="card" style=${{ padding: 20, marginTop: 18 }}>
      <div style=${{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
        🔔 随時改定（月額変更届）チェック
      </div>
      <div style=${{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>
        役員報酬や固定給を変更した月から連続3ヶ月の給与平均で等級を再算定し、
        現在の標準報酬と<strong>2等級以上</strong>の差がある場合に表示します
        （直近13ヶ月の給与レコードから判定・支払基礎日数は考慮しない簡易版）。
      </div>

      ${loading ? html`
        <div style=${{ color: 'var(--text-3)', fontSize: 13 }}>給与レコードを読込中...</div>
      ` : alerts.length === 0 ? html`
        <div class="note note-ok" style=${{ fontSize: 13 }}>
          現在、随時改定に該当しそうな従業員はいません（固定給の変動後3ヶ月が揃った時点で判定されます）。
        </div>
      ` : html`
        <div style=${{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          ${alerts.map(a => html`
            <div key=${a.emp.id} class="note note-warn" style=${{ margin: 0 }}>
              <strong>${a.emp.name}</strong>:
              随時改定の可能性 — ${monthLabel(a.changeMonth)}に固定給が変動、
              3ヶ月平均 ${formatYen(a.avg)} → 標準報酬 ${formatYen(a.newStd)}
              (${findGrade(a.newStd) || '-'}級) で現在の ${formatYen(a.curStd)}
              (${findGrade(a.curStd) || '-'}級) から
              <strong>${a.gradeDiff > 0 ? '+' : ''}${a.gradeDiff}等級</strong>。<br/>
              → <strong>${monthLabel(a.applyMonth)}に月額変更届を提出 →
              ${monthLabel(a.applyMonth)}分の保険料から新等級</strong>が適用される見込みです。
            </div>
          `)}
        </div>
      `}

      <div style=${{ fontSize: 11, color: 'var(--text-3)', marginTop: 10 }}>
        ※ このチェックは自動では何も変更しません（標準報酬の更新は上の算定基礎届か従業員マスタから）。<br/>
        ※ 支払基礎日数17日以上・固定的賃金の増減と平均の増減の方向一致などの法定要件は
        簡易化しているため、<strong>実際の届出の要否は必ず税理士に確認してください</strong>。
      </div>
    </div>
  `;
}

const th = {
  padding: '10px 14px', textAlign: 'left',
  color: 'var(--text-3)', fontWeight: 600, fontSize: 11,
  textTransform: 'uppercase', letterSpacing: '0.04em',
};
const td = { padding: '11px 14px' };
