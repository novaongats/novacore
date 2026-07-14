/* ============================================================
   NOVA Core v2 — Payroll / Shared payslip print layout
   Used by monthly + bonus + list (bulk print).
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import htm from 'https://esm.sh/htm@3.1.1';
import { useDoc } from '../../store.js';
import { repos } from '../../store.js';
import { formatYen, monthLabel } from '../../shared.js';
import { PrintPortal } from '../../print.js';

const html = htm.bind(h);

// ---- Overlay wrapper (print dialog + toolbar) -----------------------------

export function PayslipOverlay({ records = [], onClose, kind = 'monthly' }) {
  // フックは早期 return より前に呼ぶ（Rules of Hooks）
  const issuerQ = useDoc(repos.settings, 'invoiceIssuer');
  if (!records || records.length === 0) return null;
  const issuer = issuerQ.data || {};

  function handlePrint() {
    window.print();
  }

  // PrintPortal: body 直下に描画し、印刷時は #app を display:none にする
  // （styles.css の has-print-overlay ルール）。これで page-break が
  // 通常フローで機能し、複数人分が全ページ印刷される。
  return html`
    <${PrintPortal}>
      <div class="payslip-overlay">
        <div class="payslip-toolbar no-print">
          <div style=${{ color: '#fff', fontWeight: 600 }}>
            ${kind === 'bonus' ? '賞与明細' : '給与明細'} プレビュー
            <span style=${{ marginLeft: 10, fontSize: 12, opacity: 0.7 }}>
              ${records.length} 名分
            </span>
          </div>
          <div style=${{ display: 'flex', gap: 8 }}>
            <button class="btn" onClick=${handlePrint}
                    style=${{ background: '#10b981' }}>🖨 印刷 / PDF保存</button>
            <button class="btn btn-ghost" onClick=${onClose}
                    style=${{ background: 'rgba(255,255,255,0.12)', color: '#fff', borderColor: 'transparent' }}>
              ✕ 閉じる
            </button>
          </div>
        </div>

        <div class="payslip-stage">
          ${records.map((rec, i) => html`
            <${Slip} key=${i} rec=${rec} issuer=${issuer} kind=${kind} />
          `)}
        </div>

        ${printStyle}
      </div>
    </${PrintPortal}>
  `;
}

// ---- Single slip (A4 portrait, 2 slips per A4 potentially) -----------------

function Slip({ rec, issuer, kind }) {
  const isBonus = kind === 'bonus';
  const title = isBonus ? '賞与明細書' : '給与明細書';
  const monthStr = monthLabel(rec.month || '');

  return html`
    <div class="payslip-paper">
      <div class="payslip-header">
        <div class="payslip-title">${title}</div>
        <div class="payslip-meta">
          <div>${monthStr}${isBonus ? '' : '分'}</div>
          ${issuer.companyName ? html`
            <div class="payslip-company">${issuer.companyName}</div>
          ` : html`
            <!-- 未設定の案内は画面プレビューのみ表示（印刷時は空欄） -->
            <div class="payslip-company no-print"
                 style=${{ color: '#999', fontWeight: 400, fontSize: '9pt' }}>
              （会社名未設定 — 設定→会社・事業で登録）
            </div>
          `}
        </div>
      </div>

      <div class="payslip-person">
        <div><span class="label">氏名</span><span class="val">${rec.empName || '-'}</span></div>
      </div>

      <div class="payslip-body">
        <!-- 支給 -->
        <div class="payslip-col">
          <div class="payslip-col-head">支給</div>
          ${isBonus ? html`
            <${Row} label="賞与額" value=${rec.amount} />
          ` : html`
            <${Row} label="基本給" value=${rec.basePay} />
            ${(rec.commission   || 0) > 0 && html`<${Row} label="歩合給" value=${rec.commission} />`}
            ${(rec.allowance    || 0) > 0 && html`<${Row} label="諸手当" value=${rec.allowance} />`}
            ${(rec.commuteTotal || 0) > 0 && html`<${Row} label="通勤手当" value=${rec.commuteTotal} />`}
            ${(rec.deduction    || 0) > 0 && html`<${Row} label="控除" value=${-rec.deduction} />`}
          `}
          <${Row} label="総支給額" value=${isBonus ? rec.amount : rec.gross} bold />
        </div>

        <!-- 控除 -->
        <div class="payslip-col">
          <div class="payslip-col-head">控除</div>
          ${(rec.health       || 0) > 0 && html`<${Row} label="健康保険" value=${rec.health} />`}
          ${(rec.pension      || 0) > 0 && html`<${Row} label="厚生年金" value=${rec.pension} />`}
          ${(rec.care         || 0) > 0 && html`<${Row} label="介護保険" value=${rec.care} />`}
          ${(rec.childSupport || 0) > 0 && html`<${Row} label="子育て支援金" value=${rec.childSupport} />`}
          ${(rec.employment   || 0) > 0 && html`<${Row} label="雇用保険" value=${rec.employment} />`}
          <${Row} label="所得税" value=${rec.incomeTax || 0} />
          ${!isBonus && (rec.residentTax || 0) > 0 && html`
            <${Row} label="住民税" value=${rec.residentTax} />
          `}
          <${Row} label="控除合計" value=${rec.totalDed || 0} bold />
        </div>
      </div>

      <div class="payslip-net">
        <div class="payslip-net-label">差引支給額</div>
        <div class="payslip-net-value">${formatYen(isBonus ? rec.net : rec.net)}</div>
      </div>
    </div>
  `;
}

function Row({ label, value, bold }) {
  return html`
    <div class="payslip-row${bold ? ' bold' : ''}">
      <span class="payslip-row-label">${label}</span>
      <span class="payslip-row-val">${formatYen(value || 0)}</span>
    </div>
  `;
}

// ---- CSS (inline <style> — moved to styles.css in the future) --------------

const printStyle = html`
<style>
  .payslip-overlay {
    position: fixed; inset: 0;
    background: rgba(15, 23, 42, 0.92);
    z-index: 99999;
    display: flex; flex-direction: column;
  }
  .payslip-toolbar {
    padding: 12px 20px;
    background: #1e293b;
    display: flex; justify-content: space-between; align-items: center;
    flex-shrink: 0;
  }
  .payslip-stage {
    flex: 1; overflow: auto;
    padding: 24px; background: #2a3442;
    display: flex; flex-direction: column; align-items: center; gap: 24px;
  }
  .payslip-paper {
    width: 210mm;
    min-height: 140mm;
    padding: 14mm 14mm;
    background: #fff;
    color: #000;
    font-family: 'Noto Sans JP', 'Hiragino Kaku Gothic ProN', sans-serif;
    font-size: 10.5pt;
    line-height: 1.55;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
    page-break-after: always;
    box-sizing: border-box;
  }
  .payslip-paper:last-child { page-break-after: auto; }

  .payslip-header {
    display: flex; justify-content: space-between; align-items: flex-end;
    margin-bottom: 12pt; padding-bottom: 8pt;
    border-bottom: 1.5pt solid #000;
  }
  .payslip-title {
    font-size: 18pt;
    font-weight: 800;
    letter-spacing: 0.2em;
  }
  .payslip-meta { text-align: right; font-size: 11pt; }
  .payslip-company { font-size: 12pt; font-weight: 700; margin-top: 2pt; }

  .payslip-person { margin-bottom: 10pt; }
  .payslip-person .label {
    font-size: 9pt; color: #666;
    margin-right: 8pt;
  }
  .payslip-person .val {
    font-size: 13pt; font-weight: 700;
  }

  .payslip-body {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 18pt;
    margin-bottom: 14pt;
  }
  .payslip-col {
    padding: 10pt;
    border: 0.5pt solid #333;
    border-radius: 2pt;
  }
  .payslip-col-head {
    font-size: 10pt;
    font-weight: 700;
    padding-bottom: 5pt;
    margin-bottom: 6pt;
    border-bottom: 0.5pt solid #999;
  }

  .payslip-row {
    display: flex; justify-content: space-between; align-items: baseline;
    padding: 3pt 0;
    font-size: 10pt;
  }
  .payslip-row.bold {
    font-weight: 700;
    border-top: 0.5pt solid #666;
    margin-top: 4pt; padding-top: 5pt;
  }
  .payslip-row-label { color: #222; }
  .payslip-row-val {
    font-family: 'JetBrains Mono', monospace;
    font-weight: 500;
  }
  .payslip-row.bold .payslip-row-val { font-weight: 700; }

  .payslip-net {
    background: #000; color: #fff;
    padding: 8pt 14pt;
    display: flex; justify-content: space-between; align-items: center;
    border-radius: 2pt;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .payslip-net-label {
    font-size: 11pt; font-weight: 700; letter-spacing: 0.1em;
  }
  .payslip-net-value {
    font-size: 17pt; font-weight: 800;
    font-family: 'Inter', 'Sora', sans-serif;
  }

  @media print {
    @page { size: A4; margin: 0; }
    /* PrintPortal が body 直下に描画し #app は styles.css 側で非表示になる。
       visibility ハックは不要。overlay を通常フローに戻して
       .payslip-paper の page-break-after を機能させる。 */
    .no-print { display: none !important; }
    .payslip-overlay {
      position: static !important;
      inset: auto !important;
      display: block !important;
      background: #fff !important;
    }
    .payslip-stage {
      display: block !important;
      overflow: visible !important;
      padding: 0 !important;
      background: #fff !important;
    }
    .payslip-paper {
      box-shadow: none;
      width: 210mm; min-height: 140mm;
      margin: 0;
    }
  }
</style>
`;
