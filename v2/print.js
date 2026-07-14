/* ============================================================
   NOVA Core v2 — 印刷オーバーレイ用ポータル

   問題: オーバーレイをページコンポーネント内に描画すると、印刷時に
   祖先（.app-shell / .main の overflow:hidden、body の height:100vh、
   サイドバーのレイアウト占有）にクリップされ「サイドバー分ズレた
   1ページだけの PDF」になる。

   解決: createPortal で overlay を document.body 直下（#app の外）に
   描画し、印刷時は #app を display:none で丸ごと消す。
   これで visibility:hidden ハックが不要になり、複数ページの
   page-break も通常フローで正しく機能する。

   使い方:
     import { PrintPortal } from '../../print.js';
     return html`<${PrintPortal}> ...overlay... </${PrintPortal}>`;

   対応する印刷 CSS は styles.css の
   `@media print { body.has-print-overlay #app { display:none } }`。
   ============================================================ */

import { useEffect } from 'https://esm.sh/preact@10.22.0/hooks';
import { createPortal } from 'https://esm.sh/preact@10.22.0/compat';

export function PrintPortal({ children }) {
  useEffect(() => {
    document.documentElement.classList.add('has-print-overlay');
    document.body.classList.add('has-print-overlay');
    return () => {
      document.documentElement.classList.remove('has-print-overlay');
      document.body.classList.remove('has-print-overlay');
    };
  }, []);
  return createPortal(children, document.body);
}
