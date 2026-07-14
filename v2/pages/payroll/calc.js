/* ============================================================
   NOVA Core v2 — Payroll / Pure calculation helpers

   月次・賞与の給与計算エンジン。
   - 社会保険料: 標準報酬月額 × 料率 ÷ 2（端数は50銭以下切捨て・50銭超切上げ）
   - 所得税: tax-table.js（月額表/電算機特例を年次で自動切替）
   - 子ども・子育て支援金: 2026年4月〜、健保加入者対象
   - 通勤手当: 非課税限度額を自動分離（所得税法施行令20条の2、
     マイカー等は片道距離の段階別上限に対応。距離未入力は安全側=全額課税）
   - 年齢による保険切替: 40/65/70/75歳（生年月日登録時のみ自動判定）
     判定は「到達日=誕生日の前日」（年齢計算ニ関スル法律・民法143条）が
     属する月を基準とする。75歳のみ誕生日当日（後期高齢者医療への移行日）。
   - 産休・育休: 社会保険料免除（健保法159条等）
   ============================================================ */

import {
  STD_REMUNERATION, PENSION_CAP,
  DEFAULT_HEALTH_RATES, DEFAULT_CARE_RATE,
  PENSION_RATE, DEFAULT_EMPLOYMENT_RATES, DEFAULT_CHILD_SUPPORT_RATE,
  CHILD_SUPPORT_FROM,
  EMP_TYPE_MAP,
} from './constants.js';
import { calcIncomeTaxForMonth, getBonusTaxRateForMonth } from './tax-table.js';

// ---- Standard remuneration lookup -----------------------------------------

/**
 * Given average monthly salary, find the 標準報酬月額 (for 健康保険).
 */
export function getHealthStandard(avgMonthlySalary) {
  const n = Number(avgMonthlySalary) || 0;
  for (const [_grade, std, min, max] of STD_REMUNERATION) {
    if (n >= min && n < max) return std;
  }
  return STD_REMUNERATION[STD_REMUNERATION.length - 1][1];
}

/**
 * 厚生年金 standard remuneration is capped at PENSION_CAP (650k).
 */
export function getPensionStandard(avgMonthlySalary) {
  return Math.min(getHealthStandard(avgMonthlySalary), PENSION_CAP);
}

/**
 * Find grade for a given standard remuneration value.
 */
export function findGrade(std) {
  const row = STD_REMUNERATION.find(r => r[1] === std);
  return row ? row[0] : null;
}

/**
 * 従業員マスタから標準報酬「自動」判定の基礎となる報酬月額を求める。
 * calcMonthlyPaycheck の自動判定（basePay + allowance + commuteTotal）と
 * 同じ考え方で、マスタ値のみから月額を組み立てる唯一の規範ヘルパー:
 *   月給制: 月給 + 通勤手当（月額）
 *   時給制: 時給 × 月平均労働時間（未設定は160h） + 通勤手当（月額）
 * （諸手当は月次入力のためマスタ段階では 0 扱い）
 * 一覧表示・モーダルの自動プレビュー・算定基礎届の現標準報酬はすべて
 * getHealthStandard(autoStdBase(emp)) を使うこと。
 */
export function autoStdBase(emp) {
  const typeInfo = EMP_TYPE_MAP[emp.type] || EMP_TYPE_MAP.regular;
  const base = typeInfo.isSalary
    ? Number(emp.monthlySalary) || 0
    : Math.floor((Number(emp.hourlyWage) || 0) * (Number(emp.baseHours) || 160));
  return base + (Number(emp.commuteAllowanceMonthly) || 0);
}

/**
 * 任意の金額を標準報酬月額の等級にスナップする（データ移行の逆算用）。
 */
export function snapToStandard(amount) {
  const n = Number(amount) || 0;
  if (n <= 0) return 0;
  let best = STD_REMUNERATION[0][1];
  let bestDiff = Infinity;
  for (const [, std] of STD_REMUNERATION) {
    const d = Math.abs(std - n);
    if (d < bestDiff) { bestDiff = d; best = std; }
  }
  return best;
}

// ---- 端数処理 ---------------------------------------------------------------

/**
 * 社会保険料の本人負担額の端数処理。
 * 法令: 50銭以下切り捨て、50銭超切り上げ。
 */
export function roundShakai(rawAmount) {
  const yen = Math.floor(rawAmount);
  return (rawAmount - yen) > 0.5 ? yen + 1 : yen;
}

// ---- Insurance premium calculations ---------------------------------------

/** 健康保険料（従業員負担、折半） */
export function calcHealthPremium(stdRemuneration, ratePercent) {
  if (!stdRemuneration || !ratePercent) return 0;
  return roundShakai(stdRemuneration * (ratePercent / 100) / 2);
}

/** 介護保険料（40〜64歳、従業員負担、折半） */
export function calcCarePremium(stdRemuneration, ratePercent) {
  if (!stdRemuneration || !ratePercent) return 0;
  return roundShakai(stdRemuneration * (ratePercent / 100) / 2);
}

/** 厚生年金保険料（従業員負担、折半） */
export function calcPensionPremium(stdRemuneration, ratePercent = PENSION_RATE) {
  if (!stdRemuneration) return 0;
  const capped = Math.min(stdRemuneration, PENSION_CAP);
  return roundShakai(capped * (ratePercent / 100) / 2);
}

/** 雇用保険料（従業員負担、総支給額ベース） */
export function calcEmploymentPremium(grossSalary, employeeRatePercent = DEFAULT_EMPLOYMENT_RATES.employee) {
  if (!grossSalary) return 0;
  return roundShakai(grossSalary * (employeeRatePercent / 100));
}

/** 子ども・子育て支援金（従業員負担、折半、2026年4月〜） */
export function calcChildSupportPremium(stdRemuneration, ratePercent = DEFAULT_CHILD_SUPPORT_RATE) {
  if (!stdRemuneration || !ratePercent) return 0;
  return roundShakai(stdRemuneration * (ratePercent / 100) / 2);
}

// ---- 料率履歴の解決 ----------------------------------------------------------

/**
 * payrollRates コレクション（適用年月付き料率履歴）から、指定月に適用される
 * 料率セットを解決する。履歴が無い月は legacy 設定→既定値へフォールバック。
 *
 * @param month     'YYYY-MM'
 * @param ratesList payrollRates docs: [{effectiveDate, health:{pref:%}, care,
 *                  pension, employmentEmployee, employmentEmployer, childSupport}]
 * @param legacy    旧 settings/payroll_*_rates 由来のフォールバック（省略可）
 * @returns {{health:{}, care, pension, employmentEmployee, employmentEmployer,
 *            childSupport, effectiveDate, source}}
 *          source: 主たる解決元 'history'（料率履歴）| 'legacy'（旧settings）
 *                  | 'default'（コード内既定値）— 監査・警告表示用の追加プロパティ。
 *                  既存の分割代入とは後方互換（プロパティ追加のみ）。
 */
export function getRatesFor(month, ratesList, legacy = {}) {
  const hasLegacy = !!legacy && Object.values(legacy).some(v => v != null);
  const base = {
    health: legacy.health || DEFAULT_HEALTH_RATES,
    care: legacy.care ?? DEFAULT_CARE_RATE,
    pension: legacy.pension ?? PENSION_RATE,
    employmentEmployee: legacy.employmentEmployee ?? DEFAULT_EMPLOYMENT_RATES.employee,
    employmentEmployer: legacy.employmentEmployer ?? DEFAULT_EMPLOYMENT_RATES.employer,
    childSupport: legacy.childSupport ?? DEFAULT_CHILD_SUPPORT_RATE,
    effectiveDate: null,
    source: hasLegacy ? 'legacy' : 'default',
  };
  const hit = (ratesList || [])
    .filter(r => {
      if (!r || !r.effectiveDate) return false;
      // effectiveDate が 'YYYY-MM' 形式でない履歴docは文字列比較が壊れるため無視
      if (!/^\d{4}-\d{2}$/.test(String(r.effectiveDate))) {
        console.warn('[payroll/calc] effectiveDate が YYYY-MM 形式でない料率履歴を無視します:', r.effectiveDate);
        return false;
      }
      return r.effectiveDate <= month;
    })
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
  if (!hit) return base;
  return {
    health: { ...base.health, ...(hit.health || {}) },
    care: hit.care ?? base.care,
    pension: hit.pension ?? base.pension,
    employmentEmployee: hit.employmentEmployee ?? base.employmentEmployee,
    employmentEmployer: hit.employmentEmployer ?? base.employmentEmployer,
    childSupport: hit.childSupport ?? base.childSupport,
    effectiveDate: hit.effectiveDate,
    source: 'history',
  };
}

// ---- 年齢・休職・通勤手当 ------------------------------------------------------

/** 指定月（'YYYY-MM'、月の中央で評価）時点の年齢。生年月日未登録は null。
 *  表示・監査用。保険の有効判定には使わない（判定は ageAttainmentMonth 基準）。 */
export function getAgeAt(birthDate, month) {
  if (!birthDate) return null;
  const bd = new Date(birthDate);
  if (isNaN(bd.getTime())) return null;
  const ref = month ? new Date(month + '-15') : new Date();
  let age = ref.getFullYear() - bd.getFullYear();
  const m = ref.getMonth() - bd.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < bd.getDate())) age--;
  return age;
}

/** 現在の月 'YYYY-MM'（ローカル時刻） */
function currentMonthStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/**
 * 「age歳到達月」('YYYY-MM') を返す。生年月日不正は null。
 * 年齢計算ニ関スル法律・民法143条: 到達日 = age歳の誕生日の「前日」。
 * したがって1日生まれは前日=前月末日となり、到達月は誕生月の前月になる。
 * 例外: 後期高齢者医療（75歳）のみ「誕生日当日」に資格取得するため、
 * onBirthday=true で誕生日当日の属する月を返す。
 * 2/29生まれの平年は Date の繰上げ（3/1）から1日引いて 2/28 が到達日となり法令どおり。
 */
export function ageAttainmentMonth(birthDate, age, onBirthday = false) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(birthDate || ''));
  if (!m) return null;
  const dt = new Date(+m[1] + age, +m[2] - 1, +m[3] - (onBirthday ? 0 : 1));
  if (isNaN(dt.getTime())) return null;
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
}

/**
 * 指定月時点の保険適用状況。判定はすべて「到達月」（到達日=誕生日の前日が
 * 属する月。75歳のみ誕生日当日）と対象月の比較で行う。
 * - 介護保険(2号): 40歳到達日の属する月から徴収開始、
 *   65歳到達日の属する月から徴収終了（=その月の給与天引きなし。以降は1号として市区町村徴収）
 * - 厚生年金: 70歳到達日の属する月から資格喪失（その月の保険料なし）
 * - 健康保険: 75歳の「誕生日当日」に後期高齢者医療へ移行
 *   （誕生日の属する月から健保保険料なし）
 * - 生年月日未登録時は careEligible（手動フラグ）を尊重
 * - 子ども・子育て支援金: 健保加入と同条件
 */
export function getInsuranceStatus(emp, month) {
  const typeInfo = EMP_TYPE_MAP[emp.type] || EMP_TYPE_MAP.regular;
  const age = getAgeAt(emp.birthDate, month);
  const notes = [];

  let health = typeInfo.hasHealth;
  let pension = typeInfo.hasPension;
  let care;

  if (age === null) {
    care = health && !!emp.careEligible;
  } else {
    const m = month || currentMonthStr();
    const m40 = ageAttainmentMonth(emp.birthDate, 40);
    const m65 = ageAttainmentMonth(emp.birthDate, 65);
    const m70 = ageAttainmentMonth(emp.birthDate, 70);
    const m75 = ageAttainmentMonth(emp.birthDate, 75, true);  // 75歳のみ誕生日当日基準
    if (health && m75 && m >= m75) {
      health = false;
      notes.push('75歳到達: 健康保険喪失（誕生日当日から後期高齢者医療へ・当月から保険料なし）');
    }
    if (pension && m70 && m >= m70) {
      pension = false;
      notes.push('70歳到達: 厚生年金資格喪失（到達月から保険料なし）');
    }
    care = health && !!m40 && m >= m40 && !(m65 && m >= m65);
    if (care && !emp.careEligible) notes.push('40〜64歳: 介護保険料を自動適用');
    if (m65 && m >= m65 && emp.careEligible) notes.push('65歳到達: 介護保険料（給与天引き）終了');
  }

  return {
    health, pension, care,
    childSupport: health,
    employment: typeInfo.hasEmployment,
    age, notes: notes.join(' / '),
  };
}

/** 産休・育休中か（社会保険料免除の対象） */
export function isOnLeave(emp) {
  return !!(emp.onMaternityLeave || emp.onChildcareLeave);
}

// ---- マイカー等の距離段階 非課税限度額（所得税法施行令20条の2）--------------
// 各行: [片道距離の上限(km未満), 月額上限(円)]。2km未満は全額課税。
// 出典: 国税庁タックスアンサー No.2585 / 「通勤手当の非課税限度額の改正について」
//  - 〜2025-03支払分: 旧額（上限31,600円）
//  - 2025-04〜: 令和7年11月改正の引上げ額（令和7年4月1日以後支払分に遡及適用）
//  - 2026-04〜: 65km以上の新区分を追加（上限66,400円）
const CAR_COMMUTE_TIERS_OLD = [
  [2, 0], [10, 4200], [15, 7100], [25, 12900], [35, 18700],
  [45, 24400], [55, 28000], [Infinity, 31600],
];
const CAR_COMMUTE_TIERS_R7 = [
  [2, 0], [10, 4200], [15, 7300], [25, 13500], [35, 19700],
  [45, 25900], [55, 32300], [Infinity, 38700],
];
const CAR_COMMUTE_TIERS_R8 = [
  [2, 0], [10, 4200], [15, 7300], [25, 13500], [35, 19700],
  [45, 25900], [55, 32300], [65, 38700], [75, 45700], [85, 52700],
  [95, 59600], [Infinity, 66400],
];

/** マイカー等通勤の月額非課税上限（片道距離 km・対象月から判定） */
export function carCommuteCap(distanceKm, month) {
  const d = Number(distanceKm) || 0;
  const tiers = (month && month < '2025-04') ? CAR_COMMUTE_TIERS_OLD
    : (month && month < '2026-04') ? CAR_COMMUTE_TIERS_R7
    : CAR_COMMUTE_TIERS_R8;
  for (const [upper, cap] of tiers) {
    if (d < upper) return cap;
  }
  return tiers[tiers.length - 1][1];
}

/**
 * 通勤手当の課税・非課税分離。
 * 公共交通機関: 月150,000円まで非課税。
 * マイカー等: 片道距離(km)の段階別上限（carCommuteCap）。
 * 距離未入力は非課税限度額を判定できないため「安全側=全額課税」とし、
 * distanceUnknown フラグで注記する（過少徴収を防ぐ。距離登録で解消）。
 */
export function splitCommuteAllowance(monthly, isPublicTransport = true, distanceKm = null, month = null) {
  const m = Math.max(0, Number(monthly) || 0);
  let cap;
  let distanceUnknown = false;
  if (isPublicTransport) {
    cap = 150000;
  } else if (Number(distanceKm) > 0) {
    cap = carCommuteCap(distanceKm, month);
  } else {
    cap = 0;  // 距離未入力: 全額課税（安全側）。従業員マスタで片道距離の登録が必要
    distanceUnknown = m > 0;
  }
  const nonTaxable = Math.min(m, cap);
  return { total: m, nonTaxable, taxable: m - nonTaxable, cap, distanceUnknown };
}

// ---- Full monthly paycheck calculation ------------------------------------

/**
 * 月次給与を計算する一括関数
 *
 * @param emp    payrollEmployees doc
 * @param input  { month, basePay?, hours?, commission, allowance, deduction,
 *                 commute?, residentTax?, rates }
 *               rates = getRatesFor() の戻り値（または同形状）
 * @returns      { basePay, commission, allowance, deduction,
 *                 commuteTotal, commuteNonTaxable, gross,
 *                 stdRemuneration, health, pension, care, childSupport,
 *                 employment, social, taxable, incomeTax, residentTax,
 *                 totalDed, net, age, insuranceNotes, onLeave }
 */
export function calcMonthlyPaycheck(emp, input = {}) {
  const typeInfo = EMP_TYPE_MAP[emp.type] || EMP_TYPE_MAP.regular;
  const month = input.month || null;
  const commission  = Number(input.commission)  || 0;
  const allowance   = Number(input.allowance)   || 0;
  const deduction   = Number(input.deduction)   || 0;
  const residentTax = Number(input.residentTax ?? emp.residentTax) || 0;
  const rates = input.rates || {};

  // Base pay
  let basePay;
  if (typeInfo.isSalary) {
    basePay = Number(input.basePay ?? emp.monthlySalary) || 0;
  } else {
    const hours = Number(input.hours) || 0;
    const wage  = Number(emp.hourlyWage) || 0;
    basePay = Math.floor(hours * wage);
  }

  // 通勤手当（input.commute で月次上書き可、未指定はマスタ値）
  const commute = splitCommuteAllowance(
    input.commute ?? emp.commuteAllowanceMonthly ?? 0,
    emp.commuteIsPublicTransport !== false,
    emp.commuteDistanceKm,
    month,
  );

  const gross = basePay + commission + allowance + commute.total - deduction;

  // 保険適用状況（年齢・休職を反映）
  const ins = getInsuranceStatus(emp, month);
  const onLeave = isOnLeave(emp);

  // 標準報酬月額: 0 または未設定は「自動計算」
  // 自動判定の報酬月額は基本給のみでなく、諸手当・通勤手当（非課税分含む）
  // を含めた金額で判定する（健康保険法上の「報酬」に通勤手当も含まれるため）。
  const stdHealth  = Number(emp.stdRemuneration) > 0
    ? Number(emp.stdRemuneration)
    : getHealthStandard(basePay + allowance + commute.total);
  const stdPension = Math.min(stdHealth, PENSION_CAP);

  const healthRateResolved = (rates.health?.[emp.prefecture]
    ?? rates.healthRate  // 旧形式との互換
    ?? DEFAULT_HEALTH_RATES[emp.prefecture]);
  const healthRateFallback = healthRateResolved == null;  // 都道府県料率が全経路で未解決
  const healthRate  = healthRateResolved ?? 10.0;
  const careRate    = rates.care ?? rates.careRate ?? DEFAULT_CARE_RATE;
  const pensionRate = rates.pension ?? rates.pensionRate ?? PENSION_RATE;
  const empRate     = rates.employmentEmployee ?? DEFAULT_EMPLOYMENT_RATES.employee;
  const csRate      = rates.childSupport ?? DEFAULT_CHILD_SUPPORT_RATE;

  // 産休・育休中は社会保険料免除（雇用保険・税は免除されない）
  const health  = (!onLeave && ins.health)  ? calcHealthPremium(stdHealth, healthRate) : 0;
  const care    = (!onLeave && ins.care)    ? calcCarePremium(stdHealth, careRate) : 0;
  const pension = (!onLeave && ins.pension) ? calcPensionPremium(stdPension, pensionRate) : 0;
  const childSupport =
    (!onLeave && ins.childSupport && month && month >= CHILD_SUPPORT_FROM)
      ? calcChildSupportPremium(stdHealth, csRate) : 0;
  const employment = ins.employment ? calcEmploymentPremium(gross, empRate) : 0;

  const social = health + care + pension + childSupport + employment;

  // 所得税: 課税対象 = 総支給 − 非課税通勤手当 − 社会保険料本人負担
  const taxable = Math.max(0, gross - commute.nonTaxable - social);
  const incomeTax = calcIncomeTaxForMonth(taxable, emp.dependents || 0, month);

  const totalDed = social + incomeTax + residentTax;
  const net = gross - totalDed;

  let insuranceNotes = ins.notes;
  if (commute.distanceUnknown) {
    insuranceNotes = (insuranceNotes ? insuranceNotes + ' / ' : '')
      + 'マイカー通勤: 片道距離が未入力のため通勤手当を全額課税で計算しています（従業員マスタで片道距離を登録してください）';
  }
  if (ins.health && healthRateFallback) {
    insuranceNotes = (insuranceNotes ? insuranceNotes + ' / ' : '')
      + `健保料率: 都道府県「${emp.prefecture || '未設定'}」の料率が未登録のため10.0%で計算しています（設定→給与料率を確認してください）`;
  }

  return {
    basePay, commission, allowance, deduction,
    commuteTotal: commute.total, commuteNonTaxable: commute.nonTaxable,
    gross,
    stdRemuneration: stdHealth,
    health, pension, care, childSupport, employment,
    social, taxable, incomeTax, residentTax,
    totalDed, net,
    age: ins.age, insuranceNotes, onLeave,
  };
}

// ---- Bonus calculation ----------------------------------------------------

/**
 * 賞与を計算する一括関数
 *
 * @param emp    payrollEmployees doc
 * @param input  { month, amount, prevMonthAfterSocial, hasPrevRecord?, rates }
 *               hasPrevRecord: false のとき「前月中に給与の支払がない」場合の
 *               特殊計算（所得税法186条）を適用する。省略時は率方式だが、
 *               賞与（社保控除後）が前月給与（社保控除後）の10倍を超える場合は
 *               自動的に特殊計算（国税庁タックスアンサーNo.2523）に切り替える。
 * @returns      specialCalc: null（率方式）| 'no-prev'（前月給与なし）
 *               | 'over-10x'（前月給与の10倍超）
 */
export function calcBonusPaycheck(emp, input = {}) {
  const month = input.month || null;
  const amount = Number(input.amount) || 0;
  const prevMonthAfterSocial = Number(input.prevMonthAfterSocial) || 0;
  const hasPrevRecord = input.hasPrevRecord !== false;
  const rates = input.rates || {};

  const ins = getInsuranceStatus(emp, month);
  const onLeave = isOnLeave(emp);

  // 標準賞与額: 1,000円未満切捨て
  // 健保: 年度累計573万円上限（簡易実装のため単月ではカットしない）
  // 厚年: 1回あたり150万円上限
  const stdBonus    = Math.floor(amount / 1000) * 1000;
  const healthBase  = stdBonus;
  const pensionBase = Math.min(stdBonus, 1500000);

  const healthRateResolved = (rates.health?.[emp.prefecture]
    ?? rates.healthRate ?? DEFAULT_HEALTH_RATES[emp.prefecture]);
  const healthRateFallback = healthRateResolved == null;
  const healthRate  = healthRateResolved ?? 10.0;
  const careRate    = rates.care ?? rates.careRate ?? DEFAULT_CARE_RATE;
  const pensionRate = rates.pension ?? rates.pensionRate ?? PENSION_RATE;
  const empRate     = rates.employmentEmployee ?? DEFAULT_EMPLOYMENT_RATES.employee;
  const csRate      = rates.childSupport ?? DEFAULT_CHILD_SUPPORT_RATE;

  const health  = (!onLeave && ins.health)  ? roundShakai(healthBase  * (healthRate  / 100) / 2) : 0;
  const care    = (!onLeave && ins.care)    ? roundShakai(healthBase  * (careRate    / 100) / 2) : 0;
  const pension = (!onLeave && ins.pension) ? roundShakai(pensionBase * (pensionRate / 100) / 2) : 0;
  const childSupport =
    (!onLeave && ins.childSupport && month && month >= CHILD_SUPPORT_FROM)
      ? roundShakai(healthBase * (csRate / 100) / 2) : 0;
  const employment = ins.employment ? roundShakai(amount * (empRate / 100)) : 0;

  const social = health + care + pension + childSupport + employment;

  const taxableBonus = Math.max(0, amount - social);
  const dep = emp.dependents || 0;
  let incomeTax;
  let rate = null;
  let specialCalc = null;  // null | 'no-prev' | 'over-10x'
  if (!hasPrevRecord) {
    // 特殊計算①（所得税法186条）: 前月中に給与の支払がない場合、
    // (賞与 − 社保) ÷ 6（1円未満切捨て）を月額表（甲欄）に当てて求めた税額 × 6。
    // ※賞与の計算期間が6ヶ月超の場合は ÷12 ×12 だが、本システムは
    //   6ヶ月以下（年2回賞与）を前提とする。
    specialCalc = 'no-prev';
    const monthlyEquiv = Math.floor(taxableBonus / 6);
    incomeTax = calcIncomeTaxForMonth(monthlyEquiv, dep, month) * 6;
  } else if (taxableBonus > prevMonthAfterSocial * 10) {
    // 特殊計算②（所得税法186条・国税庁タックスアンサーNo.2523）:
    // 賞与（社保控除後）が前月給与（社保控除後）の10倍を「超える」場合、
    //   税額 = { 月額表税額( (賞与−社保)÷6 ＋ 前月の社保控除後給与 )
    //            − 月額表税額( 前月の社保控除後給与 ) } × 6
    // ÷6 は1円未満切捨て。10倍ちょうどは率方式のまま（「超える場合」のみ）。
    // ※計算期間6ヶ月超は ÷12 ×12 だが、本システムは6ヶ月以下を前提とする。
    specialCalc = 'over-10x';
    const monthlyEquiv = Math.floor(taxableBonus / 6);
    const taxWithBonus = calcIncomeTaxForMonth(monthlyEquiv + prevMonthAfterSocial, dep, month);
    const taxPrevOnly  = calcIncomeTaxForMonth(prevMonthAfterSocial, dep, month);
    incomeTax = Math.max(0, taxWithBonus - taxPrevOnly) * 6;
  } else {
    // 通常: 賞与所得税 = (賞与 − 社保) × 算出率（1円未満切捨て）
    rate = getBonusTaxRateForMonth(prevMonthAfterSocial, dep, month);
    incomeTax = Math.floor(taxableBonus * rate);
  }

  const totalDed = social + incomeTax;
  const net = amount - totalDed;

  let insuranceNotes = ins.notes;
  if (ins.health && healthRateFallback) {
    insuranceNotes = (insuranceNotes ? insuranceNotes + ' / ' : '')
      + `健保料率: 都道府県「${emp.prefecture || '未設定'}」の料率が未登録のため10.0%で計算しています（設定→給与料率を確認してください）`;
  }

  return {
    amount, health, pension, care, childSupport, employment,
    social, incomeTax, taxRate: rate, specialCalc, totalDed, net,
    age: ins.age, insuranceNotes, onLeave,
  };
}
