/* ============================================================
   NOVA Core v2 — Payroll / Employee bank accounts + 全銀協 CSV
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useMemo } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection, where } from '../../store.js';
import { formatYen, thisMonth, monthLabel, addMonths, asArray } from '../../shared.js';

const html = htm.bind(h);

export function BanksTab() {
  const employees = useCollection(repos.payrollEmployees);
  const accounts  = useCollection(repos.payrollBankAccounts);

  const [editing, setEditing] = useState(null);
  const [exportMonth, setExportMonth] = useState(thisMonth());

  const empList = asArray(employees.data);
  const acctMap = new Map(asArray(accounts.data).map(a => [a.empId, a]));

  return html`
    <div>
      <${ExportSection} month=${exportMonth} onChangeMonth=${setExportMonth}
                      employees=${empList} acctMap=${acctMap} />

      <div class="card" style=${{ padding: 20 }}>
        <div style=${{ display: 'flex', justifyContent: 'space-between',
                       alignItems: 'center', marginBottom: 14 }}>
          <div style=${{ fontSize: 14, fontWeight: 700 }}>🏦 従業員別 振込口座</div>
          <div style=${{ fontSize: 11, color: 'var(--text-3)' }}>
            ${acctMap.size} / ${empList.length} 名登録済
          </div>
        </div>

        ${empList.length === 0 ? html`
          <div style=${{ color: 'var(--text-3)', fontSize: 13, padding: 16 }}>
            先に「従業員マスタ」から従業員を登録してください。
          </div>
        ` : html`
          <div style=${{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            ${empList.map(emp => {
              const acct = acctMap.get(emp.id);
              return html`
                <div key=${emp.id} style=${row}>
                  <div style=${{ flex: 1 }}>
                    <div style=${{ fontSize: 13, fontWeight: 600 }}>${emp.name}</div>
                    ${acct ? html`
                      <div style=${{ fontSize: 11, color: 'var(--text-3)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                        ${acct.bankName} ${acct.branchName}
                        (${acct.branchCode || '--'})
                        / ${acct.accountType} ${acct.accountNumber}
                      </div>
                      <div style=${{ fontSize: 11, color: 'var(--text-3)' }}>
                        ${acct.accountHolder}
                        ${acct.accountHolderKana && html`<span style=${{ marginLeft: 6, color: 'var(--text-4)' }}>(${acct.accountHolderKana})</span>`}
                      </div>
                    ` : html`
                      <div style=${{ fontSize: 11, color: 'var(--danger)', marginTop: 2 }}>
                        ⚠ 口座未登録
                      </div>
                    `}
                  </div>
                  <button class="btn btn-ghost" onClick=${() => setEditing({ emp, acct })}>
                    ${acct ? '編集' : '＋ 登録'}
                  </button>
                </div>
              `;
            })}
          </div>
        `}
      </div>

      ${editing && html`
        <${AccountModal} emp=${editing.emp} existing=${editing.acct}
                        onClose=${() => setEditing(null)} />
      `}
    </div>
  `;
}

// ---- Export section --------------------------------------------------------

function ExportSection({ month, onChangeMonth, employees, acctMap }) {
  const records = useCollection(
    repos.payrollRecords,
    () => [where('month', '==', month)],
    [month],
  );
  const recMap = new Map(asArray(records.data).map(r => [r.empId, r]));

  const pairs = employees
    .map(emp => ({
      emp,
      acct: acctMap.get(emp.id),
      rec:  recMap.get(emp.id),
    }))
    .filter(p => p.rec);

  const totalAmount = pairs.reduce((s, p) => s + (p.rec?.net || 0), 0);
  const missingAcct = pairs.filter(p => !p.acct);

  function exportCsv() {
    if (missingAcct.length > 0) {
      if (!confirm(`${missingAcct.length}名の口座情報が未登録です。該当者を除外して出力しますか？`)) return;
    }
    const eligible = pairs.filter(p => p.acct);
    if (eligible.length === 0) {
      alert('振込対象がありません');
      return;
    }

    // 簡易 CSV フォーマット (全銀協フォーマットは固定長テキストだが、実用的なCSV出力として)
    // 参考: 日付 / 銀行名 / 支店名 / 支店コード / 口座種別(1:普通 2:当座) / 口座番号 / 名義カナ / 金額
    const header = ['振込日', '銀行名', '支店名', '支店コード', '種別', '口座番号', '名義（カナ）', '金額'];
    const lines = [header.join(',')];
    for (const { acct, rec } of eligible) {
      lines.push([
        month + '-25',  // 25日振込と仮定、実運用では可変に
        acct.bankName || '',
        acct.branchName || '',
        acct.branchCode || '',
        acct.accountType === '当座' ? '2' : '1',
        (acct.accountNumber || '').padStart(7, '0'),
        (acct.accountHolderKana || acct.accountHolder || '').replace(/,/g, ''),
        rec.net || 0,
      ].join(','));
    }
    const bom = '\uFEFF';
    const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `salary_transfer_${month}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 0);
  }

  return html`
    <div class="card" style=${{ padding: 20, marginBottom: 18 }}>
      <div style=${{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>📥 振込データ出力</div>

      <div style=${{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button class="btn btn-ghost" onClick=${() => onChangeMonth(addMonths(month, -1))}>◀</button>
        <div style=${{ fontSize: 15, fontWeight: 700, minWidth: 100, textAlign: 'center' }}>
          ${monthLabel(month)}
        </div>
        <button class="btn btn-ghost" onClick=${() => onChangeMonth(addMonths(month, 1))}>▶</button>
      </div>

      <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
        <div style=${stat}>
          <div style=${statLabel}>対象人数</div>
          <div style=${statValue}>${pairs.length} 名</div>
        </div>
        <div style=${stat}>
          <div style=${statLabel}>振込額合計</div>
          <div style=${{ ...statValue, color: 'var(--primary)' }}>${formatYen(totalAmount)}</div>
        </div>
        <div style=${stat}>
          <div style=${statLabel}>口座未登録</div>
          <div style=${{
            ...statValue,
            color: missingAcct.length > 0 ? 'var(--danger)' : 'var(--text-3)',
          }}>${missingAcct.length} 名</div>
        </div>
      </div>

      ${missingAcct.length > 0 && html`
        <div class="note note-warn">
          以下の従業員の口座情報が未登録です:
          <strong>${missingAcct.map(p => p.emp.name).join('、')}</strong>
        </div>
      `}

      <button class="btn" onClick=${exportCsv} disabled=${pairs.length === 0}>
        📥 振込CSV を出力
      </button>
    </div>
  `;
}

// ---- Account modal ---------------------------------------------------------

const EMPTY = {
  bankName: '',
  branchName: '',
  branchCode: '',
  accountType: '普通',
  accountNumber: '',
  accountHolder: '',
  accountHolderKana: '',
};

function AccountModal({ emp, existing, onClose }) {
  const [form, setForm] = useState({ ...EMPTY, ...existing, accountHolder: existing?.accountHolder || emp.name });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function save() {
    setErr(null);
    if (!form.bankName.trim() || !form.accountNumber.trim()) {
      setErr('銀行名と口座番号は必須です');
      return;
    }
    setBusy(true);
    try {
      await repos.payrollBankAccounts.setId(emp.id, {
        empId: emp.id,
        bankName: form.bankName.trim(),
        branchName: form.branchName.trim(),
        branchCode: form.branchCode.trim(),
        accountType: form.accountType,
        accountNumber: form.accountNumber.trim(),
        accountHolder: form.accountHolder.trim(),
        accountHolderKana: form.accountHolderKana.trim(),
      }, { merge: true });
      onClose();
    } catch (e) {
      console.error('[payroll/banks] save failed', e);
      setErr('保存に失敗: ' + (e.message || e));
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    if (!confirm('この口座情報を削除しますか？')) return;
    setBusy(true);
    try {
      await repos.payrollBankAccounts.remove(emp.id);
      onClose();
    } catch (e) {
      setErr('削除に失敗: ' + (e.message || e));
      setBusy(false);
    }
  }

  return html`
    <div style=${modalBackdrop} onClick=${e => e.target === e.currentTarget && onClose()}>
      <div style=${modalCard}>
        <div style=${modalHeader}>
          <div style=${{ fontWeight: 700, fontSize: 16 }}>
            🏦 ${emp.name} の振込口座
          </div>
          <button class="btn btn-ghost" onClick=${onClose} disabled=${busy}>✕</button>
        </div>
        <div style=${{ padding: 20, display: 'grid', gap: 12 }}>
          ${err && html`<div class="note note-err">${err}</div>`}
          <div style=${{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <div class="field">
              <label>銀行名 *</label>
              <input type="text" value=${form.bankName}
                     onInput=${e => set('bankName', e.target.value)} disabled=${busy} />
            </div>
            <div class="field">
              <label>支店コード</label>
              <input type="text" value=${form.branchCode}
                     onInput=${e => set('branchCode', e.target.value)} disabled=${busy}
                     style=${{ fontFamily: 'var(--font-mono)' }} />
            </div>
          </div>
          <div class="field">
            <label>支店名</label>
            <input type="text" value=${form.branchName}
                   onInput=${e => set('branchName', e.target.value)} disabled=${busy} />
          </div>
          <div style=${{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10 }}>
            <div class="field">
              <label>口座種別</label>
              <select value=${form.accountType} onChange=${e => set('accountType', e.target.value)}
                      disabled=${busy} style=${selectStyle}>
                <option value="普通">普通</option>
                <option value="当座">当座</option>
              </select>
            </div>
            <div class="field">
              <label>口座番号 *</label>
              <input type="text" value=${form.accountNumber}
                     onInput=${e => set('accountNumber', e.target.value)} disabled=${busy}
                     style=${{ fontFamily: 'var(--font-mono)' }} placeholder="1234567" />
            </div>
          </div>
          <div class="field">
            <label>口座名義</label>
            <input type="text" value=${form.accountHolder}
                   onInput=${e => set('accountHolder', e.target.value)} disabled=${busy} />
          </div>
          <div class="field">
            <label>口座名義（カナ）</label>
            <input type="text" value=${form.accountHolderKana}
                   onInput=${e => set('accountHolderKana', e.target.value)} disabled=${busy}
                   placeholder="例: ﾔﾏﾀﾞ ﾀﾛｳ" />
          </div>
        </div>
        <div style=${modalFooter}>
          <div>
            ${existing && html`
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

const row = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '11px 14px', borderRadius: 10,
  background: 'var(--bg-alt)',
};
const stat = {
  padding: 12, borderRadius: 10, background: 'var(--bg-alt)',
};
const statLabel = {
  fontSize: 10, color: 'var(--text-3)', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4,
};
const statValue = { fontSize: 16, fontWeight: 700 };
const selectStyle = {
  width: '100%', padding: '10px 12px',
  border: '1px solid var(--border)', borderRadius: 8,
  background: '#f8f9fc', fontFamily: 'inherit', fontSize: 14,
};
const modalBackdrop = {
  position: 'fixed', inset: 0, background: 'rgba(12,12,20,0.5)',
  backdropFilter: 'blur(6px)', zIndex: 9999,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const modalCard = {
  background: 'var(--surface)', borderRadius: 18,
  maxWidth: 560, width: '100%', maxHeight: '90vh', overflow: 'auto',
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
