/* ============================================================
   NOVA Core v2 — Payroll / Payslip bulk mailer (明細送付)

   選択月の給与明細を PDF 化して各従業員のメールアドレスへ一括送信する。
   - バックエンド: Cloudflare Pages Functions
       GET  /api/payslip/status      … Gmail 連携状態
       GET  /api/auth/google/start   … OAuth 開始（画面遷移）
       POST /api/payslip/send        … 一括送信
   - PDF 生成: html2canvas + jsPDF（CDN から初回送信時に動的ロード）。
     payslip.js の Slip レイアウトを hidden 領域に描画してキャプチャする。
   - ローカル開発（python http.server 等）では /api/* が 404 になるため、
     その場合は案内を表示して送信ボタンを無効化する。
   ============================================================ */

import { h, render } from 'https://esm.sh/preact@10.22.0';
import { useState, useEffect, useMemo } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection, useDoc, orderBy } from '../../store.js';
import { formatYen, monthLabel, asArray } from '../../shared.js';
import { Slip, printStyle } from './payslip.js';

const html = htm.bind(h);

const EMAIL_RE = /.+@.+\..+/;

// ---- PDF ライブラリ（CDN）動的ロード ----------------------------------------

const CDN_HTML2CANVAS = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
const CDN_JSPDF       = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

let _libsPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('スクリプトの読み込みに失敗しました: ' + src));
    document.head.appendChild(s);
  });
}

function loadPdfLibs() {
  if (window.html2canvas && window.jspdf) return Promise.resolve();
  if (!_libsPromise) {
    _libsPromise = Promise.all([
      window.html2canvas ? Promise.resolve() : loadScript(CDN_HTML2CANVAS),
      window.jspdf       ? Promise.resolve() : loadScript(CDN_JSPDF),
    ]).catch(e => { _libsPromise = null; throw e; });
  }
  return _libsPromise;
}

// ---- 1人分の明細 → A4縦 PDF（base64） ---------------------------------------
// payslip.js の Slip + printStyle を hidden 領域に描画してキャプチャする。

async function buildPdfBase64(rec, issuer) {
  const stage = document.createElement('div');
  // 画面外・非表示にしない（display:none だと html2canvas が描画できない）
  stage.style.cssText = 'position:fixed;left:-9999px;top:0;background:#fff;pointer-events:none;';
  document.body.appendChild(stage);
  try {
    render(html`
      <div style=${{ background: '#fff' }}>
        <style>
          /* キャプチャ用: 画面プレビュー専用要素（会社名未設定の注記等）と影を消す */
          .psm-pdf-stage .no-print { display: none !important; }
          .psm-pdf-stage .payslip-paper { box-shadow: none !important; margin: 0 !important; }
        </style>
        ${printStyle}
        <div class="psm-pdf-stage">
          <${Slip} rec=${rec} issuer=${issuer} kind="monthly" />
        </div>
      </div>
    `, stage);
    // レイアウト反映を待つ
    await new Promise(r => setTimeout(r, 50));
    const node = stage.querySelector('.payslip-paper') || stage;

    const canvas = await window.html2canvas(node, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
    });
    const imgData = canvas.toDataURL('image/jpeg', 0.92);

    const JsPDF = window.jspdf.jsPDF;
    const pdf = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const imgRatio = canvas.width / canvas.height;
    let w = pdfW - margin * 2;
    let hgt = w / imgRatio;
    if (hgt > pdfH - margin * 2) { hgt = pdfH - margin * 2; w = hgt * imgRatio; }
    pdf.addImage(imgData, 'JPEG', (pdfW - w) / 2, margin, w, hgt, undefined, 'FAST');

    // "data:application/pdf;base64,...." → base64 部分のみ
    const dataUri = pdf.output('datauristring');
    return dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
  } finally {
    render(null, stage);
    stage.remove();
  }
}

// ---- メインタブ --------------------------------------------------------------

export function MailerTab() {
  const records   = useCollection(repos.payrollRecords, () => [orderBy('month', 'desc')]);
  const employees = useCollection(repos.payrollEmployees);
  const issuerQ   = useDoc(repos.settings, 'invoiceIssuer');

  // Gmail 連携状態: null=確認中 / {mode:'local'} / {mode:'api', ...status}
  const [gmail, setGmail] = useState(null);
  const [month, setMonth] = useState('');
  const [sel, setSel]     = useState(null);   // null = デフォルト（メアド有効者全員）
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy]   = useState(false);
  const [phase, setPhase] = useState('');
  const [outcome, setOutcome] = useState(null);  // { error } | { summary, results }
  const [notice, setNotice]   = useState('');

  const rows = asArray(records.data);
  const empList = asArray(employees.data);
  const issuer = issuerQ.data || {};

  // 連携状態の取得（マウント時1回）
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/payslip/status', { headers: { accept: 'application/json' } });
        const ct = res.headers.get('content-type') || '';
        if (!res.ok || !ct.includes('json')) {
          // ローカル開発サーバー（python http.server 等）は /api/* が 404
          if (alive) setGmail({ mode: 'local' });
          return;
        }
        const data = await res.json();
        if (alive) setGmail({ mode: 'api', ...data });
      } catch {
        if (alive) setGmail({ mode: 'local' });
      }
    })();
    return () => { alive = false; };
  }, []);

  // OAuth から戻ってきたときのハッシュフラグ
  useEffect(() => {
    const hsh = location.hash || '';
    if (hsh.includes('gmail_connected=1')) {
      setNotice('✅ Gmail 連携が完了しました。');
      history.replaceState(null, '', location.pathname + location.search);
    } else if (hsh.includes('gmail_error=')) {
      const m = hsh.match(/gmail_error=([^&]+)/);
      setNotice('❌ Gmail 連携に失敗しました: ' + (m ? decodeURIComponent(m[1]) : 'unknown'));
      history.replaceState(null, '', location.pathname + location.search);
    }
  }, []);

  // 月の選択肢（レコードがある月）。初期値は最新月。
  const months = useMemo(() => {
    const set = new Set(rows.map(r => r.month).filter(Boolean));
    return [...set].sort().reverse();
  }, [rows]);

  useEffect(() => {
    if (!month && months.length > 0) setMonth(months[0]);
  }, [months, month]);

  // 月が変わったら選択状態をリセット
  useEffect(() => { setSel(null); setOutcome(null); }, [month]);

  // 対象者一覧: 選択月のレコード + 従業員マスタのメアド
  const empMap = useMemo(() => new Map(empList.map(e => [e.id, e])), [empList]);
  const targets = useMemo(() => {
    return rows
      .filter(r => r.month === month)
      .slice()
      .sort((a, b) => (a.empName || '').localeCompare(b.empName || '', 'ja'))
      .map(r => {
        const email = ((empMap.get(r.empId) || {}).email || '').trim();
        return { rec: r, email, emailOk: EMAIL_RE.test(email) };
      });
  }, [rows, month, empMap]);

  // 選択集合（デフォルト = メアド有効者全員）
  const selected = sel ?? new Set(targets.filter(t => t.emailOk).map(t => t.rec.empId));

  function toggle(empId) {
    const next = new Set(selected);
    if (next.has(empId)) next.delete(empId); else next.add(empId);
    setSel(next);
  }

  const sendList = targets.filter(t => t.emailOk && selected.has(t.rec.empId));

  const isLocal = gmail?.mode === 'local';
  const apiReady = gmail?.mode === 'api' && gmail.ok;
  const canSend = !busy && apiReady && sendList.length > 0;

  // ---- 送信 ------------------------------------------------------------------

  async function send() {
    if (busy || sendList.length === 0) return;

    const test = testTo.trim();
    if (test && !EMAIL_RE.test(test)) {
      alert('テスト送信先のメールアドレスの形式が正しくありません');
      return;
    }
    const confirmMsg = test
      ? `【テスト送信】${monthLabel(month)} の給与明細 ${sendList.length} 名分を、すべて ${test} 宛に送信します。\nよろしいですか？`
      : `${monthLabel(month)} の給与明細を ${sendList.length} 名に送信します。\n（各従業員の登録メールアドレス宛）\n\nよろしいですか？`;
    if (!confirm(confirmMsg)) return;

    setBusy(true);
    setOutcome(null);
    try {
      setPhase('PDFライブラリを読込中...');
      await loadPdfLibs();

      // PDF を1人ずつ生成（重い処理なので進捗を出す）
      const items = [];
      const genErrors = [];
      for (let i = 0; i < sendList.length; i++) {
        const { rec, email } = sendList[i];
        setPhase(`PDF生成中 ${i + 1} / ${sendList.length}（${rec.empName}）`);
        try {
          const base64 = await buildPdfBase64(rec, issuer);
          const safeName = (rec.empName || String(rec.empId)).replace(/[\\/:*?"<>|\s]/g, '');
          items.push({
            staff_id: rec.empId,
            name: rec.empName,
            email,
            pdf_base64: base64,
            filename: `${month}-${safeName}-給与明細.pdf`,
          });
        } catch (e) {
          console.error('[mailer] PDF生成失敗:', rec.empName, e);
          genErrors.push({
            staff_id: rec.empId, staff_name: rec.empName,
            status: 'failed', error: 'PDF生成失敗: ' + (e.message || e),
          });
        }
      }

      if (items.length === 0) {
        setOutcome({ summary: { sent: 0, skipped: 0, failed: genErrors.length }, results: genErrors });
        return;
      }

      setPhase(`メール送信中...（${items.length} 件）`);
      const [y, m] = month.split('-').map(Number);
      const body = { items, year: y, month: m };
      if (test) body.test_to = test;

      let res, data;
      try {
        res = await fetch('/api/payslip/send', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        data = await res.json().catch(() => ({}));
      } catch (e) {
        setOutcome({ error: '通信エラー: メール送信は本番環境（Cloudflare Pages）でのみ利用できます。' });
        return;
      }
      if (!res.ok) {
        setOutcome({ error: '送信失敗: ' + (data.message || data.error || `HTTP ${res.status}`) });
        return;
      }
      setOutcome({
        summary: data.summary || { sent: 0, skipped: 0, failed: 0 },
        results: [...(data.results || []), ...genErrors],
        testTo: test || null,
      });
    } catch (e) {
      setOutcome({ error: String(e.message || e) });
    } finally {
      setBusy(false);
      setPhase('');
    }
  }

  // ---- 描画 ------------------------------------------------------------------

  return html`
    <div>
      ${notice && html`
        <div class="note note-info" style=${{ marginBottom: 12 }}>${notice}</div>
      `}

      <${StatusCard} gmail=${gmail} />

      <div class="card" style=${{ padding: 16, marginBottom: 16 }}>
        <div style=${{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style=${{ fontWeight: 700, fontSize: 14 }}>対象月</div>
          <select value=${month} onChange=${e => setMonth(e.target.value)}
                  disabled=${busy} style=${selectCompact}>
            ${months.length === 0 && html`<option value="">（給与計算結果なし）</option>`}
            ${months.map(m => html`<option key=${m} value=${m}>${monthLabel(m)}</option>`)}
          </select>
          <div style=${{ fontSize: 12, color: 'var(--text-3)' }}>
            月次給与で計算済みの従業員が対象になります
          </div>
        </div>
      </div>

      ${targets.length === 0 ? html`
        <div class="card" style=${{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-3)' }}>
          <div style=${{ fontSize: 32, marginBottom: 10, opacity: .4 }}>📧</div>
          ${months.length === 0
            ? '給与計算結果がまだありません（月次給与タブで計算してください）'
            : 'この月の給与計算結果がありません'}
        </div>
      ` : html`
        <div class="card" style=${{ padding: 0, overflow: 'auto', marginBottom: 16 }}>
          <table style=${{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style=${{ background: 'var(--bg-alt)' }}>
                <th style=${{ ...th, width: 36 }}></th>
                <th style=${th}>氏名</th>
                <th style=${th}>メールアドレス</th>
                <th style=${{ ...th, textAlign: 'right' }}>総支給</th>
                <th style=${{ ...th, textAlign: 'right' }}>差引支給</th>
              </tr>
            </thead>
            <tbody>
              ${targets.map(t => html`
                <tr key=${t.rec.empId} style=${{
                  borderTop: '1px solid var(--border-2)',
                  background: t.emailOk ? 'transparent' : 'rgba(245, 158, 11, 0.08)',
                }}>
                  <td style=${{ ...td, textAlign: 'center' }}>
                    <input type="checkbox"
                           checked=${t.emailOk && selected.has(t.rec.empId)}
                           disabled=${!t.emailOk || busy}
                           onChange=${() => toggle(t.rec.empId)} />
                  </td>
                  <td style=${{ ...td, fontWeight: 600 }}>${t.rec.empName}</td>
                  <td style=${td}>
                    ${t.emailOk ? html`
                      <span style=${{ fontFamily: 'var(--font-num)', fontSize: 12 }}>${t.email}</span>
                    ` : html`
                      <span style=${{ color: '#b45309', fontSize: 12 }}>
                        ⚠ ${t.email ? 'メールアドレスの形式が不正です' : '未登録'} — 従業員マスタで登録してください
                      </span>
                    `}
                  </td>
                  <td class="num" style=${{ ...td, textAlign: 'right' }}>${formatYen(t.rec.gross)}</td>
                  <td class="num" style=${{ ...td, textAlign: 'right', fontWeight: 700, color: 'var(--primary)' }}>
                    ${formatYen(t.rec.net)}
                  </td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>

        <div class="card" style=${{ padding: 16 }}>
          <div style=${{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
            <div style=${{ flex: '1 1 260px', maxWidth: 360 }}>
              <div style=${{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, marginBottom: 4 }}>
                テスト送信先（任意）
              </div>
              <input type="email" placeholder="test@example.com"
                     value=${testTo} disabled=${busy}
                     onInput=${e => setTestTo(e.target.value)}
                     style=${{
                       width: '100%', padding: '9px 12px',
                       border: '1px solid var(--border)', borderRadius: 8,
                       background: 'var(--surface)', fontSize: 13,
                     }} />
              <div style=${{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                入力すると本人には送らず、全員分がこのアドレスに送信されます
              </div>
            </div>
            <div style=${{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              ${busy && html`
                <div style=${{ fontSize: 12, color: 'var(--text-2)', fontWeight: 600 }}>
                  <span class="num">${phase}</span>
                </div>
              `}
              <button class="btn" onClick=${send} disabled=${!canSend}
                      style=${{ minWidth: 200 }}>
                ${busy
                  ? '処理中...'
                  : (testTo.trim()
                      ? `📧 テスト送信（${sendList.length} 名分）`
                      : `📧 ${sendList.length} 名に送信`)}
              </button>
              ${isLocal && html`
                <div style=${{ fontSize: 11, color: 'var(--text-3)' }}>
                  ローカル環境では送信できません
                </div>
              `}
            </div>
          </div>
        </div>
      `}

      ${outcome && html`<${ResultPanel} outcome=${outcome} />`}
    </div>
  `;
}

// ---- 連携状態カード -----------------------------------------------------------

function StatusCard({ gmail }) {
  let body;
  if (gmail === null) {
    body = html`<div style=${{ color: 'var(--text-3)', fontSize: 13 }}>Gmail 連携状態を確認中...</div>`;
  } else if (gmail.mode === 'local') {
    body = html`
      <div class="note note-warn" style=${{ margin: 0 }}>
        ⚠ メール送信は本番環境（Cloudflare Pages）でのみ利用できます。<br/>
        ローカル開発サーバーでは /api/* が利用できないため、送信機能は無効です。
      </div>
    `;
  } else if (!gmail.config?.has_client_id || !gmail.config?.has_client_secret || !gmail.config?.has_sender) {
    const missing = [
      !gmail.config?.has_client_id && 'GOOGLE_CLIENT_ID',
      !gmail.config?.has_client_secret && 'GOOGLE_CLIENT_SECRET',
      !gmail.config?.has_sender && 'GMAIL_SENDER',
    ].filter(Boolean).join(', ');
    body = html`
      <div class="note note-warn" style=${{ margin: 0 }}>
        ⚠ サーバー側の設定が不足しています: <b>${missing}</b><br/>
        Cloudflare Pages の環境変数を設定してください。
      </div>
    `;
  } else if (!gmail.connection?.connected) {
    body = html`
      <div style=${{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style=${{ fontSize: 13 }}>
          <span style=${{ color: '#b45309', fontWeight: 700 }}>● 未連携</span>
          <span style=${{ marginLeft: 8, color: 'var(--text-2)' }}>
            Gmail から送信するには Google アカウントとの連携が必要です
          </span>
        </div>
        <button class="btn" style=${{ marginLeft: 'auto' }}
                onClick=${() => { location.href = '/api/auth/google/start'; }}>
          🔗 Googleと連携する
        </button>
      </div>
    `;
  } else {
    body = html`
      <div style=${{ fontSize: 13 }}>
        <span style=${{ color: '#059669', fontWeight: 700 }}>● 連携済み</span>
        <span style=${{ marginLeft: 8, color: 'var(--text-2)' }}>
          送信元: <b style=${{ color: 'var(--text)' }}>${gmail.config?.sender || '-'}</b>
        </span>
      </div>
    `;
  }
  return html`
    <div class="card" style=${{ padding: 16, marginBottom: 16 }}>
      <div style=${{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700,
                     textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
        Gmail 連携
      </div>
      ${body}
    </div>
  `;
}

// ---- 送信結果パネル -----------------------------------------------------------

const STATUS_VIEW = {
  sent:    { icon: '✅', color: '#059669', label: '送信' },
  skipped: { icon: '⏭', color: '#b45309', label: 'スキップ' },
  failed:  { icon: '❌', color: '#dc2626', label: '失敗' },
};

function ResultPanel({ outcome }) {
  if (outcome.error) {
    return html`
      <div class="card" style=${{ padding: 16, marginTop: 16 }}>
        <div style=${{ color: '#dc2626', fontWeight: 700, fontSize: 13 }}>❌ ${outcome.error}</div>
      </div>
    `;
  }
  const sum = outcome.summary || { sent: 0, skipped: 0, failed: 0 };
  return html`
    <div class="card" style=${{ padding: 16, marginTop: 16 }}>
      <div style=${{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700,
                     textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>
        送信結果${outcome.testTo ? `（テスト送信 → ${outcome.testTo}）` : ''}
      </div>
      <div style=${{ display: 'flex', gap: 14, marginBottom: 12, fontSize: 13, fontWeight: 700 }}>
        <span style=${{ color: '#059669' }}>✅ 送信 ${sum.sent} 件</span>
        <span style=${{ color: '#b45309' }}>⏭ スキップ ${sum.skipped} 件</span>
        <span style=${{ color: '#dc2626' }}>❌ 失敗 ${sum.failed} 件</span>
      </div>
      <div>
        ${(outcome.results || []).map((r, i) => {
          const v = STATUS_VIEW[r.status] || STATUS_VIEW.failed;
          return html`
            <div key=${i} style=${{ fontSize: 12.5, padding: '3px 0', color: v.color }}>
              ${v.icon} ${r.staff_name}${r.error ? html` — <span>${r.error}</span>` : ''}
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

// ---- styles -----------------------------------------------------------------

const selectCompact = {
  padding: '8px 10px', border: '1px solid var(--border)',
  borderRadius: 8, background: 'var(--surface)', fontSize: 12,
};
const th = {
  padding: '10px 14px', textAlign: 'left',
  color: 'var(--text-3)', fontWeight: 600, fontSize: 11,
  textTransform: 'uppercase', letterSpacing: '0.04em',
};
const td = {
  padding: '10px 14px',
};
