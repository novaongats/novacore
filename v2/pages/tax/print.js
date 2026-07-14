/* ============================================================
   NOVA Core v2 — 税理士提出書類 / A4印刷レンダラー

   data.js の「書類スペック」を A4 レイアウトで描画する。
   - 画面: プレビューオーバーレイ（印刷/PDF保存・CSV・閉じる）
   - 印刷: @media print で書類のみをクリーンに出力
   - 税理士が読む前提: 白黒でも判読できる罫線・強弱、右揃え数字、
     ヘッダーに書類名/期間/範囲/会社名/出力日を常置
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import htm from 'https://esm.sh/htm@3.1.1';
import { useDoc, repos } from '../../store.js';
import { downloadCsv } from './data.js';

const html = htm.bind(h);

export function TaxDocOverlay({ spec, onClose }) {
  const issuerQ = useDoc(repos.settings, 'invoiceIssuer');
  const company = issuerQ.data?.companyName || '有限会社NOVA';
  const printed = new Date().toLocaleDateString('ja-JP');

  return html`
    <div class="taxdoc-overlay">
      <div class="taxdoc-toolbar no-print">
        <div style=${{ color: '#fff', fontWeight: 600 }}>
          ${spec.title}
          <span style=${{ marginLeft: 10, fontSize: 12, opacity: .7 }}>${spec.period} · ${spec.scope}</span>
        </div>
        <div style=${{ display: 'flex', gap: 8 }}>
          <button class="btn" style=${{ background: '#10b981' }}
                  onClick=${() => window.print()}>🖨 印刷 / PDF保存</button>
          <button class="btn" style=${{ background: '#0ea5e9' }}
                  onClick=${() => downloadCsv(spec, `${spec.id}_${spec.period}`)}>📥 CSV</button>
          <button class="btn btn-ghost" onClick=${onClose}
                  style=${{ background: 'rgba(255,255,255,.12)', color: '#fff', borderColor: 'transparent' }}>
            ✕ 閉じる
          </button>
        </div>
      </div>

      <div class="taxdoc-stage">
        <div class=${'taxdoc-paper' + (spec.landscape ? ' landscape' : '')}>
          <div class="taxdoc-head">
            <div>
              <div class="taxdoc-title">${spec.title}</div>
              <div class="taxdoc-sub">
                対象期間: <strong>${spec.period}</strong>
                <span class="sep">|</span>
                集計範囲: <strong>${spec.scope}</strong>
              </div>
            </div>
            <div class="taxdoc-corp">
              <div class="name">${company}</div>
              <div class="meta">出力日: ${printed} · NOVA Core</div>
            </div>
          </div>

          ${spec.sections.map((sec, i) => html`
            <div key=${i} class="taxdoc-section">
              ${sec.heading && html`<div class="taxdoc-h">${sec.heading}</div>`}
              ${sec.table && html`<${SpecTable} table=${sec.table} />`}
              ${sec.note && html`<div class="taxdoc-note">${sec.note}</div>`}
            </div>
          `)}

          ${spec.grandTotal && html`
            <div class="taxdoc-grand">
              <span>${spec.grandTotal.label}</span>
              <span class="v">${spec.grandTotal.value}</span>
            </div>
          `}

          ${(spec.footnotes || []).length > 0 && html`
            <div class="taxdoc-foot">
              ${spec.footnotes.map((f, i) => html`<div key=${i}>※ ${f}</div>`)}
            </div>
          `}
        </div>
      </div>

      ${styleBlock}
    </div>
  `;
}

function SpecTable({ table }) {
  const { cols, rows, total, small } = table;
  return html`
    <table class=${'taxdoc-table' + (small ? ' small' : '')}>
      <thead>
        <tr>
          ${cols.map((c, i) => html`
            <th key=${i} style=${{
              textAlign: c.align || 'left',
              width: c.width ? c.width + 'px' : 'auto',
            }}>${c.label}</th>
          `)}
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, ri) => html`
          <tr key=${ri}>
            ${r.map((cell, ci) => html`
              <td key=${ci} class=${cols[ci]?.align === 'right' ? 'num r' : ''}
                  style=${{ textAlign: cols[ci]?.align || 'left' }}>${cell}</td>
            `)}
          </tr>
        `)}
      </tbody>
      ${total && html`
        <tfoot>
          <tr>
            ${total.map((cell, ci) => html`
              <td key=${ci} class=${cols[ci]?.align === 'right' ? 'num r' : ''}
                  style=${{ textAlign: cols[ci]?.align || 'left' }}>${cell}</td>
            `)}
          </tr>
        </tfoot>
      `}
    </table>
  `;
}

const styleBlock = html`
<style>
  .taxdoc-overlay {
    position: fixed; inset: 0; background: rgba(15,23,42,.92);
    z-index: 99999; display: flex; flex-direction: column;
  }
  .taxdoc-toolbar {
    padding: 12px 20px; background: #1e293b; flex-shrink: 0;
    display: flex; justify-content: space-between; align-items: center;
  }
  .taxdoc-stage {
    flex: 1; overflow: auto; padding: 24px; background: #2a3442;
    display: flex; flex-direction: column; align-items: center;
  }
  .taxdoc-paper {
    width: 210mm; min-height: 297mm; padding: 16mm 15mm;
    background: #fff; color: #111;
    font-family: 'Noto Sans JP', 'Hiragino Kaku Gothic ProN', sans-serif;
    font-size: 9.5pt; line-height: 1.6;
    box-shadow: 0 4px 24px rgba(0,0,0,.3); box-sizing: border-box;
  }
  .taxdoc-paper.landscape { width: 297mm; min-height: 210mm; }

  .taxdoc-head {
    display: flex; justify-content: space-between; align-items: flex-end;
    border-bottom: 2pt solid #111; padding-bottom: 8pt; margin-bottom: 12pt;
  }
  .taxdoc-title { font-size: 16pt; font-weight: 800; letter-spacing: .08em; }
  .taxdoc-sub { font-size: 9pt; color: #444; margin-top: 3pt; }
  .taxdoc-sub .sep { margin: 0 8pt; color: #bbb; }
  .taxdoc-corp { text-align: right; }
  .taxdoc-corp .name { font-size: 11pt; font-weight: 700; }
  .taxdoc-corp .meta { font-size: 8pt; color: #777; margin-top: 2pt; }

  .taxdoc-section { margin-bottom: 12pt; break-inside: avoid; }
  .taxdoc-h {
    font-size: 10.5pt; font-weight: 700; margin-bottom: 5pt;
    padding-left: 6pt; border-left: 3pt solid #333;
  }
  .taxdoc-note { font-size: 8pt; color: #555; margin-top: 3pt; }

  .taxdoc-table {
    width: 100%; border-collapse: collapse; font-size: 9pt;
  }
  .taxdoc-table.small { font-size: 7.6pt; }
  .taxdoc-table th {
    background: #f0f0f0; border: .5pt solid #999;
    padding: 4pt 6pt; font-weight: 700; font-size: 8pt;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .taxdoc-table td {
    border: .5pt solid #bbb; padding: 3.5pt 6pt; vertical-align: top;
  }
  .taxdoc-table td.num { font-family: 'JetBrains Mono', monospace; font-size: 8.6pt; }
  .taxdoc-table.small td.num { font-size: 7.4pt; }
  .taxdoc-table tbody tr:nth-child(even) td { background: #fafafa;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .taxdoc-table tfoot td {
    border-top: 1.2pt solid #333; font-weight: 700; background: #f5f5f5;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  .taxdoc-grand {
    display: flex; justify-content: space-between; align-items: center;
    background: #111; color: #fff; padding: 7pt 12pt; border-radius: 2pt;
    font-weight: 700; font-size: 11pt; margin: 10pt 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .taxdoc-grand .v { font-family: 'JetBrains Mono', monospace; font-size: 13pt; }

  .taxdoc-foot {
    margin-top: 14pt; padding-top: 6pt; border-top: .5pt solid #ccc;
    font-size: 7.6pt; color: #666; line-height: 1.7;
  }

  @media print {
    @page { size: A4; margin: 0; }
    .taxdoc-paper.landscape ~ style {}
    body { background: #fff !important; }
    body * { visibility: hidden; }
    .taxdoc-paper, .taxdoc-paper * { visibility: visible; }
    .taxdoc-overlay { position: static; background: #fff; }
    .taxdoc-stage { padding: 0 !important; background: #fff !important; overflow: visible; }
    .taxdoc-paper { box-shadow: none; }
    .no-print { display: none !important; }
  }
</style>
`;

// 横向き書類用に @page を切り替える（賃金台帳など列が多い書類）
export function applyPageOrientation(landscape) {
  let el = document.getElementById('taxdoc-page-orient');
  if (!el) {
    el = document.createElement('style');
    el.id = 'taxdoc-page-orient';
    document.head.appendChild(el);
  }
  el.textContent = `@media print { @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 0; } }`;
}
