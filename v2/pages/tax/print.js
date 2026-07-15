/* ============================================================
   NOVA Core v2 — 税理士提出書類 / A4印刷レンダラー

   data.js の「書類スペック」を A4 レイアウトで描画する。
   - 画面: プレビューオーバーレイ（印刷/PDF保存・CSV・閉じる）
   - 印刷: @media print で書類のみをクリーンに出力
   - 税理士（顧問会計事務所）が読む前提:
     · モノクロ印刷・FAX でも判読できる罫線の強弱
     · 数字は右揃え + 等幅（tabular-nums）で桁揃え
     · 合計行は会計様式の二重罫線
     · 冒頭に要点サマリーバンド（spec.summary）
     · 各ページ下部に書類名+期間を再掲（@page margin box）
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useEffect } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { useDoc, repos } from '../../store.js';
import { PrintPortal } from '../../print.js';
import { downloadCsv } from './data.js';

const html = htm.bind(h);

export function TaxDocOverlay({ spec, onClose }) {
  const issuerQ = useDoc(repos.settings, 'invoiceIssuer');
  const company = issuerQ.data?.companyName || '有限会社NOVA';
  const printed = new Date().toLocaleDateString('ja-JP');

  // 横向き書類は @page を切替え、閉じたら必ず縦に戻す
  // （残留すると給与明細・請求書の印刷まで横向きになる）。
  // 表示中はページ余白 + フッター（書類名·期間·ページ番号）も有効化する。
  useEffect(() => {
    applyPageOrientation(!!spec.landscape, `${spec.title} ｜ ${spec.period}`);
    return () => applyPageOrientation(false);
  }, [spec]);

  return html`
    <${PrintPortal}>
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
                  onClick=${() => downloadCsv(spec, spec.filenameBase || spec.id)}>📥 CSV</button>
          <button class="btn btn-ghost" onClick=${onClose}
                  style=${{ background: 'rgba(255,255,255,.12)', color: '#fff', borderColor: 'transparent' }}>
            ✕ 閉じる
          </button>
        </div>
      </div>

      <div class="taxdoc-stage">
        <div class=${'taxdoc-paper' + (spec.landscape ? ' landscape' : '')}>

          <div class="taxdoc-head">
            <div class="taxdoc-brandline">
              <div class="brand">
                <span class="mark">N</span>
                <span class="corp">${company}</span>
              </div>
              <div class="sys">NOVA Core — 税理士提出書類</div>
            </div>
            <div class="taxdoc-title">${spec.title}</div>
            <div class="taxdoc-meta">
              <div class="cell">
                <div class="k">対象期間 <span class="en">PERIOD</span></div>
                <div class="v">${spec.period}</div>
              </div>
              <div class="cell">
                <div class="k">集計範囲 <span class="en">SCOPE</span></div>
                <div class="v">${spec.scope}</div>
              </div>
              <div class="cell issued">
                <div class="k">出力日 <span class="en">ISSUED</span></div>
                <div class="v">${printed}</div>
              </div>
            </div>
          </div>

          ${(spec.summary || []).length > 0 && html`
            <div class="taxdoc-summary">
              ${spec.summary.map((s, i) => html`
                <div key=${i} class=${'cell' + (s.emph ? ' emph' : '')}>
                  <div class="k">${s.label}</div>
                  <div class="v">${s.value}</div>
                </div>
              `)}
            </div>
          `}

          ${spec.sections.map((sec, i) => html`
            <div key=${i} class="taxdoc-section">
              ${sec.heading && html`<${SectionHeading} text=${sec.heading} desc=${sec.desc} />`}
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
              <div class="k">注記 <span class="en">NOTES</span></div>
              ${spec.footnotes.map((f, i) => html`
                <div key=${i} class="fn">
                  <span class="fnmark">※${spec.footnotes.length > 1 ? i + 1 : ''}</span>
                  <span>${f}</span>
                </div>
              `)}
            </div>
          `}

          <div class="taxdoc-endline">
            ${spec.title} ｜ ${spec.period} ｜ ${company}
          </div>
        </div>
      </div>

      ${styleBlock}
    </div>
    </${PrintPortal}>
  `;
}

/** 「① 見出し」形式なら丸数字を番号バッジに分離して描画する */
function SectionHeading({ text, desc }) {
  const m = /^([①-⑳])\s*(.*)$/.exec(text || '');
  const num = m ? String(m[1].codePointAt(0) - 0x2460 + 1) : null;
  const label = m ? m[2] : text;
  return html`
    <div class="taxdoc-h">
      ${num && html`<span class="badge">${num}</span>`}
      <span class="t">${label}</span>
      ${desc && html`<span class="d">${desc}</span>`}
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
    width: 210mm; min-height: 297mm; padding: 14mm 15mm 12mm;
    background: #fff; color: #111;
    font-family: 'Noto Sans JP', 'Hiragino Kaku Gothic ProN', sans-serif;
    font-size: 9.5pt; line-height: 1.6;
    box-shadow: 0 4px 24px rgba(0,0,0,.3); box-sizing: border-box;
    display: flex; flex-direction: column;
  }
  .taxdoc-paper.landscape { width: 297mm; min-height: 210mm; }

  /* ---- ヘッダー帯 ------------------------------------------ */
  .taxdoc-head { margin-bottom: 11pt; }
  .taxdoc-brandline {
    display: flex; justify-content: space-between; align-items: center;
    padding-bottom: 5pt; border-bottom: .5pt solid #d4d4d8;
  }
  .taxdoc-brandline .brand { display: flex; align-items: center; gap: 5pt; }
  .taxdoc-brandline .mark {
    width: 13pt; height: 13pt; border-radius: 2.5pt;
    background: #6366f1; color: #fff;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 8.5pt; font-weight: 800; line-height: 1;
    font-family: 'Sora', 'Noto Sans JP', sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .taxdoc-brandline .corp { font-size: 10pt; font-weight: 700; letter-spacing: .02em; }
  .taxdoc-brandline .sys {
    font-size: 6.5pt; color: #999; letter-spacing: .14em;
  }
  .taxdoc-title {
    font-size: 17pt; font-weight: 800; letter-spacing: .1em;
    margin: 8pt 0 7pt;
  }
  .taxdoc-meta {
    display: flex; border-top: .5pt solid #d4d4d8; border-bottom: 1.4pt solid #111;
  }
  .taxdoc-meta .cell {
    padding: 4pt 14pt 4.5pt 0; margin-right: 14pt;
    border-right: .5pt solid #e4e4e9;
  }
  .taxdoc-meta .cell.issued { margin-left: auto; margin-right: 0; border-right: none; padding-right: 0; text-align: right; }
  .taxdoc-meta .k {
    font-size: 6.5pt; font-weight: 700; color: #888; letter-spacing: .08em;
  }
  .taxdoc-meta .k .en { font-weight: 500; color: #b5b5c0; letter-spacing: .16em; margin-left: 2pt; }
  .taxdoc-meta .v { font-size: 9.5pt; font-weight: 700; margin-top: 1pt; }

  /* ---- 要点サマリーバンド ---------------------------------- */
  .taxdoc-summary {
    display: flex; border: 1pt solid #111; border-radius: 2pt;
    margin-bottom: 13pt; overflow: hidden;
  }
  .taxdoc-summary .cell {
    flex: 1; padding: 5.5pt 10pt 6pt;
    border-left: .5pt solid #d4d4d8;
  }
  .taxdoc-summary .cell:first-child { border-left: none; }
  .taxdoc-summary .k {
    font-size: 6.8pt; font-weight: 700; color: #777; letter-spacing: .06em;
  }
  .taxdoc-summary .v {
    font-size: 12.5pt; font-weight: 700; margin-top: 1pt;
    font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums;
    text-align: right; white-space: nowrap;
  }
  .taxdoc-summary .cell.emph {
    background: #17171f; border-left-color: #17171f;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .taxdoc-summary .cell.emph .k { color: #b8b8c8; }
  .taxdoc-summary .cell.emph .v { color: #fff; }

  /* ---- セクション見出し ------------------------------------ */
  .taxdoc-section { margin-bottom: 12pt; }
  .taxdoc-h {
    display: flex; align-items: baseline; gap: 5pt; margin-bottom: 4.5pt;
  }
  .taxdoc-h .badge {
    align-self: center;
    width: 11.5pt; height: 11.5pt; border-radius: 2pt; flex-shrink: 0;
    background: #6366f1; color: #fff;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 7.5pt; font-weight: 800; line-height: 1;
    font-family: 'JetBrains Mono', monospace;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .taxdoc-h .t { font-size: 10.5pt; font-weight: 700; letter-spacing: .02em; }
  .taxdoc-h .d { margin-left: auto; font-size: 7.2pt; color: #999; }
  /* 番号なし見出し（経費帳の勘定科目名など）は左マーカー式 */
  .taxdoc-h .t:first-child { padding-left: 6pt; border-left: 2.5pt solid #6366f1; }
  .taxdoc-note { font-size: 7.6pt; color: #666; margin-top: 3pt; padding-left: 2pt; }

  /* ---- テーブル（会計様式） -------------------------------- */
  .taxdoc-table {
    width: 100%; border-collapse: collapse; font-size: 9pt;
    font-variant-numeric: tabular-nums;
  }
  .taxdoc-table.small { font-size: 7.6pt; }
  .taxdoc-table th {
    background: #f2f2f5; color: #444;
    border-top: 1pt solid #111; border-bottom: .75pt solid #555;
    padding: 3.5pt 6pt; font-weight: 700; font-size: 7.6pt; letter-spacing: .05em;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .taxdoc-table th + th, .taxdoc-table td + td { border-left: .4pt solid #e6e6eb; }
  .taxdoc-table td {
    border-bottom: .4pt solid #d8d8de; padding: 3.2pt 6pt; vertical-align: top;
  }
  .taxdoc-table td.num {
    font-family: 'JetBrains Mono', monospace; font-size: 8.6pt;
    white-space: nowrap;
  }
  .taxdoc-table.small td.num { font-size: 7.4pt; }
  .taxdoc-table tbody tr:nth-child(even) td { background: #fbfbfc;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .taxdoc-table tfoot td {
    border-top: 2.5pt double #111; border-bottom: 1pt solid #111;
    font-weight: 700; background: #f6f6f8;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  /* ---- 総合計・注記・末尾 ---------------------------------- */
  .taxdoc-grand {
    display: flex; justify-content: space-between; align-items: center;
    background: #17171f; color: #fff; padding: 7pt 12pt; border-radius: 2pt;
    font-weight: 700; font-size: 11pt; margin: 10pt 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .taxdoc-grand .v {
    font-family: 'JetBrains Mono', monospace; font-size: 13pt;
    font-variant-numeric: tabular-nums;
  }

  .taxdoc-foot {
    margin-top: 13pt; padding: 6pt 9pt 7pt;
    border: .5pt solid #c8c8d0; border-radius: 2pt;
    font-size: 7.6pt; color: #555; line-height: 1.75;
  }
  .taxdoc-foot .k {
    font-size: 6.5pt; font-weight: 700; color: #888; letter-spacing: .1em;
    margin-bottom: 2pt;
  }
  .taxdoc-foot .k .en { font-weight: 500; color: #bbb; letter-spacing: .16em; margin-left: 2pt; }
  .taxdoc-foot .fn { display: flex; gap: 4pt; }
  .taxdoc-foot .fnmark { flex-shrink: 0; color: #999; }

  .taxdoc-endline {
    margin-top: auto; padding-top: 10pt;
    font-size: 6.5pt; color: #b0b0ba; text-align: center; letter-spacing: .1em;
  }

  /* ---- 印刷 -------------------------------------------------
     PrintPortal が #app を display:none にするので、visibility ハックは不要。
     @page（A4 縦/横・余白・下部フッター）は applyPageOrientation() が
     document.head 直下の style で一元管理する（ここに書くと landscape
     切替と競合する。また htm がタグと誤認するため山括弧をここに書かない）。
     税書類表示中は @page に余白があるため、紙面パディングは最小化する。 */
  @media print {
    body { background: #fff !important; }
    .taxdoc-overlay { position: static; background: #fff; }
    .taxdoc-stage { padding: 0; background: #fff; overflow: visible; display: block; }
    .taxdoc-paper { box-shadow: none; width: auto; min-height: 0; padding: 0; display: block; }
    .no-print { display: none !important; }
    /* 各ページ下部の再掲は @page margin box が担うため、末尾行は最終ページのみ通常フローで出す */
    .taxdoc-endline { margin-top: 14pt; }
    /* 複数ページ: 行単位で改ページし、各ページに見出し行を繰り返す */
    .taxdoc-table tr { break-inside: avoid; }
    .taxdoc-table thead { display: table-header-group; }
    .taxdoc-summary, .taxdoc-grand, .taxdoc-foot { break-inside: avoid; }
    .taxdoc-h { break-after: avoid; }
  }
</style>
`;

/**
 * 横向き書類用に @page を切り替える（賃金台帳など列が多い書類）。
 *
 * footer を渡すと「税書類モード」: ページ余白を確保し、各ページ下部中央に
 * 書類名+期間+ページ番号を再掲する（Chrome 131+ の @page margin box。
 * 未対応ブラウザでは余白のみでフッターは無視される）。
 * footer なし（既定・クリーンアップ時）は従来どおり margin:0 —
 * 給与明細・請求書など他の印刷レイアウトはこの既定値を前提にしている。
 */
export function applyPageOrientation(landscape, footer) {
  let el = document.getElementById('taxdoc-page-orient');
  if (!el) {
    el = document.createElement('style');
    el.id = 'taxdoc-page-orient';
    document.head.appendChild(el);
  }
  const size = `A4 ${landscape ? 'landscape' : 'portrait'}`;
  if (footer == null) {
    el.textContent = `@media print { @page { size: ${size}; margin: 0; } }`;
    return;
  }
  const text = String(footer).replace(/["\\]/g, '');
  el.textContent = `@media print { @page {
    size: ${size}; margin: 12mm 11mm 15mm;
    @bottom-center {
      content: "${text} ｜ " counter(page);
      font-family: 'Noto Sans JP', sans-serif;
      font-size: 6.5pt; color: #9a9aa4; letter-spacing: .08em;
    }
  } }`;
}
