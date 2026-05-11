/* ============================================================
   NOVA Core v2 — Invoices / A4 Preview & print
   Renders a full A4 layout suitable for printing to PDF.
   Print CSS ensures only the preview is rendered on paper.
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import htm from 'https://esm.sh/htm@3.1.1';
import { formatYen } from '../../shared.js';
import { calcTotals, DOC_TYPE_MAP } from './calc.js';

const html = htm.bind(h);

// ---- Title & prompt per document type --------------------------------------

const TITLE_MAP = {
  invoice:  '請求書',
  receipt:  '領収書',
  quote:    '御見積書',
  delivery: '納品書',
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
    <div class="preview-overlay">
      <div class="preview-toolbar no-print">
        <div style=${{ color: '#fff', fontWeight: 600 }}>
          ${TITLE_MAP[doc.type] || '書類'} プレビュー
          <span style=${{ marginLeft: 10, fontSize: 12, opacity: 0.7, fontFamily: 'var(--font-mono)' }}>
            ${doc.docNumber || ''}
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

  const showTaxSep = !doc.hideTaxBreakdown;

  return html`
    <div class="invoice-a4">
      <${TitleBlock} title=${title} />

      <${MetaBlock} doc=${doc} showDue=${isInvoice} showExpiry=${isQuote} />

      <${PromptLine} text=${prompt} />

      <${GrandTotal} totals=${totals} showTaxIncluded=${doc.showTaxIncluded} label=${isReceipt ? '領収金額' : isQuote ? '御見積金額' : '合計金額'} />

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

      ${isReceipt && html`<${StampArea} />`}
    </div>
  `;
}

// ---- Blocks ----------------------------------------------------------------

function TitleBlock({ title }) {
  return html`
    <div class="invoice-title-block">
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
            ${doc.clientPostal && ('〒' + doc.clientPostal + '\u3000')}
            ${doc.clientAddress || ''}
          </div>
        `}
        ${doc.clientContact && html`
          <div class="invoice-client-contact">ご担当：${doc.clientContact} 様</div>
        `}
      </div>

      <div class="invoice-issuer">
        <table class="invoice-meta-table">
          <tr>
            <th>${showDue ? '請求番号' : showExpiry ? '見積番号' : '書類番号'}</th>
            <td class="mono">${doc.docNumber || '-'}</td>
          </tr>
          <tr>
            <th>発行日</th>
            <td>${formatDate(doc.issueDate)}</td>
          </tr>
          ${showDue && doc.dueDate && html`
            <tr><th>お支払期限</th><td>${formatDate(doc.dueDate)}</td></tr>
          `}
          ${showExpiry && doc.dueDate && html`
            <tr><th>有効期限</th><td>${formatDate(doc.dueDate)}</td></tr>
          `}
        </table>

        <div class="invoice-issuer-box">
          <div class="invoice-issuer-name">${doc.issuerCompany || ''}</div>
          ${(doc.issuerPostal || doc.issuerAddress) && html`
            <div class="invoice-issuer-addr">
              ${doc.issuerPostal && ('〒' + doc.issuerPostal + '\u3000')}
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
              <td>${idx + 1}</td>
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
              <td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td>
            </tr>
          `)}
      </tbody>
    </table>
    ${items.some(i => i.taxType === '8') && html`
      <div class="invoice-reduced-note">※ 軽減税率（8%）対象</div>
    `}
  `;
}

function TaxSummary({ totals }) {
  return html`
    <table class="invoice-tax-summary">
      <tr>
        <th>小計（税抜）</th>
        <td class="num">${formatYen(totals.subtotal)}</td>
      </tr>
      ${totals.tax10 > 0 && html`
        <tr>
          <th>消費税 10%</th>
          <td class="num">${formatYen(totals.tax10)}</td>
        </tr>
      `}
      ${totals.tax8 > 0 && html`
        <tr>
          <th>消費税 8%（軽減）</th>
          <td class="num">${formatYen(totals.tax8)}</td>
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
            ${doc.bankAccountHolderKana && html`<span style=${{ marginLeft: 8, fontSize: 10, color: '#666' }}>
              (${doc.bankAccountHolderKana})
            </span>`}
          </td>
        </tr>
      </table>
    </div>
  `;
}

function StampArea() {
  return html`
    <div class="invoice-stamp">
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
    background: rgba(15, 23, 42, 0.92);
    z-index: 99999;
    display: flex; flex-direction: column;
  }
  .preview-toolbar {
    padding: 12px 20px;
    background: #1e293b;
    display: flex; justify-content: space-between; align-items: center;
    flex-shrink: 0;
  }
  .preview-a4-wrap {
    flex: 1; overflow: auto;
    padding: 30px;
    display: flex; justify-content: center; align-items: flex-start;
    background: #2a3442;
  }

  /* A4 page */
  .invoice-a4 {
    width: 210mm;
    min-height: 297mm;
    padding: 18mm 20mm;
    background: #fff;
    color: #000;
    font-family: 'Noto Sans JP', 'Hiragino Kaku Gothic ProN', sans-serif;
    font-size: 11pt;
    line-height: 1.6;
    box-shadow: 0 4px 30px rgba(0, 0, 0, 0.4);
    box-sizing: border-box;
  }

  /* Title */
  .invoice-title-block {
    text-align: center;
    margin-bottom: 18pt;
    padding-bottom: 10pt;
    border-bottom: 2pt solid #000;
  }
  .invoice-title {
    font-size: 26pt;
    font-weight: 800;
    letter-spacing: 0.5em;
    padding-left: 0.5em;  /* compensate letter-spacing */
  }

  /* Meta block (client + issuer) */
  .invoice-meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20pt;
    margin-bottom: 16pt;
  }
  .invoice-client {
    padding-top: 8pt;
  }
  .invoice-client-name {
    font-size: 18pt;
    font-weight: 700;
    padding-bottom: 6pt;
    border-bottom: 1pt solid #000;
    margin-bottom: 6pt;
  }
  .invoice-client-honorific {
    font-size: 14pt;
    font-weight: 500;
    margin-left: 10pt;
  }
  .invoice-client-address {
    font-size: 10pt;
    color: #222;
    margin-top: 3pt;
  }
  .invoice-client-contact {
    font-size: 10pt;
    color: #222;
    margin-top: 4pt;
  }

  .invoice-issuer {
    font-size: 9.5pt;
  }
  .invoice-meta-table {
    width: 100%;
    margin-bottom: 10pt;
    border-collapse: collapse;
  }
  .invoice-meta-table th {
    text-align: left;
    font-weight: 500;
    color: #444;
    padding: 2pt 6pt 2pt 0;
    width: 38%;
  }
  .invoice-meta-table td {
    text-align: right;
    padding: 2pt 0;
  }
  .invoice-issuer-box {
    padding: 8pt 10pt;
    background: #f7f7f7;
    border-radius: 4pt;
    line-height: 1.5;
  }
  .invoice-issuer-name {
    font-weight: 700;
    font-size: 11pt;
    margin-bottom: 2pt;
  }
  .invoice-issuer-addr {
    font-size: 9pt;
    color: #333;
  }
  .invoice-issuer-invnum {
    font-size: 9pt;
    color: #000;
    margin-top: 4pt;
    padding-top: 4pt;
    border-top: 1px dashed #999;
  }

  .invoice-prompt {
    margin-bottom: 14pt;
    font-size: 11pt;
  }

  /* Grand total (highlighted) */
  .invoice-grand-total {
    display: flex; justify-content: space-between; align-items: center;
    padding: 10pt 16pt;
    background: #fff;
    border: 2pt solid #000;
    margin-bottom: 14pt;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .invoice-grand-total-label {
    font-size: 13pt;
    font-weight: 700;
    letter-spacing: 0.1em;
  }
  .invoice-grand-total-value {
    font-size: 20pt;
    font-weight: 800;
    letter-spacing: -0.02em;
  }
  .invoice-grand-total-taxinc {
    font-size: 10pt;
    margin-left: 8pt;
    font-weight: 500;
    color: #555;
  }

  /* Items table */
  .invoice-items {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 10pt;
    font-size: 10pt;
  }
  .invoice-items th {
    background: #f0f0f0;
    padding: 6pt 6pt;
    border: 0.5pt solid #333;
    text-align: left;
    font-weight: 600;
    font-size: 9.5pt;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .invoice-items td {
    padding: 6pt 6pt;
    border: 0.5pt solid #999;
    vertical-align: top;
    min-height: 16pt;
  }
  .invoice-items-name {
    font-weight: 500;
  }
  .invoice-items-memo {
    font-size: 9pt;
    color: #666;
    margin-top: 2pt;
  }
  .invoice-reduced-note {
    font-size: 9pt;
    color: #555;
    margin-top: 4pt;
    padding-bottom: 8pt;
  }

  /* Tax summary (right-aligned) */
  .invoice-tax-summary {
    margin-left: auto;
    margin-bottom: 14pt;
    border-collapse: collapse;
    min-width: 260pt;
  }
  .invoice-tax-summary th {
    text-align: left;
    padding: 4pt 14pt 4pt 10pt;
    font-weight: 500;
    color: #222;
    font-size: 10pt;
  }
  .invoice-tax-summary td {
    text-align: right;
    padding: 4pt 10pt;
    font-size: 10pt;
    min-width: 80pt;
  }
  .invoice-tax-summary-total th,
  .invoice-tax-summary-total td {
    font-weight: 800;
    font-size: 12pt;
    border-top: 1pt solid #000;
    padding-top: 6pt;
  }

  /* Notes */
  .invoice-notes {
    margin: 10pt 0;
    padding: 10pt 12pt;
    border: 0.5pt solid #999;
    border-radius: 4pt;
  }
  .invoice-notes-label {
    font-size: 9pt;
    color: #666;
    font-weight: 600;
    margin-bottom: 4pt;
  }
  .invoice-notes-body {
    font-size: 10pt;
    white-space: pre-wrap;
  }

  /* Bank info */
  .invoice-bank {
    margin-top: 14pt;
    padding: 10pt 14pt;
    border: 1pt solid #000;
    background: #fafafa;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .invoice-bank-title {
    font-weight: 700;
    font-size: 11pt;
    margin-bottom: 6pt;
    padding-bottom: 4pt;
    border-bottom: 0.5pt solid #000;
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
    color: #444;
  }
  .invoice-bank-table td {
    padding: 2pt 0;
  }

  /* Stamp area for receipts */
  .invoice-stamp {
    display: flex; justify-content: flex-end;
    margin-top: 20pt;
  }
  .invoice-stamp-box {
    width: 50pt; height: 50pt;
    border: 1pt solid #c00;
    color: #c00;
    display: flex; align-items: center; justify-content: center;
    font-size: 10pt;
    border-radius: 50%;
    opacity: 0.6;
  }

  .mono { font-family: 'JetBrains Mono', 'Menlo', monospace; }

  /* ===== Print ===== */
  @media print {
    @page { size: A4; margin: 0; }
    body { background: #fff !important; }
    body * { visibility: hidden; }
    .invoice-a4, .invoice-a4 * { visibility: visible; }
    .invoice-a4 {
      position: absolute; top: 0; left: 0;
      width: 210mm; min-height: 297mm;
      margin: 0; box-shadow: none;
    }
    .preview-overlay { background: #fff !important; position: static; }
    .preview-toolbar, .preview-a4-wrap {
      background: #fff !important;
    }
    .preview-a4-wrap { padding: 0 !important; }
    .no-print { display: none !important; }
  }
</style>
`;
