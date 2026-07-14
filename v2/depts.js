/* ============================================================
   NOVA Core v2 — 事業（部門）マスタの動的管理

   Firestore `salesDepts` コレクション（doc id = 部門キー）:
     { label, short, color, order, archived }

   - initDepts(): ログイン後に一度だけ購読を開始。空なら静的5部門を
     シード（boat/food は archived）。shared.js のキャッシュを更新する
     ので、既存の deptLabel()/deptColor() 同期呼び出しがそのまま動く。
   - useDepts(): 部門一覧を返す Preact フック（一覧・セレクト用）。
   ============================================================ */

import { useState, useEffect } from 'https://esm.sh/preact@10.22.0/hooks';
import { repos } from './store.js';
import { SALES_DEPTS, setDepts, getDepts, onDeptsChange } from './shared.js';

let _unsub = null;
let _seeding = false;

export function initDepts() {
  if (_unsub) return;
  _unsub = repos.salesDepts.subscribe(async (docs) => {
    if (!docs || docs.length === 0) {
      // 初回のみ静的5部門をシード（並行アクセスでも setId は冪等）
      if (_seeding) return;
      _seeding = true;
      try {
        for (const d of SALES_DEPTS) {
          const { key, ...rest } = d;
          await repos.salesDepts.setId(key, { ...rest, archived: !!d.archived });
        }
      } catch (e) {
        console.warn('[depts] seed failed (static fallback continues):', e);
      } finally {
        _seeding = false;
      }
      return; // 購読がシード結果で再発火する
    }
    const list = docs
      .map(d => ({
        key: d.id,
        label: d.label || d.id,
        short: d.short || (d.label || d.id).slice(0, 2),
        color: d.color || '#64748b',
        order: Number(d.order) || 99,
        archived: !!d.archived,
      }))
      .sort((a, b) => (a.order - b.order) || a.key.localeCompare(b.key));
    setDepts(list);
  });
}

export function stopDepts() {
  if (_unsub) { _unsub(); _unsub = null; }
  setDepts(null); // 静的フォールバックへ戻す
}

/**
 * 部門一覧を返すフック。
 * @param includeArchived false でアーカイブ済み（競艇など）を除外
 */
export function useDepts({ includeArchived = true } = {}) {
  const [list, setList] = useState(() => getDepts({ includeArchived }));
  useEffect(() => {
    setList(getDepts({ includeArchived }));
    return onDeptsChange(() => setList(getDepts({ includeArchived })));
  }, [includeArchived]);
  return list;
}
