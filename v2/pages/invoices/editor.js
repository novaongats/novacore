/* ============================================================
   NOVA Core v2 — Invoices / Editor tab
   Create/edit invoice/receipt/quote/delivery documents.

   採番: 新規作成中は未採番（「（保存時に採番）」表示）。初回保存時に
   counters コレクションの Firestore トランザクションで採番する
   （calc.js allocateDocNumber）。手入力で番号を指定した場合はそれを優先。

   発行済みガード: status が issued/paid の書類は物理削除不可 —
   「取消」ボタンで status:'void' に遷移させる。draft のみ物理削除可。
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useEffect, useRef } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection, useDoc, where } from '../../store.js';
import { today, formatYen, uid, asArray, registerNavGuard } from '../../shared.js';
import {
  DOC_TYPES, DOC_TYPE_MAP, TAX_TYPES, STATUSES,
  calcTotals, allocateDocNumber,
} from './calc.js';
import { PreviewOverlay } from './preview.js';

const html = htm.bind(h);

// ---- Form normalization helpers (dirty detection / save payload) ----------

/** Strip internal _key from items (comparison / persistence). */
function stripForm(f) {
  if (!f) return f;
  return { ...f, items: (f.items || []).map(({ _key, ...rest }) => rest) };
}

/** Items normalized to fixed key order + numeric qty/price (for comparison). */
function normItems(items) {
  return (items || []).map(it => ({
    name: it.name || '',
    quantity: Number(it.quantity) || 0,
    unit: it.unit || '',
    unitPrice: Number(it.unitPrice) || 0,
    taxType: it.taxType || '10',
    taxIncluded: !!it.taxIncluded,
    memo: it.memo || '',
  }));
}

// ---- Main component -------------------------------------------------------

export function EditorTab({ docId, onDone, dirtyRef }) {
  const issuerQ  = useDoc(repos.settings, 'invoiceIssuer');
  const clientsQ = useCollection(repos.invoiceClients);
  const banksQ   = useCollection(repos.invoiceBanks);

  const [form, setForm]           = useState(null);
  const [initial, setInitial]     = useState(null);  // 初期スナップショット（_key除去済）
  const [initError, setInitError] = useState(null);
  const [busy, setBusy]           = useState(false);
  const [saveErr, setSaveErr]     = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  const mastersReady = !issuerQ.loading && !clientsQ.loading && !banksQ.loading;

  // Initialize form when editing existing doc or creating new
  useEffect(() => {
    if (!mastersReady) return;
    let cancelled = false;
    (async () => {
      setForm(null);
      setInitial(null);
      setInitError(null);
      try {
        if (docId) {
          const d = await repos.invoices.get(docId);
          if (cancelled) return;
          if (!d) { setInitError('ドキュメントが見つかりません (id: ' + docId + ')'); return; }
          // Ensure items have keys for React rendering
          d.items = (d.items || []).map(it => ({ ...it, _key: it._key || Math.random().toString(36).slice(2) }));
          setForm(d);
          setInitial(stripForm(d));
        } else {
          // 採番は初回保存時（allocateDocNumber）。ここでは番号なしで開始。
          const f = makeNewForm('invoice', issuerQ.data, banksQ.data);
          setForm(f);
          setInitial(stripForm(f));
        }
      } catch (e) {
        if (!cancelled) setInitError(e.message || String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [docId, mastersReady]);

  // --- Dirty tracking (G) ---------------------------------------------------
  // 初期フォームとの差分でダーティ判定。親（index.js）のタブ切替ガードは
  // dirtyRef 経由で参照する。beforeunload はダーティ時のみ有効化。

  const dirty = !!(form && initial &&
    JSON.stringify(stripForm(form)) !== JSON.stringify(initial));

  // ナビガード（サイドバー遷移）から常に最新の dirty を読むためのミラー
  const dirtyNowRef = useRef(false);

  useEffect(() => {
    dirtyNowRef.current = dirty;
    if (dirtyRef) dirtyRef.current = dirty;
  }, [dirty, dirtyRef]);

  /** 保存・破棄が確定した時点でダーティフラグを即時クリアする */
  function clearDirty() {
    dirtyNowRef.current = false;
    if (dirtyRef) dirtyRef.current = false;
  }

  // Reset the flag when the editor unmounts (e.g. after save/cancel).
  useEffect(() => {
    return () => { if (dirtyRef) dirtyRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // サイドバー遷移ガード: ダーティ中は confirm を挟む
  // （既存のタブ切替ガード dirtyRef・beforeunload と共存。マウント時に登録し
  //   アンマウント時に解除する）。
  useEffect(() => {
    return registerNavGuard(() =>
      !dirtyNowRef.current
      || confirm('編集中の書類が保存されていません。ページを離れますか？'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  if (!mastersReady) return html`<div style=${{ color: 'var(--text-3)' }}>マスタ読込中...</div>`;
  if (initError) return html`<div class="note note-err">${initError}</div>`;
  if (!form) return html`<div style=${{ color: 'var(--text-3)' }}>準備中...</div>`;

  // --- Field setters -------------------------------------------------------

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function changeType(newType) {
    // 採番は保存時に行うため、型変更で番号を再生成する必要はない
    // （手入力済みの番号はそのまま維持される）。
    set('type', newType);
  }

  function pickClient(id) {
    if (!id) {
      setForm(f => ({ ...f, clientId: '' }));
      return;
    }
    const c = (clientsQ.data || []).find(x => x.id === id);
    if (!c) return;
    setForm(f => ({
      ...f,
      clientId: c.id,
      clientCompany: c.companyName || '',
      clientContact: c.contactName || '',
      clientPostal:  c.postal || '',
      clientAddress: c.address || '',
      clientHonorific: c.honorific || '御中',
    }));
  }

  function pickBank(id) {
    if (!id) {
      // 「振込先なし」選択時はスナップショットの残留を防ぐため全フィールドをクリア
      setForm(f => ({
        ...f,
        bankId: '',
        bankName: '',
        bankBranch: '',
        bankAccountType: '',
        bankAccountNumber: '',
        bankAccountHolder: '',
        bankAccountHolderKana: '',
      }));
      return;
    }
    const b = (banksQ.data || []).find(x => x.id === id);
    if (!b) return;
    setForm(f => ({
      ...f,
      bankId: b.id,
      bankName:          b.bankName || '',
      bankBranch:        b.branch || '',
      bankAccountType:   b.accountType || '普通',
      bankAccountNumber: b.accountNumber || '',
      bankAccountHolder: b.accountHolder || '',
      bankAccountHolderKana: b.accountHolderKana || '',
    }));
  }

  // --- Items handlers ------------------------------------------------------

  function addItem() {
    setForm(f => ({
      ...f,
      items: [...(f.items || []), {
        _key: Math.random().toString(36).slice(2),
        name: '', quantity: 1, unit: '', unitPrice: 0,
        taxType: '10', taxIncluded: false, memo: '',
      }],
    }));
  }
  function updateItem(idx, patch) {
    setForm(f => ({
      ...f,
      items: f.items.map((it, i) => i === idx ? { ...it, ...patch } : it),
    }));
  }
  function removeItem(idx) {
    setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  }

  // --- Computed ------------------------------------------------------------

  const totals = calcTotals(form.items || []);
  const typeInfo = DOC_TYPE_MAP[form.type] || DOC_TYPES[0];
  const isInvoice = form.type === 'invoice';
  const isQuote   = form.type === 'quote';
  const isReceipt = form.type === 'receipt';

  // 発行済みガード判定は「保存済みの」ステータス（initial）で行う。
  const origStatus = (docId && initial?.status) || 'draft';
  const locked   = !!docId && (origStatus === 'issued' || origStatus === 'paid');
  const isVoided = origStatus === 'void' || origStatus === 'cancelled';

  // --- Save / delete -------------------------------------------------------

  async function save() {
    setSaveErr(null);
    if (!form.clientCompany?.trim()) { setSaveErr('宛先の会社名は必須です'); return; }
    if (!form.issueDate) { setSaveErr('発行日を入力してください'); return; }
    if (!form.items?.length) { setSaveErr('品目を少なくとも1件追加してください'); return; }

    // quantity / unitPrice は Number に正規化して保存（文字列のまま入れない）
    const items = form.items.map(({ _key, ...rest }) => ({
      ...rest,
      quantity: Number(rest.quantity) || 0,
      unitPrice: Number(rest.unitPrice) || 0,
    }));
    if (!items.some(i => i.unitPrice > 0 && i.quantity > 0)) {
      setSaveErr('少なくとも1つの品目で金額を入力してください'); return;
    }
    const totals = calcTotals(items);
    if (totals.total < 0) { setSaveErr('合計金額が負の値です。品目を確認してください'); return; }

    // 適格請求書の発行者名（B）: 未設定のまま発行しようとしたら警告
    if (!form.issuerCompany?.trim()) {
      if (!confirm('発行元（自社情報）が未設定です。適格請求書には発行者名が必要です。\nこのまま保存しますか？（「自社情報」タブで設定できます）')) return;
    }

    // 発行済み書類の金額・品目変更ガード（D）
    if (locked) {
      const changed = JSON.stringify(normItems(initial?.items)) !== JSON.stringify(normItems(items));
      if (changed) {
        if (!confirm('発行済みの書類を変更します。取引先に再送が必要になる可能性があります。よろしいですか？')) return;
      }
    }

    setBusy(true);
    try {
      // 採番（C）: 番号が空なら初回保存時にトランザクションで採番。
      // 失敗時はフォールバックせずエラー表示して保存を中断する。
      let docNumber = (form.docNumber || '').trim();
      if (!docNumber) {
        docNumber = await allocateDocNumber(form.type, form.issueDate);
        // 採番成功を即フォームへ反映してから upsert する。
        // upsert が失敗してもフォームに番号が残るため、リトライは同じ番号を
        // 使い、採番済み番号が欠番になることを防ぐ。
        setForm(f => ({ ...f, docNumber }));
      } else {
        // 手入力番号の重複チェック（警告のみ・保存はブロックしない）
        try {
          const dupes = (await repos.invoices.list(where('docNumber', '==', docNumber)))
            .filter(d => d.id !== form.id);
          if (dupes.length) {
            const ok = confirm(
              `書類番号「${docNumber}」は既に別の書類（${dupes.length}件）で使われています。\n` +
              'このまま保存すると番号が重複します。保存しますか？');
            if (!ok) { setBusy(false); return; }
          }
        } catch (dupErr) {
          // チェック自体の失敗（権限・ネットワーク）では保存を妨げない
          console.warn('[invoices] docNumber duplicate check failed', dupErr);
        }
      }

      const id = form.id || uid('inv_');

      await repos.invoices.upsert({
        ...form,
        id,
        docNumber,
        items,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        tax10: totals.tax10,
        tax8: totals.tax8,
        totalAmount: totals.total,
      });
      clearDirty();
      onDone?.();
    } catch (e) {
      console.error('[invoices] save failed', e);
      setSaveErr('保存に失敗: ' + (e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!form.id) return;
    setSaveErr(null);

    if (locked) {
      // 発行済み/入金済は物理削除せず「取消」(void) に遷移（D）。
      // 採番はカウンター方式のため、取消済み番号が再利用されることはない。
      if (!confirm(`「${form.docNumber}」を取消にしますか？\n（物理削除はされず、ステータスが「取消」になります）`)) return;
      setBusy(true);
      try {
        await repos.invoices.upsert({ id: form.id, status: 'void' });
        clearDirty();
        onDone?.();
      } catch (e) {
        console.error('[invoices] void failed', e);
        setSaveErr('取消に失敗: ' + (e.message || e));
        setBusy(false);
      }
      return;
    }

    // draft のみ物理削除可
    if (!confirm(`「${form.docNumber || '（未採番）'}」を削除しますか？`)) return;
    setBusy(true);
    try {
      await repos.invoices.remove(form.id);
      clearDirty();
      onDone?.();
    } catch (e) {
      console.error('[invoices] delete failed', e);
      setSaveErr('削除に失敗: ' + (e.message || e));
      setBusy(false);
    }
  }

  function cancel() {
    if (dirty && !confirm('編集中の内容が保存されていません。破棄しますか？')) return;
    clearDirty();
    onDone?.();
  }

  // --- Render --------------------------------------------------------------

  return html`
    <div style=${{ maxWidth: 900 }}>
      ${saveErr && html`<div class="note note-err">${saveErr}</div>`}

      ${isVoided && html`
        <div class="note note-err" style=${{ marginBottom: 12 }}>
          この書類は取消済みです
        </div>
      `}

      <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 16 }}>
        <div style=${{ fontSize: 13, color: 'var(--text-3)' }}>
          ${docId ? '書類編集' : '新規書類作成'}
        </div>
        <button class="btn btn-ghost" onClick=${() => setShowPreview(true)} disabled=${busy}>
          👁 プレビュー
        </button>
      </div>

      <${TypeSwitcher} current=${form.type} onChange=${changeType} busy=${busy} />

      <${Section} title="基本情報">
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <${Field} label="書類番号">
            <input type="text" value=${form.docNumber || ''}
                   placeholder=${docId ? '' : '（保存時に採番）'}
                   onInput=${e => set('docNumber', e.target.value)} disabled=${busy}
                   style=${{ ...inputStyle, fontFamily: 'var(--font-mono)' }} />
          </Field>
          <${Field} label="発行日">
            <input type="date" value=${form.issueDate}
                   onInput=${e => set('issueDate', e.target.value)} disabled=${busy}
                   style=${inputStyle} />
          </Field>
          ${(isInvoice || isQuote) && html`
            <${Field} label=${isInvoice ? '支払期日' : '有効期限'}>
              <input type="date" value=${form.dueDate || ''}
                     onInput=${e => set('dueDate', e.target.value)} disabled=${busy}
                     style=${inputStyle} />
            </Field>
          `}
          ${isReceipt && html`
            <${Field} label="但し書き">
              <input type="text" value=${form.proviso ?? 'お品代として'}
                     onInput=${e => set('proviso', e.target.value)} disabled=${busy}
                     style=${inputStyle} />
            </Field>
          `}
        </div>
      </Section>

      <${Section} title="宛先">
        <div style=${{ marginBottom: 12 }}>
          <${Field} label="顧客マスタから選択">
            <select value=${form.clientId || ''} onChange=${e => pickClient(e.target.value)}
                    disabled=${busy} style=${inputStyle}>
              <option value="">-- 手入力 --</option>
              ${asArray(clientsQ.data).map(c => html`
                <option key=${c.id} value=${c.id}>
                  ${c.companyName}${c.contactName ? ' / ' + c.contactName : ''}
                </option>
              `)}
            </select>
          </Field>
        </div>
        <div style=${{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
          <${Field} label="会社名 / 顧客名 *">
            <input type="text" value=${form.clientCompany || ''}
                   onInput=${e => set('clientCompany', e.target.value)} disabled=${busy}
                   style=${inputStyle} />
          </Field>
          <${Field} label="敬称">
            <select value=${form.clientHonorific || '御中'}
                    onChange=${e => set('clientHonorific', e.target.value)}
                    disabled=${busy} style=${inputStyle}>
              <option value="御中">御中</option>
              <option value="様">様</option>
              <option value="">（なし）</option>
            </select>
          </Field>
        </div>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
          <${Field} label="担当者名">
            <input type="text" value=${form.clientContact || ''}
                   onInput=${e => set('clientContact', e.target.value)} disabled=${busy}
                   style=${inputStyle} />
          </Field>
          <${Field} label="郵便番号">
            <input type="text" value=${form.clientPostal || ''}
                   onInput=${e => set('clientPostal', e.target.value)} disabled=${busy}
                   style=${inputStyle} />
          </Field>
        </div>
        <div style=${{ marginTop: 10 }}>
          <${Field} label="住所">
            <input type="text" value=${form.clientAddress || ''}
                   onInput=${e => set('clientAddress', e.target.value)} disabled=${busy}
                   style=${inputStyle} />
          </Field>
        </div>
      </Section>

      <${Section} title="品目">
        <${ItemsTable}
          items=${form.items || []}
          onUpdate=${updateItem}
          onRemove=${removeItem}
          onAdd=${addItem}
          busy=${busy}
        />
        <${TotalsBar} totals=${totals} />
      </Section>

      ${isInvoice && html`
        <${Section} title="振込先">
          <div style=${{ marginBottom: 12 }}>
            <${Field} label="振込先マスタから選択">
              <select value=${form.bankId || ''} onChange=${e => pickBank(e.target.value)}
                      disabled=${busy} style=${inputStyle}>
                <option value="">-- 振込先なし --</option>
                ${asArray(banksQ.data).map(b => html`
                  <option key=${b.id} value=${b.id}>
                    ${b.bankName} / ${b.branch} / ${b.accountNumber}
                    ${b.isDefault ? ' ⭐' : ''}
                  </option>
                `)}
              </select>
            </Field>
          </div>
          ${form.bankId && html`
            <div style=${{
              padding: 12, background: 'var(--bg-alt)', borderRadius: 8,
              fontSize: 12, fontFamily: 'var(--font-mono)',
            }}>
              ${form.bankName} / ${form.bankBranch}<br/>
              ${form.bankAccountType} ${form.bankAccountNumber} / ${form.bankAccountHolder}
              ${form.bankAccountHolderKana && ` (${form.bankAccountHolderKana})`}
            </div>
          `}
        </Section>
      `}

      <${Section} title="発行元">
        <div style=${{
          padding: 12, background: 'var(--bg-alt)', borderRadius: 8,
          fontSize: 13, lineHeight: 1.7,
        }}>
          <div style=${{ fontWeight: 600 }}>${form.issuerCompany || '(未設定)'}</div>
          <div style=${{ fontSize: 12, color: 'var(--text-3)' }}>
            ${form.issuerPostal && '〒' + form.issuerPostal + ' '}${form.issuerAddress || ''}
          </div>
          ${form.issuerPhone && html`<div style=${{ fontSize: 12, color: 'var(--text-3)' }}>📞 ${form.issuerPhone}</div>`}
          ${form.issuerInvoiceNumber && html`
            <div style=${{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
              インボイス登録番号: ${form.issuerInvoiceNumber}
            </div>
          `}
          <div style=${{ fontSize: 11, color: 'var(--text-4)', marginTop: 6 }}>
            ※ 「自社情報」タブで編集できます
          </div>
        </div>
      </Section>

      <${Section} title="備考">
        <textarea rows="3" value=${form.notes || ''}
                  onInput=${e => set('notes', e.target.value)} disabled=${busy}
                  style=${{
                    width: '100%', padding: '12px 16px',
                    border: '1px solid var(--border)', borderRadius: 10,
                    background: '#f8f9fc', fontFamily: 'inherit', fontSize: 14,
                    resize: 'vertical',
                  }}></textarea>
      </Section>

      <${Section} title="表示・ステータス">
        <div style=${{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style=${checkLabel}>
            <input type="checkbox" checked=${!!form.showTaxIncluded}
                   onChange=${e => set('showTaxIncluded', e.target.checked)} disabled=${busy} />
            税込表示（合計欄に「税込」を明記）
          </label>
          <label style=${{ ...checkLabel, opacity: isInvoice ? 0.5 : 1, cursor: isInvoice ? 'not-allowed' : 'pointer' }}
                 title=${isInvoice ? '適格請求書では税率別内訳の記載が必須です' : ''}>
            <input type="checkbox" checked=${isInvoice ? false : !!form.hideTaxBreakdown}
                   onChange=${e => set('hideTaxBreakdown', e.target.checked)}
                   disabled=${busy || isInvoice} />
            税内訳を非表示
          </label>
          ${isInvoice && html`
            <span style=${{ fontSize: 11, color: 'var(--text-4)' }}>
              ※ 適格請求書では税率別内訳の記載が必須です
            </span>
          `}
          <div style=${{ marginLeft: 'auto' }}>
            <label style=${{ fontSize: 12, color: 'var(--text-3)', marginRight: 6 }}>ステータス</label>
            <select value=${form.status || 'draft'} onChange=${e => set('status', e.target.value)}
                    disabled=${busy}
                    style=${{
                      padding: '6px 10px', border: '1px solid var(--border)',
                      borderRadius: 8, background: 'var(--surface)', fontSize: 13,
                    }}>
              ${STATUSES.map(s => html`<option key=${s.id} value=${s.id}>${s.label}</option>`)}
            </select>
          </div>
        </div>
      </Section>

      <div style=${{
        display: 'flex', justifyContent: 'space-between',
        marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)',
      }}>
        <div>
          ${form.id && !isVoided && html`
            <button class="btn btn-danger" onClick=${remove} disabled=${busy}
                    title=${locked ? '発行済みのため物理削除できません。取消（void）に遷移します' : ''}>
              ${locked ? '取消' : '削除'}
            </button>
          `}
        </div>
        <div style=${{ display: 'flex', gap: 8 }}>
          <button class="btn btn-ghost" onClick=${cancel} disabled=${busy}>キャンセル</button>
          <button class="btn" onClick=${save} disabled=${busy}>
            ${busy ? '保存中...' : (form.id ? '更新' : '保存')}
          </button>
        </div>
      </div>

      ${showPreview && html`
        <${PreviewOverlay}
          doc=${{ ...form, items: (form.items || []).map(({ _key, ...rest }) => rest) }}
          onClose=${() => setShowPreview(false)}
        />
      `}
    </div>
  `;
}

// ---- Sub-components --------------------------------------------------------

function TypeSwitcher({ current, onChange, busy }) {
  return html`
    <div style=${{
      display: 'flex', gap: 4, marginBottom: 20,
      padding: 4, background: 'var(--bg-alt)', borderRadius: 10,
    }}>
      ${DOC_TYPES.map(t => html`
        <button key=${t.id} onClick=${() => onChange(t.id)} disabled=${busy}
                style=${{
                  flex: 1, padding: '10px 14px', border: 'none',
                  borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13,
                  background: current === t.id ? '#fff' : 'transparent',
                  color: current === t.id ? t.color : 'var(--text-3)',
                  boxShadow: current === t.id ? 'var(--shadow-xs)' : 'none',
                  transition: 'all var(--tx-base)',
                }}>
          ${t.label}
        </button>
      `)}
    </div>
  `;
}

function Section({ title, children }) {
  return html`
    <div style=${{ marginBottom: 22 }}>
      <div style=${{
        fontSize: 12, fontWeight: 700, color: 'var(--text-3)',
        textTransform: 'uppercase', letterSpacing: '0.04em',
        marginBottom: 10, paddingBottom: 6,
        borderBottom: '1px solid var(--border-2)',
      }}>${title}</div>
      ${children}
    </div>
  `;
}

function Field({ label, children }) {
  return html`
    <div>
      <div style=${{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, marginBottom: 5 }}>
        ${label}
      </div>
      ${children}
    </div>
  `;
}

function ItemsTable({ items, onUpdate, onRemove, onAdd, busy }) {
  return html`
    <div>
      <div style=${{
        display: 'grid',
        gridTemplateColumns: '1fr 80px 80px 110px 100px 80px 40px',
        gap: 6, fontSize: 11, color: 'var(--text-3)', fontWeight: 600,
        padding: '0 4px 6px',
      }}>
        <div>品名</div>
        <div style=${{ textAlign: 'right' }}>数量</div>
        <div>単位</div>
        <div style=${{ textAlign: 'right' }}>単価</div>
        <div>税区分</div>
        <div>税込</div>
        <div></div>
      </div>
      ${items.map((it, idx) => {
        const qty = Number(it.quantity) || 0;
        const price = Number(it.unitPrice) || 0;
        const lineAmount = qty * price;
        const rowKey = it._key || idx;
        return html`
          <div key=${rowKey} style=${{
            display: 'grid',
            gridTemplateColumns: '1fr 80px 80px 110px 100px 80px 40px',
            gap: 6, alignItems: 'center', marginBottom: 4,
          }}>
            <input type="text" placeholder="品名" value=${it.name || ''}
                   onInput=${e => onUpdate(idx, { name: e.target.value })} disabled=${busy}
                   style=${inputStyleSmall} />
            <input type="text" inputmode="decimal" value=${it.quantity ?? ''}
                   onInput=${e => onUpdate(idx, { quantity: e.target.value })} disabled=${busy}
                   style=${{ ...inputStyleSmall, textAlign: 'right', fontFamily: 'var(--font-num)' }} />
            <input type="text" placeholder="個" value=${it.unit || ''}
                   onInput=${e => onUpdate(idx, { unit: e.target.value })} disabled=${busy}
                   style=${inputStyleSmall} />
            <input type="text" inputmode="numeric" value=${it.unitPrice ?? ''}
                   onInput=${e => onUpdate(idx, { unitPrice: e.target.value.replace(/[^\d.-]/g, '') })}
                   disabled=${busy}
                   style=${{ ...inputStyleSmall, textAlign: 'right', fontFamily: 'var(--font-num)' }} />
            <select value=${it.taxType || '10'}
                    onChange=${e => onUpdate(idx, { taxType: e.target.value })} disabled=${busy}
                    style=${inputStyleSmall}>
              ${TAX_TYPES.map(t => html`<option key=${t.id} value=${t.id}>${t.label}</option>`)}
            </select>
            <label style=${{ ...checkLabel, justifyContent: 'center' }}>
              <input type="checkbox" checked=${!!it.taxIncluded}
                     onChange=${e => onUpdate(idx, { taxIncluded: e.target.checked })} disabled=${busy} />
            </label>
            <button class="btn btn-ghost" onClick=${() => onRemove(idx)} disabled=${busy}
                    style=${{ padding: '6px 8px' }} title="行を削除">×</button>
          </div>
          <div key=${rowKey + '-amount'} style=${{
            marginLeft: 6, fontSize: 11, color: 'var(--text-3)', marginBottom: 8,
            textAlign: 'right',
          }}>
            行金額: <span class="num" style=${{ fontWeight: 600, color: 'var(--text-2)' }}>
              ${formatYen(lineAmount)}
            </span>
          </div>
        `;
      })}
      <div>
        <button class="btn btn-ghost" onClick=${onAdd} disabled=${busy}>＋ 行を追加</button>
      </div>
    </div>
  `;
}

function TotalsBar({ totals }) {
  return html`
    <div style=${{
      marginTop: 12, padding: '14px 16px',
      background: 'var(--bg-alt)', borderRadius: 10,
      display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
      fontSize: 13,
    }}>
      <div>
        <div style=${{ fontSize: 11, color: 'var(--text-3)' }}>小計（税抜）</div>
        <div class="num" style=${{ fontWeight: 600 }}>${formatYen(totals.subtotal)}</div>
      </div>
      <div>
        <div style=${{ fontSize: 11, color: 'var(--text-3)' }}>消費税 10%</div>
        <div class="num" style=${{ fontWeight: 600 }}>${formatYen(totals.tax10)}</div>
      </div>
      <div>
        <div style=${{ fontSize: 11, color: 'var(--text-3)' }}>消費税 8%</div>
        <div class="num" style=${{ fontWeight: 600 }}>${formatYen(totals.tax8)}</div>
      </div>
      <div style=${{ textAlign: 'right' }}>
        <div style=${{ fontSize: 11, color: 'var(--text-3)' }}>合計</div>
        <div class="num" style=${{ fontWeight: 800, fontSize: 18, color: 'var(--primary)' }}>
          ${formatYen(totals.total)}
        </div>
      </div>
    </div>
  `;
}

// ---- Helpers --------------------------------------------------------------

function makeNewForm(type, issuer, banks) {
  const defaultBank = (banks || []).find(b => b.isDefault) || (banks || [])[0] || null;
  const i = issuer || {};
  return {
    id: null,
    type,
    docNumber: '',  // 初回保存時にトランザクションで採番
    issueDate: today(),
    dueDate: '',
    status: 'draft',

    // Client fields
    clientId: '',
    clientCompany: '',
    clientContact: '',
    clientPostal: '',
    clientAddress: '',
    clientHonorific: '御中',

    // Issuer snapshot
    issuerCompany: i.companyName || '',
    issuerContact: i.contact || '',
    issuerPostal:  i.postal || '',
    issuerAddress: i.address || '',
    issuerPhone:   i.phone || '',
    issuerEmail:   i.email || '',
    issuerInvoiceNumber: i.invoiceNumber || '',

    // Bank snapshot (invoice only but include anyway)
    bankId: defaultBank?.id || '',
    bankName:          defaultBank?.bankName || '',
    bankBranch:        defaultBank?.branch || '',
    bankAccountType:   defaultBank?.accountType || '普通',
    bankAccountNumber: defaultBank?.accountNumber || '',
    bankAccountHolder: defaultBank?.accountHolder || '',
    bankAccountHolderKana: defaultBank?.accountHolderKana || '',

    // Items
    items: [{
      _key: Math.random().toString(36).slice(2),
      name: '', quantity: 1, unit: '', unitPrice: 0,
      taxType: '10', taxIncluded: false, memo: '',
    }],

    // Receipt only: 但し書き
    proviso: 'お品代として',

    // Display options
    showTaxIncluded: false,
    hideTaxBreakdown: false,

    notes: i.defaultNotes || '',
  };
}

// ---- Styles ---------------------------------------------------------------

const inputStyle = {
  width: '100%', padding: '10px 12px',
  border: '1px solid var(--border)', borderRadius: 8,
  background: '#f8f9fc', fontFamily: 'inherit', fontSize: 13,
};
const inputStyleSmall = {
  width: '100%', padding: '7px 9px',
  border: '1px solid var(--border)', borderRadius: 6,
  background: '#f8f9fc', fontFamily: 'inherit', fontSize: 12.5,
};
const checkLabel = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  fontSize: 12, color: 'var(--text-2)', fontWeight: 500,
  cursor: 'pointer',
};
