/* ============================================================
   NOVA Core v2 — Payroll / Constants
   Standard remuneration table, tax brackets, employment types.
   Rates themselves are user-configurable via rates.js.
   ============================================================ */

// ---- Employment types ------------------------------------------------------

export const EMP_TYPES = [
  {
    id: 'executive',
    label: '役員',
    isSalary: true,
    hasHealth: true,  hasPension: true,  hasEmployment: false,
    note: '月給制・雇用保険なし（役員は対象外）',
  },
  {
    id: 'regular',
    label: '正社員',
    isSalary: true,
    hasHealth: true,  hasPension: true,  hasEmployment: true,
    note: '月給制・全保険加入',
  },
  {
    id: 'contract',
    label: '契約社員',
    isSalary: true,
    hasHealth: true,  hasPension: true,  hasEmployment: true,
    note: '月給制・全保険加入',
  },
  {
    id: 'parttime-full',
    label: 'パート（週30h以上）',
    isSalary: false,
    hasHealth: true,  hasPension: true,  hasEmployment: true,
    note: '時給制・全保険加入',
  },
  {
    id: 'parttime-short',
    label: 'パート（週20-30h）',
    isSalary: false,
    hasHealth: false, hasPension: false, hasEmployment: true,
    note: '時給制・雇用保険のみ（103万円の壁に注意）',
  },
  {
    id: 'arbeit',
    label: 'アルバイト',
    isSalary: false,
    hasHealth: false, hasPension: false, hasEmployment: false,
    note: '時給制・保険なし（103万円の壁に注意）',
  },
];
export const EMP_TYPE_MAP = Object.fromEntries(EMP_TYPES.map(t => [t.id, t]));

// ---- Prefectures (for 健康保険料率) ---------------------------------------
// Only show the 4 v1 had. More can be added to rates.js.
export const PREFECTURES = [
  { id: 'tokyo',    label: '東京都' },
  { id: 'kanagawa', label: '神奈川県' },
  { id: 'aichi',    label: '愛知県' },
  { id: 'gifu',     label: '岐阜県' },
];

// ---- Default rates（料率履歴 payrollRates が無い月のフォールバック）---------
// 実際の計算は payrollRates コレクション（適用年月付き履歴）を優先する。
// ここは令和8年度（2026年度）の公表値。

// 健康保険料率（協会けんぽ、令和8年3月分〜）% = 折半前の総料率
export const DEFAULT_HEALTH_RATES = {
  tokyo:    9.85,
  kanagawa: 9.92,
  aichi:    9.93,
  gifu:     9.80,
};

// 介護保険料率 (40〜64歳) — 全国共通、令和8年3月分〜
export const DEFAULT_CARE_RATE = 1.62;  // 折半前

// 厚生年金保険料率 — 全国共通固定（2017年以降）
export const PENSION_RATE = 18.30;  // 折半前

// 雇用保険料率（一般の事業、令和8年4月〜）
// 雇用保険は従業員負担率と事業主負担率が異なる（二事業分の事業主単独負担あり）
export const DEFAULT_EMPLOYMENT_RATES = {
  employee: 0.50,  // 従業員負担 (%)
  employer: 0.85,  // 事業主負担 (%)
};

// 子ども・子育て支援金率 — 全国共通、2026年4月分〜（折半前）
export const DEFAULT_CHILD_SUPPORT_RATE = 0.23;
export const CHILD_SUPPORT_FROM = '2026-04';

// ---- 料率プリセット（rates.js の「プリセット適用」で payrollRates へ登録）----
// 出典: 協会けんぽ 令和8年度都道府県別料率 / 厚労省 令和8年度雇用保険料率
// ※健保・介護は3月分から、雇用保険は4月から適用が始まるため2レコードに分かれる
export const RATE_PRESETS = [
  {
    effectiveDate: '2026-03',
    label: '令和8年度 健保・介護改定（2026年3月分〜）',
    health: { tokyo: 9.85, kanagawa: 9.92, aichi: 9.93, gifu: 9.80 },
    care: 1.62,
    pension: 18.30,
    employmentEmployee: 0.55,  // 雇用保険は令和7年度料率のまま
    employmentEmployer: 0.90,
    childSupport: 0.23,
    note: '協会けんぽ令和8年度（東京9.85/神奈川9.92/愛知9.93/岐阜9.80、介護1.62）',
  },
  {
    effectiveDate: '2026-04',
    label: '令和8年度 雇用保険改定 + 子育て支援金開始（2026年4月〜）',
    health: { tokyo: 9.85, kanagawa: 9.92, aichi: 9.93, gifu: 9.80 },
    care: 1.62,
    pension: 18.30,
    employmentEmployee: 0.50,
    employmentEmployer: 0.85,
    childSupport: 0.23,
    note: '雇用保険（一般）労働者0.5%/事業主0.85%。子ども・子育て支援金0.23%開始',
  },
];

// ---- 標準報酬月額表（健康保険）--- 令和6年3月 ------------------------------
// [等級, 標準報酬月額, 月給下限, 月給上限未満]
export const STD_REMUNERATION = [
  [1,   58000,        0,   63000 ],
  [2,   68000,    63000,   73000 ],
  [3,   78000,    73000,   83000 ],
  [4,   88000,    83000,   93000 ],
  [5,   98000,    93000,  101000 ],
  [6,  104000,   101000,  107000 ],
  [7,  110000,   107000,  114000 ],
  [8,  118000,   114000,  122000 ],
  [9,  126000,   122000,  130000 ],
  [10, 134000,   130000,  138000 ],
  [11, 142000,   138000,  146000 ],
  [12, 150000,   146000,  155000 ],
  [13, 160000,   155000,  165000 ],
  [14, 170000,   165000,  175000 ],
  [15, 180000,   175000,  185000 ],
  [16, 190000,   185000,  195000 ],
  [17, 200000,   195000,  210000 ],
  [18, 220000,   210000,  230000 ],
  [19, 240000,   230000,  250000 ],
  [20, 260000,   250000,  270000 ],
  [21, 280000,   270000,  290000 ],
  [22, 300000,   290000,  310000 ],
  [23, 320000,   310000,  330000 ],
  [24, 340000,   330000,  350000 ],
  [25, 360000,   350000,  370000 ],
  [26, 380000,   370000,  395000 ],
  [27, 410000,   395000,  425000 ],
  [28, 440000,   425000,  455000 ],
  [29, 470000,   455000,  485000 ],
  [30, 500000,   485000,  515000 ],
  [31, 530000,   515000,  545000 ],
  [32, 560000,   545000,  575000 ],
  [33, 590000,   575000,  605000 ],
  [34, 620000,   605000,  635000 ],
  [35, 650000,   635000,  665000 ],
  [36, 680000,   665000,  695000 ],
  [37, 710000,   695000,  730000 ],
  [38, 750000,   730000,  770000 ],
  [39, 790000,   770000,  810000 ],
  [40, 830000,   810000,  855000 ],
  [41, 880000,   855000,  905000 ],
  [42, 930000,   905000,  955000 ],
  [43, 980000,   955000, 1005000 ],
  [44, 1030000, 1005000, 1055000 ],
  [45, 1090000, 1055000, 1115000 ],
  [46, 1150000, 1115000, 1175000 ],
  [47, 1210000, 1175000, 1235000 ],
  [48, 1270000, 1235000, 1295000 ],
  [49, 1330000, 1295000, 1355000 ],
  [50, 1390000, 1355000, Infinity ],
];

// 厚生年金は 32等級 / 上限 650,000円
export const PENSION_CAP = 650000;

// ---- 年収の壁 -------------------------------------------------------------

export const INCOME_WALLS = [
  { threshold: 1030000, label: '103万円の壁',
    description: '本人に所得税が発生。配偶者控除の対象外に。',
  },
  { threshold: 1060000, label: '106万円の壁',
    description: '従業員51人以上企業・週20h以上で社会保険加入義務。',
  },
  { threshold: 1300000, label: '130万円の壁',
    description: '社会保険の扶養から外れる。健康保険・年金を自己負担。',
  },
  { threshold: 1500000, label: '150万円の壁',
    description: '配偶者特別控除の段階的縮小開始。',
  },
  { threshold: 2010000, label: '201万円の壁',
    description: '配偶者特別控除の対象外に。',
  },
];
