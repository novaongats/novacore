/* ============================================================
   NOVA Core v2 — Invoices / A4 Preview & print
   Renders a full A4 layout suitable for printing to PDF.

   印刷: PrintPortal（v2/print.js）で overlay を body 直下に描画し、
   印刷時は #app を display:none で丸ごと消す（styles.css の
   body.has-print-overlay ルールと対）。visibility ハックは不要になり、
   通常フローで複数ページの改ページが正しく機能する。

   適格請求書: 税額サマリーは税率ごとに区分した対価の額・適用税率・
   税率ごとの消費税額を表示（calcTotals の byRate）。請求書型では
   hideTaxBreakdown に関わらず必ず表示する（法定記載事項）。

   デザイン: NOVA Precision Dark 由来のブランドヘッダー（Nロゴ +
   英日タイトル）、ヘアライン主体の明細テーブル、インディゴアクセントの
   合計ブロック。アクセントは最小限に留め、モノクロ印刷でも成立する
   （強調は 罫線 + ウェイト + サイズ で担保し、色は補助）。
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import htm from 'https://esm.sh/htm@3.1.1';
import { formatYen } from '../../shared.js';
import { calcTotals, DOC_TYPE_MAP } from './calc.js';
import { PrintPortal } from '../../print.js';

const html = htm.bind(h);

// ---- Title & prompt per document type --------------------------------------

const TITLE_MAP = {
  invoice:  '請求書',
  receipt:  '領収書',
  quote:    '御見積書',
  delivery: '納品書',
};

// 英字大型タイトル（和文タイトルから引く: TitleBlock の props を変えないため）
const EN_TITLE_MAP = {
  '請求書':   'INVOICE',
  '領収書':   'RECEIPT',
  '御見積書': 'QUOTE',
  '納品書':   'DELIVERY NOTE',
};

const PROMPT_MAP = {
  invoice:  '下記の通り御請求申し上げます。',
  receipt:  '下記の通り正に領収いたしました。',
  quote:    '下記の通り御見積り申し上げます。',
  delivery: '下記の通り御納品致します。',
};

// ---- Main preview component ------------------------------------------------

export function PreviewOverlay({ doc, onClose }) {
  if (!doc) return null;

  function handlePrint() {
    window.print();
  }

  return html`
    <${PrintPortal}>
      <div class="preview-overlay">
        <div class="preview-toolbar no-print">
          <div style=${{ color: '#fff', fontWeight: 600 }}>
            ${TITLE_MAP[doc.type] || '書類'} プレビュー
            <span style=${{ marginLeft: 10, fontSize: 12, opacity: 0.7, fontFamily: 'var(--font-mono)' }}>
              ${doc.docNumber || '（保存時に採番）'}
            </span>
          </div>
          <div style=${{ display: 'flex', gap: 8 }}>
            <button class="btn" onClick=${handlePrint}
                    style=${{ background: '#10b981', boxShadow: '0 1px 3px rgba(16,185,129,0.25)' }}>
              🖨 印刷 / PDF保存
            </button>
            <button class="btn btn-ghost" onClick=${onClose}
                    style=${{ background: 'rgba(255,255,255,0.12)', color: '#fff', borderColor: 'transparent' }}>
              ✕ 閉じる
            </button>
          </div>
        </div>

        <div class="preview-a4-wrap">
          <${A4Document} doc=${doc} />
        </div>

        ${printCss}
      </div>
    </${PrintPortal}>
  `;
}

// ---- A4 layout -------------------------------------------------------------

function A4Document({ doc }) {
  const title = TITLE_MAP[doc.type] || '書類';
  const prompt = PROMPT_MAP[doc.type] || '';
  const totals = calcTotals(doc.items || []);
  const isInvoice  = doc.type === 'invoice';
  const isReceipt  = doc.type === 'receipt';
  const isQuote    = doc.type === 'quote';
  const isDelivery = doc.type === 'delivery';
  const isVoided   = doc.status === 'void' || doc.status === 'cancelled';

  // 適格請求書（invoice）では税率別内訳の記載が必須のため hideTaxBreakdown を無効化
  const showTaxSep = isInvoice || !doc.hideTaxBreakdown;

  // フッター: 発行会社の住所・登録番号（記載データの再掲・見た目のみ）
  const footerParts = [
    doc.issuerCompany || '',
    (doc.issuerPostal || doc.issuerAddress)
      ? ((doc.issuerPostal ? ('〒' + doc.issuerPostal + ' ') : '') + (doc.issuerAddress || ''))
      : '',
    doc.issuerPhone ? ('TEL: ' + doc.issuerPhone) : '',
    doc.issuerInvoiceNumber ? ('登録番号 ' + doc.issuerInvoiceNumber) : '',
  ].filter(Boolean);

  return html`
    <div class="invoice-a4">
      ${isVoided && html`<div class="invoice-void-badge">取　消</div>`}

      <div class="invoice-doc-header">
        <div class="invoice-brand">
          <div class="invoice-brand-logo">N</div>
          ${doc.issuerCompany && html`
            <div class="invoice-brand-name">${doc.issuerCompany}</div>
          `}
        </div>
        <${TitleBlock} title=${title} />
      </div>

      <${MetaBlock} doc=${doc} showDue=${isInvoice} showExpiry=${isQuote} />

      <${PromptLine} text=${prompt} />

      <${GrandTotal} totals=${totals} showTaxIncluded=${doc.showTaxIncluded} label=${isReceipt ? '領収金額' : isQuote ? '御見積金額' : '合計金額'} />

      ${isReceipt && html`
        <div class="invoice-proviso">但し ${doc.proviso || 'お品代として'}</div>
      `}

      <${ItemsTable} items=${doc.items || []} />

      ${showTaxSep && html`<${TaxSummary} totals=${totals} />`}

      ${doc.notes && html`
        <div class="invoice-notes">
          <div class="invoice-notes-label">備考</div>
          <div class="invoice-notes-body">${doc.notes}</div>
        </div>
      `}

      ${isInvoice && doc.bankName && html`
        <${BankBlock} doc=${doc} />
      `}

      ${isReceipt && html`<${StampArea} showRevenueStamp=${totals.total >= 50000} />`}

      <div class="invoice-footer">
        <div class="invoice-footer-issuer">${footerParts.join('　·　')}</div>
        <div class="invoice-footer-credit">NOVA Core</div>
      </div>
    </div>
  `;
}

// ---- Blocks ----------------------------------------------------------------

function TitleBlock({ title }) {
  const en = EN_TITLE_MAP[title] || 'DOCUMENT';
  return html`
    <div class="invoice-title-block">
      <div class="invoice-title-en">${en}</div>
      <div class="invoice-title">${title}</div>
    </div>
  `;
}

function MetaBlock({ doc, showDue, showExpiry }) {
  return html`
    <div class="invoice-meta">
      <div class="invoice-client">
        <div class="invoice-client-name">
          ${doc.clientCompany || '（宛先未入力）'}
          <span class="invoice-client-honorific">${doc.clientHonorific || '御中'}</span>
        </div>
        ${(doc.clientPostal || doc.clientAddress) && html`
          <div class="invoice-client-address">
            ${doc.clientPostal && ('〒' + doc.clientPostal + '　')}
            ${doc.clientAddress || ''}
          </div>
        `}
        ${doc.clientContact && html`
          <div class="invoice-client-contact">ご担当：${doc.clientContact} 様</div>
        `}
      </div>

      <div class="invoice-issuer">
        <div class="invoice-meta-rows">
          <div class="invoice-meta-row">
            <span class="invoice-meta-label">${showDue ? '請求番号' : showExpiry ? '見積番号' : '書類番号'}</span>
            <span class="invoice-meta-value mono">${doc.docNumber || '-'}</span>
          </div>
          <div class="invoice-meta-row">
            <span class="invoice-meta-label">発行日</span>
            <span class="invoice-meta-value num">${formatDate(doc.issueDate)}</span>
          </div>
          ${showDue && doc.dueDate && html`
            <div class="invoice-meta-row">
              <span class="invoice-meta-label">お支払期限</span>
              <span class="invoice-meta-value num">${formatDate(doc.dueDate)}</span>
            </div>
          `}
          ${showExpiry && doc.dueDate && html`
            <div class="invoice-meta-row">
              <span class="invoice-meta-label">有効期限</span>
              <span class="invoice-meta-value num">${formatDate(doc.dueDate)}</span>
            </div>
          `}
        </div>

        <div class="invoice-issuer-box">
          <div class="invoice-issuer-name">${doc.issuerCompany || ''}</div>
          ${(doc.issuerPostal || doc.issuerAddress) && html`
            <div class="invoice-issuer-addr">
              ${doc.issuerPostal && ('〒' + doc.issuerPostal + '　')}
              ${doc.issuerAddress || ''}
            </div>
          `}
          ${doc.issuerPhone && html`<div class="invoice-issuer-addr">TEL: ${doc.issuerPhone}</div>`}
          ${doc.issuerContact && html`<div class="invoice-issuer-addr">${doc.issuerContact}</div>`}
          ${doc.issuerInvoiceNumber && html`
            <div class="invoice-issuer-invnum">
              登録番号 <span class="mono">${doc.issuerInvoiceNumber}</span>
            </div>
          `}
        </div>
      </div>
    </div>
  `;
}

function PromptLine({ text }) {
  if (!text) return null;
  return html`<div class="invoice-prompt">${text}</div>`;
}

function GrandTotal({ totals, showTaxIncluded, label }) {
  return html`
    <div class="invoice-grand-total">
      <div class="invoice-grand-total-label">${label}</div>
      <div class="invoice-grand-total-value num">
        ${formatYen(totals.total)}
        ${showTaxIncluded && html`<span class="invoice-grand-total-taxinc">（税込）</span>`}
      </div>
    </div>
  `;
}

function ItemsTable({ items }) {
  return html`
    <table class="invoice-items">
      <thead>
        <tr>
          <th style=${{ width: '8%' }}>#</th>
          <th>品名</th>
          <th style=${{ width: '10%', textAlign: 'right' }}>数量</th>
          <th style=${{ width: '8%' }}>単位</th>
          <th style=${{ width: '16%', textAlign: 'right' }}>単価</th>
          <th style=${{ width: '8%' }}>税</th>
          <th style=${{ width: '18%', textAlign: 'right' }}>金額</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((it, idx) => {
          const qty = Number(it.quantity) || 0;
          const price = Number(it.unitPrice) || 0;
          const gross = Math.round(qty * price);
          return html`
            <tr key=${idx}>
              <td class="num">${idx + 1}</td>
              <td class="invoice-items-name">
                ${it.name || ''}
                ${it.memo && html`<div class="invoice-items-memo">${it.memo}</div>`}
              </td>
              <td class="num" style=${{ textAlign: 'right' }}>${qty ? qty.toLocaleString() : ''}</td>
              <td>${it.unit || ''}</td>
              <td class="num" style=${{ textAlign: 'right' }}>${price ? formatYen(price) : ''}</td>
              <td style=${{ textAlign: 'center', fontSize: 11 }}>
                ${it.taxType === '8' ? '8%※' : it.taxType === 'nt' ? '非' : ''}
              </td>
              <td class="num" style=${{ textAlign: 'right' }}>${gross ? formatYen(gross) : ''}</td>
            </tr>
          `;
        })}
        ${/* Fill empty rows to keep table consistent height */
          Array.from({ length: Math.max(0, 6 - items.length) }).map((_, i) => html`
            <tr key=${'empty-' + i}>
              <td>${' '}</td><td></td><td></td><td></td><td></td><td></td><td></td>
            </tr>
          `)}
      </tbody>
    </table>
    ${items.some(i => i.taxType === '8') && html`
      <div class="invoice-reduced-note">※ 軽減税率（8%）対象</div>
    `}
  `;
}

/**
 * 税額サマリー（適格請求書の法定記載事項）:
 * 税率ごとに区分した対価の額（税抜）、適用税率、税率ごとの消費税額を表示。
 * 8% 対象が 0 件なら 10% のみ表示（byRate の gross が 0 の税率は省略）。
 */
function TaxSummary({ totals }) {
  const byRate = totals.byRate || {};
  const r10 = byRate['10'] || { net: 0, tax: 0, gross: 0 };
  const r8  = byRate['8']  || { net: 0, tax: 0, gross: 0 };
  const r0  = byRate['0']  || { net: 0, tax: 0, gross: 0 };
  return html`
    <table class="invoice-tax-summary">
      <tr>
        <th>小計（税抜）</th>
        <td class="num">${formatYen(totals.subtotal)}</td>
      </tr>
      ${r10.gross !== 0 && html`
        <tr>
          <th>10%対象（税抜）</th>
          <td class="num">${formatYen(r10.net)}</td>
        </tr>
        <tr>
          <th>消費税（10%）</th>
          <td class="num">${formatYen(r10.tax)}</td>
        </tr>
      `}
      ${r8.gross !== 0 && html`
        <tr>
          <th>8%対象・軽減（税抜）</th>
          <td class="num">${formatYen(r8.net)}</td>
        </tr>
        <tr>
          <th>消費税（8%）</th>
          <td class="num">${formatYen(r8.tax)}</td>
        </tr>
      `}
      ${r0.gross !== 0 && html`
        <tr>
          <th>非課税対象</th>
          <td class="num">${formatYen(r0.net)}</td>
        </tr>
      `}
      <tr class="invoice-tax-summary-total">
        <th>合計金額</th>
        <td class="num">${formatYen(totals.total)}</td>
      </tr>
    </table>
  `;
}

function BankBlock({ doc }) {
  return html`
    <div class="invoice-bank">
      <div class="invoice-bank-title">お振込先</div>
      <table class="invoice-bank-table">
        <tr>
          <th>銀行名</th>
          <td>${doc.bankName || ''} ${doc.bankBranch || ''}</td>
        </tr>
        <tr>
          <th>口座種別</th>
          <td>${doc.bankAccountType || '普通'}</td>
        </tr>
        <tr>
          <th>口座番号</th>
          <td class="mono">${doc.bankAccountNumber || ''}</td>
        </tr>
        <tr>
          <th>口座名義</th>
          <td>${doc.bankAccountHolder || ''}
            ${doc.bankAccountHolderKana && html`<span style=${{ marginLeft: 8, fontSize: 10, color: '#64748b' }}>
              (${doc.bankAccountHolderKana})
            </span>`}
          </td>
        </tr>
      </table>
    </div>
  `;
}

function StampArea({ showRevenueStamp }) {
  return html`
    <div class="invoice-stamp">
      ${showRevenueStamp && html`
        <div class="invoice-revenue-stamp">
          <div class="invoice-revenue-stamp-box">収入印紙</div>
          <div class="invoice-revenue-stamp-note">5万円以上</div>
        </div>
      `}
      <div class="invoice-stamp-box">印</div>
    </div>
  `;
}

// ---- Helpers ---------------------------------------------------------------

function formatDate(d) {
  if (!d) return '-';
  const [y, m, day] = String(d).split('-');
  if (!y || !m || !day) return d;
  return `${y}年${parseInt(m)}月${parseInt(day)}日`;
}

// ---- CSS (injected once per component render, deduped by id) ---------------

const printCss = html`
<style>
  /* Screen overlay */
  .preview-overlay {
    position: fixed; inset: 0;
    background: rgba(10, 12, 22, 0.9);
    z-index: 99999;
    display: flex; flex-direction: column;
  }
  .preview-toolbar {
    padding: 12px 20px;
    background: #161a26;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    display: flex; justify-content: space-between; align-items: center;
    flex-shrink: 0;
  }
  .preview-a4-wrap {
    flex: 1; overflow: auto;
    padding: 36px 30px 56px;
    display: flex; justify-content: center; align-items: flex-start;
    background: #232936;
  }

  /* A4 page
     画面表示は flex column（フッターを margin-top:auto で最下部へ）。
     印刷時は display:block に戻す（flex はページ分割と相性が悪いため）。 */
  .invoice-a4 {
    position: relative;
    width: 210mm;
    min-height: 297mm;
    padding: 16mm 18mm 12mm;
    background: #fff;
    color: #0f172a;
    font-family: 'Noto Sans JP', 'Hiragino Kaku Gothic ProN', sans-serif;
    font-size: 10.5pt;
    line-height: 1.65;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
    box-sizing: border-box;
    display: flex; flex-direction: column;
  }
  /* 等幅数字（styles.css の .num に依存せず自前でも定義しておく） */
  .invoice-a4 .num {
    font-family: 'Inter', 'Sora', 'Noto Sans JP', sans-serif;
    font-feature-settings: 'tnum' 1, 'lnum' 1;
  }
  .invoice-a4 .mono { font-family: 'JetBrains Mono', 'Menlo', monospace; }

  /* Void (取消) badge — 1ページ目中央に斜めの取消スタンプ（透かし風）。
     % ではなく mm 指定なので、複数ページ時も印刷1ページ目に載る。 */
  .invoice-void-badge {
    position: absolute;
    top: 100mm; left: 50%;
    padding: 8pt 30pt;
    border: 3pt solid #dc2626;
    border-radius: 6pt;
    color: #dc2626;
    font-size: 34pt;
    font-weight: 800;
    letter-spacing: 0.4em;
    padding-right: calc(30pt - 0.4em);
    white-space: nowrap;
    transform: translateX(-50%) rotate(-10deg);
    opacity: 0.32;
    z-index: 2;
    pointer-events: none;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* Brand header: N logo + issuer | large EN/JP title */
  .invoice-doc-header {
    display: flex; justify-content: space-between; align-items: flex-end;
    gap: 16pt;
    padding-bottom: 10pt;
    border-bottom: 2pt solid #0f172a;
    margin-bottom: 14pt;
  }
  .invoice-brand {
    display: flex; align-items: center; gap: 8pt;
    padding-bottom: 3pt;
  }
  .invoice-brand-logo {
    width: 24pt; height: 24pt;
    border-radius: 6pt;
    background: #6366f1;
    color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-family: 'Sora', 'Inter', sans-serif;
    font-weight: 800;
    font-size: 14pt;
    line-height: 1;
    flex-shrink: 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .invoice-brand-name {
    font-size: 12pt;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .invoice-title-block {
    text-align: right;
  }
  .invoice-title-en {
    font-family: 'Sora', 'Inter', sans-serif;
    font-size: 24pt;
    font-weight: 700;
    letter-spacing: 0.06em;
    line-height: 1.05;
    white-space: nowrap;
  }
  .invoice-title {
    font-size: 9pt;
    font-weight: 600;
    letter-spacing: 0.45em;
    margin-right: -0.45em;  /* compensate letter-spacing */
    margin-top: 3pt;
    color: #6366f1;
  }

  /* Meta block (client + doc meta / issuer) */
  .invoice-meta {
    display: grid;
    grid-template-columns: 1.15fr 1fr;
    gap: 24pt;
    margin-bottom: 14pt;
  }
  .invoice-client {
    padding-top: 4pt;
  }
  .invoice-client-name {
    font-size: 16pt;
    font-weight: 700;
    padding-bottom: 6pt;
    border-bottom: 0.75pt solid #cbd5e1;
    margin-bottom: 6pt;
  }
  .invoice-client-honorific {
    font-size: 12pt;
    font-weight: 500;
    margin-left: 8pt;
    color: #334155;
  }
  .invoice-client-address {
    font-size: 9.5pt;
    color: #334155;
    margin-top: 3pt;
  }
  .invoice-client-contact {
    font-size: 9.5pt;
    color: #334155;
    margin-top: 4pt;
  }

  .invoice-issuer {
    font-size: 9.5pt;
  }
  /* 書類番号・発行日: マイクロラベル + 等幅数字 */
  .invoice-meta-rows {
    margin-bottom: 10pt;
  }
  .invoice-meta-row {
    display: flex; justify-content: space-between; align-items: baseline;
    gap: 8pt;
    padding: 2.5pt 0;
    border-bottom: 0.5pt solid #e2e8f0;
  }
  .invoice-meta-label {
    font-size: 7.5pt;
    font-weight: 600;
    letter-spacing: 0.18em;
    color: #64748b;
    white-space: nowrap;
  }
  .invoice-meta-value {
    font-size: 10pt;
    font-weight: 600;
  }
  .invoice-issuer-box {
    padding: 9pt 11pt;
    background: #f8fafc;
    border: 0.5pt solid #e2e8f0;
    border-radius: 6pt;
    line-height: 1.55;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .invoice-issuer-name {
    font-weight: 700;
    font-size: 11pt;
    margin-bottom: 2pt;
  }
  .invoice-issuer-addr {
    font-size: 8.5pt;
    color: #475569;
  }
  .invoice-issuer-invnum {
    font-size: 8.5pt;
    color: #0f172a;
    margin-top: 5pt;
    padding-top: 5pt;
    border-top: 0.5pt dashed #cbd5e1;
  }

  .invoice-prompt {
    margin-bottom: 12pt;
    font-size: 10.5pt;
    color: #1e293b;
  }

  /* Grand total (hero block — indigo accent, mono-print safe:
     背景が印刷されない設定でも左ボーダー + ウェイトで成立する) */
  .invoice-grand-total {
    display: flex; justify-content: space-between; align-items: center;
    padding: 10pt 16pt;
    background: #f4f5ff;
    border-left: 4pt solid #6366f1;
    border-radius: 0 6pt 6pt 0;
    margin-bottom: 14pt;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .invoice-grand-total-label {
    font-size: 11pt;
    font-weight: 700;
    letter-spacing: 0.14em;
  }
  .invoice-grand-total-value {
    font-size: 22pt;
    font-weight: 800;
    letter-spacing: -0.01em;
    color: #312e81;
  }
  .invoice-grand-total-taxinc {
    font-size: 10pt;
    margin-left: 8pt;
    font-weight: 500;
    color: #64748b;
    letter-spacing: 0;
  }

  /* 但し書き (receipt) */
  .invoice-proviso {
    margin: -6pt 0 14pt;
    padding: 2pt 4pt;
    font-size: 10.5pt;
    border-bottom: 0.5pt solid #cbd5e1;
  }

  /* Items table — hairline rows, no vertical rules */
  .invoice-items {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 10pt;
    font-size: 10pt;
  }
  .invoice-items th {
    padding: 4pt 6pt 5pt;
    border: none;
    border-bottom: 1.5pt solid #0f172a;
    text-align: left;
    font-weight: 600;
    font-size: 8pt;
    letter-spacing: 0.14em;
    color: #475569;
  }
  .invoice-items td {
    padding: 6pt 6pt;
    border: none;
    border-bottom: 0.5pt solid #e2e8f0;
    vertical-align: top;
    min-height: 16pt;
  }
  .invoice-items td:first-child {
    color: #94a3b8;
    font-size: 9pt;
  }
  /* 複数ページ: 行の途中で改ページさせない（15行超は2ページ目に続く） */
  .invoice-items tr {
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .invoice-items thead {
    display: table-header-group;  /* 2ページ目以降にもヘッダー行を繰り返す */
  }
  .invoice-items-name {
    font-weight: 500;
  }
  .invoice-items-memo {
    font-size: 8.5pt;
    color: #64748b;
    margin-top: 2pt;
  }
  .invoice-reduced-note {
    font-size: 8.5pt;
    color: #64748b;
    margin-top: 4pt;
    padding-bottom: 8pt;
  }

  /* Tax summary (right-aligned stack, total row = indigo rule + large bold) */
  .invoice-tax-summary {
    margin-left: auto;
    margin-bottom: 14pt;
    border-collapse: collapse;
    min-width: 250pt;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .invoice-tax-summary th {
    text-align: left;
    padding: 3.5pt 14pt 3.5pt 10pt;
    font-weight: 500;
    color: #475569;
    font-size: 9.5pt;
    border-bottom: 0.5pt solid #eef1f6;
  }
  .invoice-tax-summary td {
    text-align: right;
    padding: 3.5pt 10pt;
    font-size: 10pt;
    min-width: 80pt;
    border-bottom: 0.5pt solid #eef1f6;
  }
  .invoice-tax-summary-total th,
  .invoice-tax-summary-total td {
    font-weight: 800;
    font-size: 13pt;
    border-top: 2pt solid #6366f1;
    border-bottom: none;
    padding-top: 6pt;
  }
  .invoice-tax-summary-total td {
    color: #312e81;
  }

  /* Notes — light card (print-safe grey) */
  .invoice-notes {
    margin: 10pt 0;
    padding: 9pt 12pt;
    background: #f8fafc;
    border: 0.5pt solid #e2e8f0;
    border-radius: 6pt;
    page-break-inside: avoid;
    break-inside: avoid;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .invoice-notes-label {
    font-size: 7.5pt;
    letter-spacing: 0.18em;
    color: #64748b;
    font-weight: 600;
    margin-bottom: 3pt;
  }
  .invoice-notes-body {
    font-size: 9.5pt;
    white-space: pre-wrap;
  }

  /* Bank info — light card */
  .invoice-bank {
    margin-top: 12pt;
    padding: 10pt 14pt;
    background: #f8fafc;
    border: 0.5pt solid #e2e8f0;
    border-radius: 6pt;
    page-break-inside: avoid;
    break-inside: avoid;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .invoice-bank-title {
    display: flex; align-items: center; gap: 5pt;
    font-weight: 700;
    font-size: 9pt;
    letter-spacing: 0.14em;
    margin-bottom: 6pt;
    color: #0f172a;
  }
  .invoice-bank-title::before {
    content: '';
    width: 5pt; height: 5pt;
    border-radius: 1.5pt;
    background: #6366f1;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .invoice-bank-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10pt;
  }
  .invoice-bank-table th {
    text-align: left;
    width: 90pt;
    padding: 2pt 0;
    font-weight: 500;
    color: #64748b;
    font-size: 9pt;
  }
  .invoice-bank-table td {
    padding: 2pt 0;
  }

  /* Stamp area for receipts */
  .invoice-stamp {
    display: flex; justify-content: flex-end; align-items: flex-start;
    gap: 16pt;
    margin-top: 20pt;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .invoice-stamp-box {
    width: 50pt; height: 50pt;
    border: 1pt solid #dc2626;
    color: #dc2626;
    display: flex; align-items: center; justify-content: center;
    font-size: 10pt;
    border-radius: 50%;
    opacity: 0.6;
    flex-shrink: 0;
  }
  /* 収入印紙欄（5万円以上の領収書） */
  .invoice-revenue-stamp {
    text-align: center;
  }
  .invoice-revenue-stamp-box {
    width: 56pt; height: 66pt;
    border: 1pt dashed #94a3b8;
    color: #64748b;
    border-radius: 3pt;
    display: flex; align-items: center; justify-content: center;
    font-size: 9pt;
    letter-spacing: 0.1em;
    writing-mode: vertical-rl;
  }
  .invoice-revenue-stamp-note {
    font-size: 7.5pt;
    color: #94a3b8;
    margin-top: 2pt;
  }

  /* Footer — issuer credit line (画面ではページ最下部に固定) */
  .invoice-footer {
    margin-top: auto;
    padding-top: 8pt;
    border-top: 0.5pt solid #e2e8f0;
    display: flex; justify-content: space-between; align-items: baseline;
    gap: 12pt;
    font-size: 7.5pt;
    color: #94a3b8;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .invoice-footer-credit {
    font-family: 'Sora', 'Inter', sans-serif;
    font-weight: 700;
    letter-spacing: 0.16em;
    color: #c7cbdd;
    white-space: nowrap;
  }

  .mono { font-family: 'JetBrains Mono', 'Menlo', monospace; }

  /* ===== Print =====
     PrintPortal が overlay を body 直下に描画し、styles.css 側の
     body.has-print-overlay ルールが #app を非表示・body を通常フローに
     戻すため、visibility ハックや position:absolute は不要。 */
  @media print {
    @page { size: A4; margin: 0; }
    .no-print { display: none !important; }
    .preview-overlay {
      position: static;
      display: block;
      background: #fff !important;
    }
    .preview-a4-wrap {
      display: block;
      overflow: visible;
      padding: 0 !important;
      background: #fff !important;
    }
    .invoice-a4 {
      display: block;      /* flex はページ分割（page-break）と相性が悪い */
      width: 210mm;
      min-height: auto;   /* 297mm 固定だと末尾に空白ページが出るため */
      margin: 0;
      box-shadow: none;
    }
    .invoice-footer {
      margin-top: 16pt;   /* block レイアウトでは auto が効かないため */
    }
  }
</style>
`;
