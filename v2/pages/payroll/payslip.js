/* ============================================================
   NOVA Core v2 — Payroll / Shared payslip print layout
   Used by monthly + bonus + list (bulk print).
   Design: "Precision Paper" — 白A4前提のモダンレイアウト。
   ヘアライン + 大文字トラッキングのマイクロラベル + N ロゴマーク。
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

// ---- Single slip (A4 portrait) ---------------------------------------------
// mailer.js（明細メール送付）が PDF 生成用に再利用するため export する。

export function Slip({ rec, issuer, kind }) {
  const isBonus = kind === 'bonus';
  const title = isBonus ? '賞与明細書' : '給与明細書';
  const titleEn = isBonus ? 'BONUS SLIP' : 'PAYSLIP';
  const monthStr = monthLabel(rec.month || '');
  const issued = new Date().toLocaleDateString('ja-JP');

  return html`
    <div class="payslip-paper">
      <!-- ブランドヘッダー: N マーク + 会社名 / PAYSLIP 英日併記 -->
      <div class="payslip-brand">
        <div class="payslip-brand-left">
          <div class="payslip-logo">N</div>
          <div class="payslip-corp">
            ${issuer.companyName ? html`
              <div class="payslip-corp-name">${issuer.companyName}</div>
            ` : html`
              <!-- 未設定の案内は画面プレビューのみ表示（印刷時は空欄） -->
              <div class="payslip-corp-name no-print"
                   style=${{ color: '#999', fontWeight: 400, fontSize: '9pt' }}>
                （会社名未設定 — 設定→会社・事業で登録）
              </div>
            `}
          </div>
        </div>
        <div class="payslip-brand-right">
          <div class="payslip-doc-en">${titleEn}</div>
          <div class="payslip-doc-ja">${title}</div>
        </div>
      </div>
      <div class="payslip-rule">
        <div class="acc"></div>
        <div class="rest"></div>
      </div>

      <!-- 氏名 / 対象月 -->
      <div class="payslip-person">
        <div>
          <div class="payslip-micro">EMPLOYEE<span class="ja">氏名</span></div>
          <div class="payslip-person-name">${rec.empName || '-'}</div>
        </div>
        <div class="payslip-period">
          <div class="payslip-micro">PAY PERIOD<span class="ja">対象月</span></div>
          <div class="payslip-period-val">${monthStr}${isBonus ? '' : '分'}</div>
        </div>
      </div>

      <div class="payslip-body">
        <!-- 支給 -->
        <div class="payslip-col">
          <div class="payslip-col-head">
            <span class="en">EARNINGS</span><span class="ja">支給</span>
          </div>
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
          <div class="payslip-col-head">
            <span class="en">DEDUCTIONS</span><span class="ja">控除</span>
          </div>
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

      <!-- 差引支給額（主役ブロック） -->
      <div class="payslip-net">
        <div class="payslip-net-label">
          <div class="payslip-micro" style=${{ marginBottom: '2pt' }}>NET PAY</div>
          <div class="ja">差引支給額</div>
        </div>
        <div class="payslip-net-value">${formatYen(isBonus ? rec.net : rec.net)}</div>
      </div>

      ${rec.onLeave && html`
        <div class="payslip-note">※ 産休・育休中のため社会保険料を免除しています。</div>
      `}

      <!-- フッター -->
      <div class="payslip-footer">
        <div>対象月: ${monthStr} ・ 発行日: ${issued}</div>
        <div class="credit">Generated by <span class="brand">NOVA Core</span></div>
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
// mailer.js が hidden 領域での PDF キャプチャにも使うため export する。
// 注意: html2canvas 1.4.1 でキャプチャされるため、色は hex/rgba 直書き、
// grid は使わず flex、gradient/変数は使わない。

export const printStyle = html`
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
    min-height: 170mm;
    padding: 16mm 18mm 12mm;
    background: #fff;
    color: #0f172a;
    font-family: 'Noto Sans JP', 'Hiragino Kaku Gothic ProN', sans-serif;
    font-size: 10.5pt;
    line-height: 1.55;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
    page-break-after: always;
    box-sizing: border-box;
    display: flex; flex-direction: column;
  }
  .payslip-paper:last-child { page-break-after: auto; }

  /* ---- マイクロラベル（大文字トラッキング） ---- */
  .payslip-micro {
    font-family: 'Sora', 'Inter', sans-serif;
    font-size: 6.5pt;
    font-weight: 600;
    letter-spacing: 0.22em;
    color: #94a3b8;
  }
  .payslip-micro .ja {
    font-family: 'Noto Sans JP', sans-serif;
    letter-spacing: 0.14em;
    margin-left: 6pt;
  }

  /* ---- ブランドヘッダー ---- */
  .payslip-brand {
    display: flex; justify-content: space-between; align-items: center;
  }
  .payslip-brand-left {
    display: flex; align-items: center;
  }
  .payslip-logo {
    width: 24pt; height: 24pt;
    background: #6366f1;
    border-radius: 5.5pt;
    color: #fff;
    font-family: 'Sora', 'Inter', sans-serif;
    font-size: 14pt; font-weight: 800;
    line-height: 24pt; text-align: center;
    margin-right: 8pt;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .payslip-corp-name {
    font-size: 12pt; font-weight: 700;
    letter-spacing: 0.02em;
  }
  .payslip-brand-right { text-align: right; }
  .payslip-doc-en {
    font-family: 'Sora', 'Inter', sans-serif;
    font-size: 15pt; font-weight: 800;
    letter-spacing: 0.3em;
    margin-right: -0.3em; /* 右端の字間ぶんを詰める */
    color: #0f172a;
    line-height: 1.2;
  }
  .payslip-doc-ja {
    font-size: 8pt; color: #64748b;
    letter-spacing: 0.4em;
    margin-right: -0.4em;
    margin-top: 1pt;
  }

  /* アクセントバー + ヘアライン */
  .payslip-rule {
    display: flex; align-items: center;
    margin: 9pt 0 13pt;
  }
  .payslip-rule .acc {
    width: 18mm; height: 2.5pt;
    background: #6366f1;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .payslip-rule .rest {
    flex: 1; height: 0.5pt;
    background: #dde1ea;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ---- 氏名 / 対象月 ---- */
  .payslip-person {
    display: flex; justify-content: space-between; align-items: flex-end;
    margin-bottom: 13pt;
  }
  .payslip-person-name {
    font-size: 16pt; font-weight: 700;
    letter-spacing: 0.06em;
    margin-top: 2pt;
    line-height: 1.3;
  }
  .payslip-period { text-align: right; }
  .payslip-period-val {
    font-size: 12pt; font-weight: 600;
    margin-top: 2pt;
    line-height: 1.4;
    font-variant-numeric: tabular-nums;
  }

  /* ---- 支給 / 控除（ヘアライン区切りの2カラム） ---- */
  .payslip-body {
    display: flex;
    margin-bottom: 13pt;
  }
  .payslip-col { flex: 1; min-width: 0; }
  .payslip-col + .payslip-col { margin-left: 10mm; }
  .payslip-col-head {
    padding-bottom: 4pt;
    margin-bottom: 3pt;
    border-bottom: 1pt solid #0f172a;
    display: flex; align-items: baseline;
  }
  .payslip-col-head .en {
    font-family: 'Sora', 'Inter', sans-serif;
    font-size: 7.5pt; font-weight: 700;
    letter-spacing: 0.24em;
    color: #6366f1;
  }
  .payslip-col-head .ja {
    font-size: 9pt; font-weight: 700;
    color: #0f172a;
    margin-left: 7pt;
  }

  .payslip-row {
    display: flex; justify-content: space-between; align-items: baseline;
    padding: 4.5pt 0;
    font-size: 10pt;
    border-bottom: 0.5pt solid #eceef4;
  }
  .payslip-row-label { color: #475569; }
  .payslip-row-val {
    font-family: 'JetBrains Mono', monospace;
    font-weight: 500;
    color: #0f172a;
  }
  .payslip-row.bold {
    font-weight: 700;
    border-bottom: none;
    border-top: 1pt solid #0f172a;
    margin-top: 2pt; padding-top: 6pt;
  }
  .payslip-row.bold .payslip-row-label { color: #0f172a; }
  .payslip-row.bold .payslip-row-val { font-weight: 700; }

  /* ---- 差引支給額（主役） ---- */
  .payslip-net {
    background: #f4f5ff;
    border-left: 3pt solid #6366f1;
    padding: 10pt 14pt;
    display: flex; justify-content: space-between; align-items: center;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .payslip-net-label .ja {
    font-size: 11pt; font-weight: 700;
    letter-spacing: 0.12em;
    color: #0f172a;
  }
  .payslip-net-value {
    font-size: 23pt; font-weight: 800;
    font-family: 'Inter', 'Sora', sans-serif;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
    color: #4338ca;
  }

  .payslip-note {
    margin-top: 7pt;
    font-size: 8pt; color: #64748b;
  }

  /* ---- フッター ---- */
  .payslip-footer {
    margin-top: auto;
    padding-top: 6pt;
    border-top: 0.5pt solid #dde1ea;
    display: flex; justify-content: space-between; align-items: baseline;
    font-size: 7pt; color: #94a3b8;
    letter-spacing: 0.04em;
  }
  .payslip-footer .credit {
    font-family: 'Sora', 'Inter', sans-serif;
    letter-spacing: 0.08em;
  }
  .payslip-footer .brand { font-weight: 700; color: #6366f1; }

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
      width: 210mm; min-height: 170mm;
      margin: 0;
    }
  }
</style>
`;
