/* ============================================================
   NOVA Core v2 — Cashbook / AI receipt scan
   Claude API (Anthropic) + Firebase Storage for receipt images.
   API key is read from localStorage ONLY (never synced).
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useEffect, useMemo, useRef } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection, uploadFile, deleteFile } from '../../store.js';
import { getClaudeApiKey } from '../settings.js';
import {
  formatYen, today, uid, asArray,
} from '../../shared.js';

const html = htm.bind(h);

// インボイス登録番号の形式（T + 13桁）。警告のみで登録はブロックしない。
const INVOICE_NUMBER_RE = /^T\d{13}$/;

// Claude model. Switch here if needed.
const MODEL = 'claude-sonnet-4-6';
const DEFAULT_THRESHOLD = 80;
const THRESHOLD_LS_KEY = 'nova_v2_scan_threshold';

// ---- Main ------------------------------------------------------------------

export function ScanTab() {
  const accounts = useCollection(repos.cashbookAccounts);
  const depts    = useCollection(repos.cashbookDepts);

  const [files, setFiles]       = useState([]);   // [{ id, file, previewUrl }]
  const [results, setResults]   = useState([]);   // [{ id, file, previewUrl, data, form, status, error? }]
  const [progress, setProgress] = useState(null); // {current,total,label}
  const [err, setErr]           = useState(null);
  const [apiKey, setApiKey]     = useState(getClaudeApiKey());
  const [threshold, setThreshold] = useState(
    () => Number(localStorage.getItem(THRESHOLD_LS_KEY)) || DEFAULT_THRESHOLD
  );

  // 非同期処理（連続登録・登録中の編集）から常に最新 state を読むための同期ミラー。
  // setResults/setFiles を直接呼ばず、必ずこのセッターを通す。
  const filesRef   = useRef(files);
  const resultsRef = useRef(results);
  function setFilesSync(updater) {
    filesRef.current = typeof updater === 'function' ? updater(filesRef.current) : updater;
    setFiles(filesRef.current);
  }
  function setResultsSync(updater) {
    resultsRef.current = typeof updater === 'function' ? updater(resultsRef.current) : updater;
    setResults(resultsRef.current);
  }

  // アンマウント時に残っているプレビューURLをすべて解放
  useEffect(() => () => {
    const urls = new Set([
      ...filesRef.current.map(f => f.previewUrl),
      ...resultsRef.current.map(r => r.previewUrl),
    ]);
    for (const u of urls) if (u) URL.revokeObjectURL(u);
  }, []);

  // Re-read API key when tab becomes visible (user may have set it in Settings).
  useEffect(() => {
    function onFocus() { setApiKey(getClaudeApiKey()); }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  function handleThreshold(v) {
    const n = Math.max(0, Math.min(100, Number(v) || 0));
    setThreshold(n);
    localStorage.setItem(THRESHOLD_LS_KEY, String(n));
  }

  function addFiles(list) {
    const valid = [];
    for (const f of list) {
      if (!f.type.startsWith('image/') && f.type !== 'application/pdf') continue;
      if (f.size > 10 * 1024 * 1024) {
        setErr(`${f.name} は 10MB を超えています。スキップします。`);
        continue;
      }
      // プレビューURLはここで一度だけ生成し、削除/クリア/アンマウント時に revoke する
      valid.push({
        id: uid('file_'),
        file: f,
        previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
      });
    }
    setFilesSync(prev => [...prev, ...valid]);
  }

  // URL を解放してよいのは、files / results のどちらからも参照されなくなったときだけ
  function revokeIfUnused(url) {
    if (!url) return;
    const stillUsed = filesRef.current.some(f => f.previewUrl === url)
      || resultsRef.current.some(r => r.previewUrl === url);
    if (!stillUsed) URL.revokeObjectURL(url);
  }

  function removeFile(id) {
    const item = filesRef.current.find(f => f.id === id);
    setFilesSync(prev => prev.filter(f => f.id !== id));
    revokeIfUnused(item?.previewUrl);
  }

  function clearAll() {
    const urls = new Set([
      ...filesRef.current.map(f => f.previewUrl),
      ...resultsRef.current.map(r => r.previewUrl),
    ]);
    setFilesSync([]);
    setResultsSync([]);
    for (const u of urls) if (u) URL.revokeObjectURL(u);
    setErr(null);
  }

  async function analyzeAll() {
    if (!apiKey) {
      setErr('APIキーが未設定です。「設定」→「API設定」で登録してください');
      return;
    }
    if (!files.length) return;

    setErr(null);
    setResultsSync([]);
    const acctNames = asArray(accounts.data).map(a => a.name);
    const deptNames = asArray(depts.data).map(d => d.name);

    const items = [...filesRef.current];
    const out = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      setProgress({ current: i, total: items.length, label: item.file.name });
      try {
        const parsed = await analyzeOne(item.file, apiKey, acctNames, deptNames);
        out.push({
          id: uid('scan_'),
          file: item.file,
          previewUrl: item.previewUrl, // ファイル選択時に生成したURLを共有（再生成しない）
          data: parsed,
          // Writable fields (user can edit before register)
          form: normalizeResult(parsed, acctNames, deptNames),
          status: 'ready',
        });
      } catch (e) {
        console.error('[scan] analyze failed for', item.file.name, e);
        out.push({
          id: uid('scan_'),
          file: item.file,
          previewUrl: item.previewUrl,
          data: null,
          error: e.message || String(e),
          status: 'error',
        });
      }
      setResultsSync([...out]);  // incremental render
    }
    setProgress(null);
  }

  function patchResult(id, patch) {
    setResultsSync(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }

  /** 登録前の入力検証（ledger.js 手入力と同等）。不備メッセージの配列を返す。 */
  function validateForm(f) {
    const errs = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || '')) errs.push('日付は YYYY-MM-DD 形式で入力してください');
    if (!(f.vendor || '').trim()) errs.push('取引先は必須です');
    const amt = Number(f.amount);
    if (!amt || amt <= 0) errs.push('金額は正の数値で入力してください');
    return errs;
  }

  async function registerOne(id) {
    // 常に最新 state を ID で参照（stale index / 破棄済みカード対策）
    const r = resultsRef.current.find(x => x.id === id);
    if (!r) return;                   // 破棄済みはスキップ
    if (r.status !== 'ready') return; // 二重登録防止（uploading/registered）・解析失敗カードは登録不可

    const errs = validateForm(r.form);
    if (errs.length) {
      patchResult(id, { error: errs.join(' / ') });
      return;
    }

    patchResult(id, { status: 'uploading', error: null });
    let uploaded = null;
    try {
      // Upload original file to Firebase Storage
      uploaded = await uploadFile(r.file, 'cashbook', r.form.date.substring(0, 7));
      // Save cashbook entry
      await repos.cashbook.upsert({
        id: uid('cb_'),
        date: r.form.date,
        vendor: r.form.vendor.trim(),
        category: r.form.category,
        dept: r.form.dept,
        amount: Math.round(Number(r.form.amount)) || 0,
        reducedTax: !!r.form.reducedTax,
        hasInvoice: !!r.form.hasInvoice,
        invoiceNumber: r.form.invoiceNumber || '',
        memo: r.form.memo || '',
        source: 'ai',
        confidence: r.data?.confidence || 0,
        fileUrl: uploaded.url,
        storagePath: uploaded.storagePath,
        originalFileName: uploaded.originalName,
      });
      patchResult(id, { status: 'registered' });
    } catch (e) {
      console.error('[scan] register failed', e);
      // Storage 孤児防止: アップロード成功後に upsert が失敗したらロールバック
      if (uploaded?.storagePath) {
        try { await deleteFile(uploaded.storagePath); }
        catch (e2) { console.warn('[scan] rollback delete failed (orphan left):', uploaded.storagePath, e2); }
      }
      patchResult(id, { status: 'ready', error: e.message || String(e) });
    }
  }

  async function registerAutoEligible() {
    const ids = resultsRef.current
      .filter(r => r.status === 'ready' && (r.data?.confidence || 0) >= threshold)
      .map(r => r.id);
    for (const id of ids) {
      await registerOne(id); // 破棄済み・状態変化済みは registerOne 側でスキップされる
    }
  }

  function updateForm(id, patch) {
    setResultsSync(prev => prev.map(r => r.id === id ? { ...r, form: { ...r.form, ...patch } } : r));
  }

  function removeResult(id) {
    const removed = resultsRef.current.find(r => r.id === id);
    setResultsSync(prev => prev.filter(r => r.id !== id));
    revokeIfUnused(removed?.previewUrl);
  }

  const autoCount = results.filter(r => r.status === 'ready' && (r.data?.confidence || 0) >= threshold).length;
  const reviewCount = results.filter(r => r.status === 'ready' && (r.data?.confidence || 0) <  threshold).length;

  return html`
    <div>
      <${ApiKeyStatus} apiKey=${apiKey} />

      <${DropZone} onFiles=${addFiles} />

      ${files.length > 0 && html`
        <${FileList} files=${files} onRemove=${removeFile} />
        <div style=${{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button class="btn" onClick=${analyzeAll} disabled=${!apiKey || !!progress || !files.length}>
            🤖 AI解析開始 (${files.length}枚)
          </button>
          <button class="btn btn-ghost" onClick=${clearAll} disabled=${!!progress}>クリア</button>
        </div>
      `}

      ${err && html`<div class="note note-err" style=${{ marginTop: 12 }}>${err}</div>`}

      ${progress && html`
        <div class="card" style=${{ marginTop: 16, padding: 18 }}>
          <div style=${{ fontSize: 13, marginBottom: 8 }}>
            ${progress.current + 1}/${progress.total} 枚目: <code>${progress.label}</code>
          </div>
          <div class="progress-bar">
            <div class="progress-bar-fill" style=${{
              width: ((progress.current / Math.max(1, progress.total)) * 100) + '%',
            }}></div>
          </div>
        </div>
      `}

      ${results.length > 0 && html`
        <div style=${{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          margin: '20px 0 12px',
        }}>
          <div style=${{ fontSize: 14, fontWeight: 700 }}>
            解析結果 (${results.length}件)
          </div>
          <div style=${{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style=${{ fontSize: 12, color: 'var(--text-3)' }}>
              自動登録しきい値:
              <input type="number" min="0" max="100" value=${threshold}
                     onInput=${e => handleThreshold(e.target.value)}
                     style=${{ marginLeft: 6, width: 54, padding: '4px 6px',
                               border: '1px solid var(--border)', borderRadius: 6,
                               textAlign: 'center', fontFamily: 'var(--font-num)' }} />%
            </label>
            ${autoCount > 0 && html`
              <button class="btn" onClick=${registerAutoEligible}>
                ✓ 自動登録 (${autoCount}件)
              </button>
            `}
          </div>
        </div>

        <div style=${{ marginBottom: 12, display: 'flex', gap: 12, fontSize: 12 }}>
          ${autoCount > 0 && html`
            <span style=${{ padding: '4px 10px', background: 'var(--success-soft)',
                             color: 'var(--success)', borderRadius: 999, fontWeight: 600 }}>
              ✓ 自動登録対象: ${autoCount}
            </span>
          `}
          ${reviewCount > 0 && html`
            <span style=${{ padding: '4px 10px', background: '#fef3c7',
                             color: '#92400e', borderRadius: 999, fontWeight: 600 }}>
              ⚠ 要確認: ${reviewCount}
            </span>
          `}
        </div>

        ${results.map(r => html`
          <${ResultCard}
            key=${r.id}
            result=${r}
            accounts=${asArray(accounts.data)}
            depts=${asArray(depts.data)}
            threshold=${threshold}
            onFormChange=${(patch) => updateForm(r.id, patch)}
            onRegister=${() => registerOne(r.id)}
            onRemove=${() => removeResult(r.id)}
          />
        `)}
      `}
    </div>
  `;
}

// ---- API key status banner -------------------------------------------------

function ApiKeyStatus({ apiKey }) {
  if (apiKey) {
    return html`
      <div style=${{
        padding: '10px 14px', background: 'var(--success-soft)',
        color: 'var(--success)', borderRadius: 10, marginBottom: 16,
        fontSize: 12, display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span>✓</span>
        <span>APIキー設定済み (端末ローカル保存)</span>
        <span style=${{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.7 }}>
          ${apiKey.slice(0, 12)}...
        </span>
      </div>
    `;
  }
  return html`
    <div class="note note-warn" style=${{ marginBottom: 16 }}>
      ⚠ <strong>Claude APIキーが未設定です。</strong>
      「設定」→「API設定」タブから登録してください。<br/>
      <a href="#/settings" style=${{ color: 'var(--primary)', fontSize: 12 }}>→ 設定画面を開く</a>
    </div>
  `;
}

// ---- Drop zone -------------------------------------------------------------

function DropZone({ onFiles }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
  }
  function onSelect(e) {
    if (e.target.files?.length) onFiles(e.target.files);
    e.target.value = '';
  }

  return html`
    <div style=${{
      border: '2px dashed ' + (dragOver ? 'var(--primary)' : 'var(--border)'),
      borderRadius: 14, padding: '40px 20px', textAlign: 'center',
      cursor: 'pointer', background: dragOver ? 'var(--primary-soft)' : 'var(--surface)',
      transition: 'all .2s',
    }}
      onDragOver=${e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave=${() => setDragOver(false)}
      onDrop=${onDrop}
      onClick=${() => inputRef.current?.click()}>
      <input type="file" ref=${inputRef} multiple
             accept="image/*,application/pdf"
             onChange=${onSelect} style=${{ display: 'none' }} />
      <div style=${{ fontSize: 40, marginBottom: 10 }}>🧾</div>
      <div style=${{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
        レシート・領収書をドロップ または クリックして選択
      </div>
      <div style=${{ fontSize: 12, color: 'var(--text-3)' }}>
        JPG / PNG / PDF（10MB まで・複数可）
      </div>
    </div>
  `;
}

// ---- Selected file list ----------------------------------------------------

function FileList({ files, onRemove }) {
  return html`
    <div style=${{ marginTop: 14 }}>
      <div style=${{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600, marginBottom: 8 }}>
        選択中のファイル (${files.length}枚)
      </div>
      <div style=${{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        ${files.map(item => html`
          <div key=${item.id} style=${{
            position: 'relative',
            width: 84, height: 84,
            borderRadius: 10, overflow: 'hidden',
            border: '1px solid var(--border)',
            background: 'var(--bg-alt)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            ${item.previewUrl
              ? html`<img src=${item.previewUrl}
                          style=${{ width: '100%', height: '100%', objectFit: 'cover' }} />`
              : html`<div style=${{ fontSize: 28 }}>📄</div>`}
            <button onClick=${(e) => { e.stopPropagation(); onRemove(item.id); }}
                    style=${{
                      position: 'absolute', top: 2, right: 2,
                      width: 20, height: 20, borderRadius: '50%',
                      background: 'rgba(220,38,38,0.85)', color: '#fff',
                      border: 'none', cursor: 'pointer', fontSize: 12, lineHeight: 1,
                    }}>×</button>
          </div>
        `)}
      </div>
    </div>
  `;
}

// ---- Result card (review & register) ---------------------------------------

function ResultCard({ result, accounts, depts, threshold, onFormChange, onRegister, onRemove }) {
  if (result.status === 'error') {
    return html`
      <div class="card" style=${{
        padding: 16, marginBottom: 10, borderLeft: '4px solid var(--danger)',
      }}>
        <div style=${{ fontWeight: 600, fontSize: 13 }}>${result.file.name}</div>
        <div class="note note-err" style=${{ marginTop: 8 }}>
          解析失敗: ${result.error}
        </div>
        <button class="btn btn-ghost" onClick=${onRemove} style=${{ marginTop: 8 }}>削除</button>
      </div>
    `;
  }
  if (result.status === 'registered') {
    return html`
      <div class="card" style=${{
        padding: 14, marginBottom: 10, borderLeft: '4px solid var(--success)',
        background: 'var(--success-soft)', color: 'var(--success)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style=${{ fontWeight: 600 }}>✓ 登録完了:</span>
        <span>${result.form.vendor} / ${formatYen(result.form.amount)}</span>
      </div>
    `;
  }
  if (result.status === 'uploading') {
    return html`
      <div class="card" style=${{ padding: 14, marginBottom: 10, fontSize: 13, color: 'var(--text-3)' }}>
        ⏳ アップロード中...
      </div>
    `;
  }

  const conf = result.data?.confidence || 0;
  const isHigh = conf >= threshold;

  return html`
    <div class="card" style=${{
      padding: 0, marginBottom: 12, overflow: 'hidden',
      borderLeft: '4px solid ' + (isHigh ? 'var(--success)' : 'var(--warning)'),
    }}>
      <div style=${{ padding: 14, display: 'flex', gap: 14 }}>
        <div style=${{
          width: 120, height: 160, flexShrink: 0,
          borderRadius: 8, overflow: 'hidden', background: 'var(--bg-alt)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          ${result.file.type.startsWith('image/')
            ? html`<img src=${result.previewUrl}
                        style=${{ width: '100%', height: '100%', objectFit: 'contain' }} />`
            : html`<div style=${{ fontSize: 40 }}>📄</div>`}
        </div>

        <div style=${{ flex: 1, minWidth: 0 }}>
          <div style=${{ display: 'flex', justifyContent: 'space-between',
                         alignItems: 'center', marginBottom: 10 }}>
            <div style=${{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style=${{
                fontSize: 11, padding: '3px 10px', borderRadius: 999,
                fontWeight: 600,
                background: isHigh ? 'var(--success-soft)' : '#fef3c7',
                color:      isHigh ? 'var(--success)'      : '#92400e',
              }}>信頼度 ${conf}%</span>
              ${isHigh && html`<span style=${{ fontSize: 11, color: 'var(--success)' }}>→ 自動登録対象</span>`}
            </div>
            <div style=${{ display: 'flex', gap: 6 }}>
              <button class="btn" onClick=${onRegister} disabled=${result.status !== 'ready'}
                      style=${{ background: 'var(--success)', boxShadow: '0 1px 3px rgba(16,185,129,0.25)' }}>
                ✓ 登録
              </button>
              <button class="btn btn-ghost" onClick=${onRemove}>破棄</button>
            </div>
          </div>

          ${result.error && html`
            <div class="note note-err" style=${{ marginBottom: 10, fontSize: 12 }}>
              ${result.error}
            </div>
          `}

          <div style=${{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr',
            gap: 8,
          }}>
            <${Field} label="日付" type="date" value=${result.form.date}
                     onInput=${v => onFormChange({ date: v })} />
            <${Field} label="取引先" value=${result.form.vendor}
                     onInput=${v => onFormChange({ vendor: v })} />
            <${FieldSelect} label="勘定科目" value=${result.form.category}
                           options=${accounts.map(a => ({ value: a.name, label: a.name }))}
                           onInput=${v => onFormChange({ category: v })} />
            <${Field} label="金額" value=${result.form.amount}
                     onInput=${v => onFormChange({ amount: v.replace(/[^\d.-]/g, '') })}
                     rightAlign />
          </div>
          <div style=${{
            display: 'grid', gridTemplateColumns: '1fr 1fr auto auto',
            gap: 8, marginTop: 8, alignItems: 'center',
          }}>
            <${FieldSelect} label="部門" value=${result.form.dept}
                           options=${[{ value: '', label: '--' }, ...depts.map(d => ({ value: d.name, label: d.name }))]}
                           onInput=${v => onFormChange({ dept: v })} />
            <${Field} label="メモ" value=${result.form.memo}
                     onInput=${v => onFormChange({ memo: v })} />
            <label style=${checkLabel}>
              <input type="checkbox" checked=${result.form.reducedTax}
                     onChange=${e => onFormChange({ reducedTax: e.target.checked })} />
              8%
            </label>
            <label style=${checkLabel}>
              <input type="checkbox" checked=${result.form.hasInvoice}
                     onChange=${e => onFormChange({ hasInvoice: e.target.checked })} />
              インボイス
            </label>
          </div>
          ${result.form.hasInvoice && html`
            <div style=${{ marginTop: 8 }}>
              <${Field} label="インボイス番号" value=${result.form.invoiceNumber}
                       onInput=${v => onFormChange({ invoiceNumber: v })}
                       placeholder="T0000000000000" mono />
              ${(result.form.invoiceNumber || '').trim()
                && !INVOICE_NUMBER_RE.test(result.form.invoiceNumber.trim()) && html`
                <div style=${{ fontSize: 11, color: '#b45309', marginTop: 4 }}>
                  ⚠ 登録番号が T+13桁 の形式と一致しません（例: T1234567890123）。このまま登録はできます。
                </div>
              `}
            </div>
          `}
          ${result.data?.notes && html`
            <div style=${{
              marginTop: 8, padding: '6px 10px', background: 'var(--bg-alt)',
              borderRadius: 6, fontSize: 11, color: 'var(--text-3)',
            }}>💡 ${result.data.notes}</div>
          `}
        </div>
      </div>
    </div>
  `;
}

function Field({ label, value, onInput, type = 'text', placeholder, rightAlign, mono }) {
  return html`
    <div>
      <div style=${fieldLabel}>${label}</div>
      <input type=${type} value=${value ?? ''} placeholder=${placeholder || ''}
             onInput=${e => onInput(e.target.value)}
             style=${{
               ...inputStyle,
               textAlign: rightAlign ? 'right' : 'left',
               fontFamily: mono || rightAlign ? 'var(--font-num)' : 'inherit',
             }} />
    </div>
  `;
}
function FieldSelect({ label, value, options, onInput }) {
  return html`
    <div>
      <div style=${fieldLabel}>${label}</div>
      <select value=${value ?? ''} onChange=${e => onInput(e.target.value)} style=${inputStyle}>
        ${options.map(o => html`<option key=${o.value} value=${o.value}>${o.label}</option>`)}
      </select>
    </div>
  `;
}

// ---- Claude API call (per-image) -------------------------------------------

async function analyzeOne(file, apiKey, accountNames, deptNames) {
  const base64 = await fileToBase64(file);
  const mediaType = file.type || 'image/jpeg';
  const isPdf = mediaType === 'application/pdf';

  const source = { type: 'base64', media_type: mediaType, data: base64 };
  const doc = isPdf ? { type: 'document', source } : { type: 'image', source };

  const prompt = [
    'このレシート/領収書の画像を解析し、以下のフィールドを JSON オブジェクトで返してください。',
    '',
    '- date: YYYY-MM-DD 形式（取引日）',
    '- vendor: 店名・発行者名（文字列）',
    '- items: 品目・内訳（文字列、カンマ区切り）',
    '- amount: 合計金額（税込、整数）',
    '- tax_rate: 主な税率（8 または 10）',
    '- reduced_tax: 軽減税率(8%)対象か（boolean）',
    '- invoice_number: インボイス登録番号 T+13桁、なければ空文字',
    '- has_invoice: インボイス対応か（boolean）',
    `- category: 推定勘定科目。以下から最も近いものを選択: ${accountNames.length ? accountNames.join('、') : '(マスタ未登録)'}`,
    `- department: 推定部門。以下から選択: ${deptNames.length ? deptNames.join('、') : '(マスタ未登録)'}`,
    '- confidence: 読み取り信頼度（0-100 の整数）',
    '- notes: 読み取りが不確実な部分の説明（短文）',
    '',
    '必ず JSON オブジェクトのみ返してください。マークダウンのコードブロックは不要です。',
  ].join('\n');

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [doc, { type: 'text', text: prompt }],
      }],
    }),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    const msg = body?.error?.message || resp.statusText || ('HTTP ' + resp.status);
    if (resp.status === 401) throw new Error('APIキーが無効です: ' + msg);
    if (resp.status === 429) throw new Error('レート制限。しばらく待って再試行してください');
    throw new Error(msg);
  }

  const data = await resp.json();
  const text = (data?.content || []).map(c => c.text || '').join('').trim();
  // Strip code fences defensively
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error('解析結果のパースに失敗: ' + cleaned.slice(0, 120));
  }
  // Accept either an object or a single-element array
  if (Array.isArray(parsed)) parsed = parsed[0] || {};
  return parsed;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('ファイル読み込み失敗'));
    r.readAsDataURL(file);
  });
}

function normalizeResult(parsed, accountNames, deptNames) {
  const today_ = today();
  const category = (parsed?.category && accountNames.includes(parsed.category))
    ? parsed.category : (accountNames[0] || '');
  const dept = (parsed?.department && deptNames.includes(parsed.department))
    ? parsed.department : '';
  return {
    date: parsed?.date || today_,
    vendor: parsed?.vendor || '',
    category,
    dept,
    amount: Number(parsed?.amount || 0),
    reducedTax: parsed?.tax_rate === 8 || !!parsed?.reduced_tax,
    hasInvoice: !!parsed?.has_invoice,
    invoiceNumber: parsed?.invoice_number || '',
    memo: parsed?.items || '',
  };
}

// ---- Styles ----------------------------------------------------------------

const inputStyle = {
  width: '100%', padding: '7px 10px',
  border: '1px solid var(--border)', borderRadius: 7,
  background: '#f8f9fc', fontFamily: 'inherit', fontSize: 12.5,
};
const fieldLabel = {
  fontSize: 10, color: 'var(--text-3)', fontWeight: 600, marginBottom: 3,
};
const checkLabel = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  fontSize: 12, color: 'var(--text-2)', fontWeight: 500,
  cursor: 'pointer', whiteSpace: 'nowrap',
};
