/* ============================================================
   NOVA Core v2 — Cashbook / Ledger tab
   Manual expense entry + monthly ledger view.
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useEffect, useMemo, useRef } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection, where, orderBy } from '../../store.js';
import {
  dayjs, formatYen, today, thisMonth, monthLabel, shortDateLabel,
  addMonths, uid, sumBy, groupBy, asArray,
} from '../../shared.js';

const html = htm.bind(h);

// ---- Main tab --------------------------------------------------------------

export function LedgerTab() {
  const [month, setMonth] = useState(thisMonth());
  const [editing, setEditing] = useState(null);

  const monthStart = month + '-01';
  const monthEnd = dayjs(monthStart).add(1, 'month').format('YYYY-MM-DD');

  const entries = useCollection(
    repos.cashbook,
    () => [
      where('date', '>=', monthStart),
      where('date', '<',  monthEnd),
      orderBy('date', 'desc'),
    ],
    [month],
  );

  const accounts = useCollection(repos.cashbookAccounts);
  const depts    = useCollection(repos.cashbookDepts);

  const sortedAccounts = useMemo(
    () => [...asArray(accounts.data)].sort((a, b) => (a.order ?? 999) - (b.order ?? 999)),
    [accounts.data],
  );
  const sortedDepts = useMemo(
    () => [...asArray(depts.data)].sort((a, b) => (a.order ?? 999) - (b.order ?? 999)),
    [depts.data],
  );

  return html`
    <div>
      <${MonthBar} month=${month} onChange=${setMonth} />
      <${KpiRow} entries=${entries.data} />

      ${accounts.data.length === 0 && html`
        <div class="note note-warn" style=${{ marginBottom: 16 }}>
          勘定科目が未登録です。「マスタ」タブで科目を登録してください。
        </div>
      `}

      <${QuickAdd}
        accounts=${sortedAccounts}
        depts=${sortedDepts}
        disabled=${accounts.data.length === 0}
      />

      <${EntryList}
        loading=${entries.loading}
        error=${entries.error}
        entries=${entries.data}
        onEdit=${setEditing}
      />

      ${editing && html`
        <${EntryModal}
          initial=${editing}
          accounts=${sortedAccounts}
          depts=${sortedDepts}
          onClose=${() => setEditing(null)}
        />
      `}
    </div>
  `;
}

// ---- Month bar -------------------------------------------------------------

function MonthBar({ month, onChange }) {
  return html`
    <div style=${{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
      <button class="btn btn-ghost" onClick=${() => onChange(addMonths(month, -1))}>◀</button>
      <div style=${{ fontSize: 16, fontWeight: 700, minWidth: 120, textAlign: 'center' }}>
        ${monthLabel(month)}
      </div>
      <button class="btn btn-ghost" onClick=${() => onChange(addMonths(month, 1))}>▶</button>
      <button class="btn btn-ghost" onClick=${() => onChange(thisMonth())}
              style=${{ marginLeft: 8 }}>今月</button>
    </div>
  `;
}

// ---- KPI row ---------------------------------------------------------------

function KpiRow({ entries }) {
  const total  = sumBy(entries, e => e.amount);
  const std10  = sumBy(entries.filter(e => !e.reducedTax), e => e.amount);
  const red8   = sumBy(entries.filter(e =>  e.reducedTax), e => e.amount);
  const withInv = entries.filter(e =>  e.hasInvoice).length;
  const noInv   = entries.filter(e => !e.hasInvoice).length;

  return html`
    <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
      <${KpiCard} label="当月支出合計" value=${formatYen(total)} accent="danger" />
      <${KpiCard} label="10%対象"      value=${formatYen(std10)} />
      <${KpiCard} label="8%対象（軽減）" value=${formatYen(red8)} />
      <${KpiCard} label="インボイス"
                 value=${withInv + ' 件'}
                 sub=${'なし ' + noInv + ' 件'} />
    </div>
  `;
}

function KpiCard({ label, value, sub, accent }) {
  const colors = {
    primary: 'var(--primary)',
    success: 'var(--success)',
    danger:  'var(--danger)',
  };
  return html`
    <div class="card" style=${{ padding: 18 }}>
      <div style=${{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, marginBottom: 6,
                     textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        ${label}
      </div>
      <div class="num" style=${{
        fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em',
        color: colors[accent] || 'var(--text)',
      }}>${value}</div>
      ${sub && html`
        <div style=${{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>${sub}</div>
      `}
    </div>
  `;
}

// ---- Quick add form --------------------------------------------------------

function QuickAdd({ accounts, depts, disabled }) {
  const [date, setDate] = useState(today());
  const [vendor, setVendor] = useState('');
  const [account, setAccount] = useState('');
  const [dept, setDept] = useState('');
  const [amount, setAmount] = useState('');
  const [reducedTax, setReducedTax] = useState(false);
  const [hasInvoice, setHasInvoice] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [flash, setFlash] = useState(null);
  const vendorRef = useRef(null);

  // Keep defaults valid as masters change
  useEffect(() => {
    if (accounts.length && !accounts.find(a => a.name === account)) {
      setAccount(accounts[0].name);
    }
  }, [accounts]);

  async function save(e) {
    if (e) e.preventDefault();
    setErr(null);
    const amtNum = Number(String(amount).replace(/[^\d.-]/g, ''));
    if (!date) { setErr('日付は必須です'); return; }
    if (!vendor.trim()) { setErr('取引先は必須です'); return; }
    if (!account) { setErr('勘定科目を選択してください'); return; }
    if (!amtNum || amtNum <= 0) { setErr('金額は正の数値で入力してください'); return; }

    setBusy(true);
    try {
      await repos.cashbook.upsert({
        id: uid('cb_'),
        date,
        vendor: vendor.trim(),
        category: account,
        dept,
        amount: Math.round(amtNum),
        reducedTax,
        hasInvoice,
        invoiceNumber: hasInvoice ? invoiceNumber.trim() : '',
        memo: memo.trim(),
        source: 'manual',
      });
      setFlash(formatYen(amtNum) + ' を登録しました');
      setVendor('');
      setAmount('');
      setInvoiceNumber('');
      setMemo('');
      setTimeout(() => setFlash(null), 1800);
      vendorRef.current?.focus();
    } catch (e) {
      console.error('[cashbook] save failed', e);
      setErr('保存に失敗: ' + (e.message || e));
    } finally {
      setBusy(false);
    }
  }

  return html`
    <form class="card" style=${{ padding: 16, marginBottom: 16, opacity: disabled ? 0.5 : 1 }}
          onSubmit=${save}>
      <div style=${{ display: 'flex', alignItems: 'center',
                     justifyContent: 'space-between', marginBottom: 12 }}>
        <div style=${{ fontSize: 13, fontWeight: 700 }}>⚡ 経費を登録</div>
        ${flash && html`<div style=${{
          fontSize: 12, color: 'var(--success)', fontWeight: 600,
        }}>✓ ${flash}</div>`}
      </div>
      ${err && html`<div class="note note-err">${err}</div>`}

      <div style=${{
        display: 'grid',
        gridTemplateColumns: '140px 1fr 180px 140px',
        gap: 10, marginBottom: 10,
      }}>
        <input type="date" value=${date}
               onInput=${e => setDate(e.target.value)} disabled=${busy || disabled}
               style=${inputStyle} />
        <input type="text" placeholder="取引先" value=${vendor} ref=${vendorRef}
               onInput=${e => setVendor(e.target.value)} disabled=${busy || disabled}
               style=${inputStyle} />
        <select value=${account} onChange=${e => setAccount(e.target.value)}
                disabled=${busy || disabled} style=${inputStyle}>
          <option value="">-- 勘定科目 --</option>
          ${accounts.map(a => html`
            <option key=${a.id} value=${a.name}>${a.name}</option>
          `)}
        </select>
        <input type="text" inputmode="numeric" placeholder="金額" value=${amount}
               onInput=${e => setAmount(e.target.value)} disabled=${busy || disabled}
               style=${{ ...inputStyle, textAlign: 'right', fontFamily: 'var(--font-num)' }} />
      </div>

      <div style=${{
        display: 'grid',
        gridTemplateColumns: '180px 1fr auto auto auto',
        gap: 10, alignItems: 'center',
      }}>
        <select value=${dept} onChange=${e => setDept(e.target.value)}
                disabled=${busy || disabled} style=${inputStyle}>
          <option value="">-- 部門（任意）--</option>
          ${depts.map(d => html`
            <option key=${d.id} value=${d.name}>${d.name}</option>
          `)}
        </select>
        <input type="text" placeholder="メモ（任意）" value=${memo}
               onInput=${e => setMemo(e.target.value)} disabled=${busy || disabled}
               style=${inputStyle} />
        <label style=${checkLabel}>
          <input type="checkbox" checked=${reducedTax}
                 onChange=${e => setReducedTax(e.target.checked)} disabled=${busy || disabled} />
          軽減税率(8%)
        </label>
        <label style=${checkLabel}>
          <input type="checkbox" checked=${hasInvoice}
                 onChange=${e => setHasInvoice(e.target.checked)} disabled=${busy || disabled} />
          インボイス
        </label>
        <button type="submit" class="btn" disabled=${busy || disabled}
                style=${{ whiteSpace: 'nowrap' }}>
          ${busy ? '...' : '登録'}
        </button>
      </div>

      ${hasInvoice && html`
        <div style=${{ marginTop: 10 }}>
          <input type="text" placeholder="インボイス登録番号 (T+13桁)"
                 value=${invoiceNumber}
                 onInput=${e => setInvoiceNumber(e.target.value)} disabled=${busy || disabled}
                 style=${{ ...inputStyle, width: 300, fontFamily: 'var(--font-mono)' }} />
        </div>
      `}
    </form>
  `;
}

// ---- List ------------------------------------------------------------------

function EntryList({ loading, error, entries, onEdit }) {
  if (loading) return html`<div style=${{ color: 'var(--text-3)', padding: 20 }}>読込中...</div>`;
  if (error) return html`<div class="note note-err">読込エラー: ${error.message || String(error)}</div>`;

  if (entries.length === 0) {
    return html`
      <div class="card" style=${{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-3)' }}>
        <div style=${{ fontSize: 28, marginBottom: 10, opacity: .4 }}>📒</div>
        この月の出納データはまだありません
      </div>
    `;
  }

  const byDate = groupBy(entries, e => e.date);
  const dates = Array.from(byDate.keys()).sort().reverse();

  return html`
    <div>
      ${dates.map(d => html`
        <div key=${d} style=${{ marginBottom: 16 }}>
          <div style=${{
            fontSize: 12, fontWeight: 700, color: 'var(--text-3)',
            padding: '6px 2px',
          }}>
            ${shortDateLabel(d)}
            <span style=${{ marginLeft: 8, color: 'var(--text-4)', fontWeight: 400 }}>
              ${byDate.get(d).length}件 / ${formatYen(sumBy(byDate.get(d), e => e.amount))}
            </span>
          </div>
          <div class="card" style=${{ padding: 0, overflow: 'hidden' }}>
            ${byDate.get(d).map(e => html`
              <${EntryRow} key=${e.id} entry=${e} onEdit=${() => onEdit(e)} />
            `)}
          </div>
        </div>
      `)}
    </div>
  `;
}

function EntryRow({ entry, onEdit }) {
  const isLegacy = (entry.source || '').includes('legacy');
  const isAI = (entry.source || '').includes('ai');

  return html`
    <div style=${{
      display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px',
      borderBottom: '1px solid var(--border-2)',
    }}>
      <div style=${{ flex: 1, minWidth: 0 }}>
        <div style=${{ fontSize: 13, fontWeight: 600 }}>
          ${entry.vendor || '(取引先なし)'}
          ${isAI && html`<span style=${badge('#dbeafe', '#1e40af')}>AI</span>`}
          ${isLegacy && html`<span style=${badge('#fef3c7', '#92400e')}>legacy</span>`}
        </div>
        <div style=${{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
          <span>${entry.category || '未分類'}</span>
          ${entry.dept && html`<span style=${{ marginLeft: 8 }}>· ${entry.dept}</span>`}
          ${entry.memo && html`<span style=${{ marginLeft: 8 }}>· ${entry.memo}</span>`}
        </div>
      </div>
      <div style=${{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
        ${entry.reducedTax && html`<span style=${badge('#fef3c7', '#92400e')}>8%</span>`}
        ${entry.hasInvoice && html`<span style=${badge('#dcfce7', '#166534')}>✓ inv</span>`}
      </div>
      <div class="num" style=${{ fontWeight: 700, minWidth: 110, textAlign: 'right' }}>
        ${formatYen(entry.amount)}
      </div>
      <button class="btn btn-ghost" onClick=${onEdit}>編集</button>
    </div>
  `;
}

// ---- Edit modal ------------------------------------------------------------

function EntryModal({ initial, accounts, depts, onClose }) {
  const [form, setForm] = useState(() => ({
    date: initial.date || today(),
    vendor: initial.vendor || '',
    category: initial.category || '',
    dept: initial.dept || '',
    amount: String(initial.amount ?? ''),
    reducedTax: !!initial.reducedTax,
    hasInvoice: !!initial.hasInvoice,
    invoiceNumber: initial.invoiceNumber || '',
    memo: initial.memo || '',
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function save() {
    setErr(null);
    const amtNum = Number(String(form.amount).replace(/[^\d.-]/g, ''));
    if (!form.date || !form.vendor.trim() || !form.category || !amtNum || amtNum <= 0) {
      setErr('日付・取引先・勘定科目・金額（正数）は必須です');
      return;
    }
    setBusy(true);
    try {
      await repos.cashbook.upsert({
        id: initial.id,
        date: form.date,
        vendor: form.vendor.trim(),
        category: form.category,
        dept: form.dept,
        amount: Math.round(amtNum),
        reducedTax: form.reducedTax,
        hasInvoice: form.hasInvoice,
        invoiceNumber: form.hasInvoice ? form.invoiceNumber.trim() : '',
        memo: form.memo.trim(),
        source: initial.source || 'manual',
      });
      onClose();
    } catch (e) {
      console.error('[cashbook] update failed', e);
      setErr('保存に失敗: ' + (e.message || e));
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm('このレコードを削除しますか？')) return;
    setBusy(true);
    try {
      await repos.cashbook.remove(initial.id);
      onClose();
    } catch (e) {
      console.error('[cashbook] delete failed', e);
      setErr('削除に失敗: ' + (e.message || e));
      setBusy(false);
    }
  }

  return html`
    <div style=${modalBackdrop} onClick=${e => e.target === e.currentTarget && onClose()}>
      <div style=${modalCard}>
        <div style=${modalHeader}>
          <div style=${{ fontWeight: 700, fontSize: 16 }}>経費レコード編集</div>
          <button class="btn btn-ghost" onClick=${onClose} disabled=${busy}>✕</button>
        </div>
        <div style=${{ padding: 20, display: 'grid', gap: 14 }}>
          ${err && html`<div class="note note-err">${err}</div>`}
          <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div class="field">
              <label>日付 *</label>
              <input type="date" value=${form.date}
                     onInput=${e => set('date', e.target.value)} disabled=${busy} />
            </div>
            <div class="field">
              <label>金額 *</label>
              <input type="text" inputmode="numeric" value=${form.amount}
                     onInput=${e => set('amount', e.target.value)} disabled=${busy}
                     style=${{ textAlign: 'right', fontFamily: 'var(--font-num)' }} />
            </div>
          </div>
          <div class="field">
            <label>取引先 *</label>
            <input type="text" value=${form.vendor}
                   onInput=${e => set('vendor', e.target.value)} disabled=${busy} />
          </div>
          <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div class="field">
              <label>勘定科目 *</label>
              <select value=${form.category} onChange=${e => set('category', e.target.value)}
                      disabled=${busy} style=${inputStyle}>
                <option value="">-- 未選択 --</option>
                ${accounts.map(a => html`
                  <option key=${a.id} value=${a.name}>${a.name}</option>
                `)}
              </select>
            </div>
            <div class="field">
              <label>部門</label>
              <select value=${form.dept} onChange=${e => set('dept', e.target.value)}
                      disabled=${busy} style=${inputStyle}>
                <option value="">-- 未選択 --</option>
                ${depts.map(d => html`
                  <option key=${d.id} value=${d.name}>${d.name}</option>
                `)}
              </select>
            </div>
          </div>
          <div style=${{ display: 'flex', gap: 20 }}>
            <label style=${checkLabel}>
              <input type="checkbox" checked=${form.reducedTax}
                     onChange=${e => set('reducedTax', e.target.checked)} disabled=${busy} />
              軽減税率(8%)
            </label>
            <label style=${checkLabel}>
              <input type="checkbox" checked=${form.hasInvoice}
                     onChange=${e => set('hasInvoice', e.target.checked)} disabled=${busy} />
              インボイス対応
            </label>
          </div>
          ${form.hasInvoice && html`
            <div class="field">
              <label>インボイス登録番号</label>
              <input type="text" value=${form.invoiceNumber}
                     onInput=${e => set('invoiceNumber', e.target.value)} disabled=${busy}
                     placeholder="T0000000000000" style=${{ fontFamily: 'var(--font-mono)' }} />
            </div>
          `}
          <div class="field">
            <label>メモ</label>
            <input type="text" value=${form.memo}
                   onInput=${e => set('memo', e.target.value)} disabled=${busy} />
          </div>
        </div>
        <div style=${modalFooter}>
          <button class="btn btn-danger" onClick=${remove} disabled=${busy}>削除</button>
          <div style=${{ display: 'flex', gap: 8 }}>
            <button class="btn btn-ghost" onClick=${onClose} disabled=${busy}>キャンセル</button>
            <button class="btn" onClick=${save} disabled=${busy}>${busy ? '保存中...' : '保存'}</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ---- Styles ----------------------------------------------------------------

const inputStyle = {
  width: '100%', padding: '10px 12px',
  border: '1px solid var(--border)', borderRadius: 8,
  background: '#f8f9fc', fontFamily: 'inherit', fontSize: 14,
};
const checkLabel = {
  display: 'flex', alignItems: 'center', gap: 6,
  fontSize: 12, color: 'var(--text-2)', fontWeight: 500,
  cursor: 'pointer', whiteSpace: 'nowrap',
};
function badge(bg, fg) {
  return {
    marginLeft: 6, fontSize: 10, padding: '1px 6px',
    background: bg, color: fg, borderRadius: 4, fontWeight: 600,
  };
}
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
  position: 'sticky', bottom: 0, background: 'var(--surface)',
};
