/* ============================================================
   NOVA Core v2 — 依存ゼロの SVG チャート（Preact コンポーネント）

   - TrendChart: 月次推移の折れ線（複数系列、ホバーで月別ツールチップ）
   - DeptDonut:  構成比ドーナツ（部門色は事業マスタに追従）

   デザイン原則: 細いマーク、控えめなグリッド、系列の識別は
   凡例＋直接ラベル（色だけに依存しない）、軸は1本のみ。
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { formatYen } from './shared.js';

const html = htm.bind(h);

// ---- 金額の短縮表示（軸ラベル用） -------------------------------------------

function yenShort(v) {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  if (abs >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, '') + '億';
  if (abs >= 10000)     return Math.round(n / 10000).toLocaleString() + '万';
  return n.toLocaleString();
}

/** きりのいい軸上限に丸める */
function niceMax(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

// ---- 月次トレンド折れ線 -------------------------------------------------------

/**
 * @param months  ['2026-02', ...]（昇順）
 * @param series  [{ label, color, values: number[] }]（values は months と同順）
 * @param height  px（省略時 200）
 */
export function TrendChart({ months, series, height = 200 }) {
  const [hover, setHover] = useState(null); // hovered month index

  const W = 720, H = height;
  const PAD = { top: 14, right: 84, bottom: 26, left: 52 };
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const n = months.length;
  if (n === 0 || series.every(s => s.values.every(v => !v))) {
    return html`<div style=${{ color: 'var(--text-3)', fontSize: 13, padding: '20px 0' }}>データなし</div>`;
  }

  const maxRaw = Math.max(1, ...series.flatMap(s => s.values));
  const max = niceMax(maxRaw);
  const x = i => PAD.left + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = v => PAD.top + ih - (Math.max(0, v) / max) * ih;

  const gridLines = [0.25, 0.5, 0.75, 1];

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width * W;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(x(i) - px);
      if (d < bestD) { bestD = d; best = i; }
    }
    setHover(best);
  }

  return html`
    <div style=${{ position: 'relative' }}>
      <!-- 凡例 -->
      <div style=${{ display: 'flex', gap: 16, marginBottom: 6, fontSize: 12 }}>
        ${series.map(s => html`
          <span key=${s.label} style=${{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style=${{ width: 14, height: 3, borderRadius: 2, background: s.color }}></span>
            <span style=${{ color: 'var(--text-2)', fontWeight: 600 }}>${s.label}</span>
          </span>
        `)}
      </div>

      <svg viewBox=${`0 0 ${W} ${H}`} style=${{ width: '100%', height: 'auto', display: 'block' }}
           onMouseMove=${onMove} onMouseLeave=${() => setHover(null)}>
        <!-- グリッド + y軸ラベル -->
        ${gridLines.map(g => html`
          <g key=${g}>
            <line x1=${PAD.left} x2=${W - PAD.right} y1=${y(max * g)} y2=${y(max * g)}
                  stroke="var(--border-2)" stroke-width="1" />
            <text x=${PAD.left - 8} y=${y(max * g) + 4} text-anchor="end"
                  font-size="10" fill="var(--text-4)" font-family="var(--font-num)">
              ${yenShort(max * g)}
            </text>
          </g>
        `)}
        <line x1=${PAD.left} x2=${W - PAD.right} y1=${y(0)} y2=${y(0)}
              stroke="var(--border)" stroke-width="1" />

        <!-- x軸月ラベル -->
        ${months.map((m, i) => html`
          <text key=${m} x=${x(i)} y=${H - 8} text-anchor="middle"
                font-size="10.5" font-weight=${hover === i ? 700 : 500}
                fill=${hover === i ? 'var(--text)' : 'var(--text-3)'}>
            ${Number(m.slice(5))}月
          </text>
        `)}

        <!-- クロスヘア -->
        ${hover != null && html`
          <line x1=${x(hover)} x2=${x(hover)} y1=${PAD.top} y2=${PAD.top + ih}
                stroke="var(--text-4)" stroke-width="1" stroke-dasharray="3,3" />
        `}

        <!-- 系列 -->
        ${series.map(s => {
          const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
          const last = s.values.length - 1;
          return html`
            <g key=${s.label}>
              <polyline points=${pts} fill="none" stroke=${s.color}
                        stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
              ${s.values.map((v, i) => html`
                <circle key=${i} cx=${x(i)} cy=${y(v)}
                        r=${hover === i ? 4.5 : 3}
                        fill=${s.color} stroke="var(--surface)" stroke-width="2" />
              `)}
              <!-- 直接ラベル（終端） -->
              <text x=${x(last) + 8} y=${y(s.values[last]) + 4}
                    font-size="10.5" font-weight="700" fill=${s.color}
                    font-family="var(--font-num)">
                ${yenShort(s.values[last])}
              </text>
            </g>
          `;
        })}
      </svg>

      <!-- ツールチップ -->
      ${hover != null && html`
        <div style=${{
          position: 'absolute',
          left: `${(x(hover) / W) * 100}%`, top: 24,
          transform: x(hover) > W * 0.6 ? 'translateX(-105%)' : 'translateX(8px)',
          background: 'var(--text)', color: 'var(--surface)',
          borderRadius: 8, padding: '8px 12px', fontSize: 11.5,
          pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 5,
          boxShadow: 'var(--shadow-lg)',
        }}>
          <div style=${{ fontWeight: 700, marginBottom: 4 }}>
            ${months[hover].replace('-', '年').replace(/年0?/, '年') + '月'}
          </div>
          ${series.map(s => html`
            <div key=${s.label} style=${{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style=${{ width: 8, height: 8, borderRadius: 2, background: s.color }}></span>
              ${s.label}: <strong>${formatYen(s.values[hover])}</strong>
            </div>
          `)}
        </div>
      `}
    </div>
  `;
}

// ---- 構成比ドーナツ -----------------------------------------------------------

/**
 * @param items [{ label, value, color }]（value 降順推奨）
 * @param size  px（省略時 168）
 */
export function DeptDonut({ items, size = 168 }) {
  const [hover, setHover] = useState(null);
  const total = items.reduce((s, x) => s + (Number(x.value) || 0), 0);
  if (total <= 0) {
    return html`<div style=${{ color: 'var(--text-3)', fontSize: 13 }}>データなし</div>`;
  }

  const R = 48, r = 32, C = 60; // viewBox 120x120
  let acc = 0;

  function arcPath(start, end) {
    // 2px 相当の隙間（角度換算）
    const gap = Math.min(0.03, (end - start) * 0.15);
    const a0 = start + gap / 2 - Math.PI / 2;
    const a1 = end - gap / 2 - Math.PI / 2;
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    const p = (a, rad) => `${C + rad * Math.cos(a)},${C + rad * Math.sin(a)}`;
    return `M ${p(a0, R)} A ${R} ${R} 0 ${large} 1 ${p(a1, R)}
            L ${p(a1, r)} A ${r} ${r} 0 ${large} 0 ${p(a0, r)} Z`;
  }

  return html`
    <div style=${{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <svg viewBox="0 0 120 120" style=${{ width: size, height: size, flexShrink: 0 }}>
        ${items.map((it, idx) => {
          const start = (acc / total) * Math.PI * 2;
          acc += Number(it.value) || 0;
          const end = (acc / total) * Math.PI * 2;
          if (end - start < 0.001) return null;
          return html`
            <path key=${it.label} d=${arcPath(start, end)} fill=${it.color}
                  opacity=${hover == null || hover === idx ? 1 : 0.35}
                  style=${{ transition: 'opacity .15s', cursor: 'default' }}
                  onMouseEnter=${() => setHover(idx)} onMouseLeave=${() => setHover(null)}>
              <title>${it.label}: ${formatYen(it.value)} (${Math.round(it.value / total * 100)}%)</title>
            </path>
          `;
        })}
        <text x="60" y="56" text-anchor="middle" font-size="9" fill="var(--text-3)">
          ${hover != null ? items[hover].label : '合計'}
        </text>
        <text x="60" y="70" text-anchor="middle" font-size="11" font-weight="800"
              fill="var(--text)" font-family="var(--font-num)">
          ${yenShort(hover != null ? items[hover].value : total)}
        </text>
      </svg>

      <!-- 凡例（値つき） -->
      <div style=${{ display: 'grid', gap: 7, minWidth: 180 }}>
        ${items.map((it, idx) => html`
          <div key=${it.label}
               onMouseEnter=${() => setHover(idx)} onMouseLeave=${() => setHover(null)}
               style=${{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5,
                         opacity: hover == null || hover === idx ? 1 : 0.5 }}>
            <span style=${{ width: 10, height: 10, borderRadius: 3, background: it.color, flexShrink: 0 }}></span>
            <span style=${{ color: 'var(--text-2)', flex: 1 }}>${it.label}</span>
            <span class="num" style=${{ fontWeight: 700 }}>${formatYen(it.value)}</span>
            <span style=${{ color: 'var(--text-4)', fontSize: 11, width: 36, textAlign: 'right' }}>
              ${Math.round(it.value / total * 100)}%
            </span>
          </div>
        `)}
      </div>
    </div>
  `;
}
