/* ============================================================
   NOVA Core v2 — Documents / Constants
   ============================================================ */

export const DOC_DEPTS = [
  { id: 'all',     label: 'すべて',              icon: '📁', color: '#64748b' },
  { id: 'honbu',   label: '本部（有限会社NOVA）', icon: '🏢', color: '#6366f1' },
  { id: 'sns_af',  label: 'SNSアフィリエイト',   icon: '📱', color: '#7c3aed' },
  { id: 'sns_con', label: 'SNSコンサル',         icon: '💼', color: '#0891b2' },
  { id: 'content', label: '制作コンテンツ',       icon: '🎨', color: '#ec4899' },
  { id: 'other',   label: 'その他',              icon: '📦', color: '#64748b' },
  // Legacy depts (shown only if data exists)
  { id: 'food',    label: '飲食（あん庵）',       icon: '🍽', color: '#059669', legacy: true },
  { id: 'boat',    label: '競艇事業',            icon: '🚤', color: '#d97706', legacy: true },
  // Catchall for imports with any other value
  { id: 'unknown', label: '未分類',              icon: '❓', color: '#94a3b8', synthetic: true },
];
export const DEPT_MAP = Object.fromEntries(DOC_DEPTS.map(d => [d.id, d]));

export const DOC_TYPES = [
  { id: 'all',         label: 'すべて',            icon: '📄' },
  { id: 'invoice_out', label: '請求書（発行）',    icon: '📑', dir: 'out' },
  { id: 'invoice_in',  label: '請求書（受領）',    icon: '📑', dir: 'in'  },
  { id: 'receipt',     label: '領収書',            icon: '🧾', dir: 'in'  },
  { id: 'delivery',    label: '納品書',            icon: '📦', dir: 'in'  },
  { id: 'contract',    label: '契約書',            icon: '📝' },
  { id: 'quote',       label: '見積書',            icon: '💰' },
  { id: 'tax',         label: '税務書類',          icon: '🏛' },
  { id: 'hr',          label: '人事書類',          icon: '👤' },
  { id: 'other',       label: 'その他',            icon: '📋' },
];
export const TYPE_MAP = Object.fromEntries(DOC_TYPES.map(t => [t.id, t]));

export const DOC_DIRS = [
  { id: 'all', label: 'すべて' },
  { id: 'out', label: '発行（自社→）' },
  { id: 'in',  label: '受領（→自社）' },
];

export const DOC_STATUSES = [
  { id: 'active',   label: '📌 有効',      color: '#6366f1' },
  { id: 'draft',    label: '✏️ 下書き',    color: '#94a3b8' },
  { id: 'pending',  label: '⏳ 処理待ち',  color: '#d97706' },
  { id: 'archived', label: '📦 アーカイブ', color: '#64748b' },
];
export const STATUS_MAP = Object.fromEntries(DOC_STATUSES.map(s => [s.id, s]));

/** Return direction for a document based on its type. */
export function typeDir(typeId) {
  return TYPE_MAP[typeId]?.dir || 'both';
}

/** Resolve dept object, falling back to "unknown" for unrecognized values. */
export function resolveDept(deptId) {
  return DEPT_MAP[deptId] || DEPT_MAP.unknown;
}
export function resolveType(typeId) {
  return TYPE_MAP[typeId] || TYPE_MAP.other;
}
export function resolveStatus(statusId) {
  return STATUS_MAP[statusId] || STATUS_MAP.active;
}
