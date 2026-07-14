/* ============================================================
   NOVA Core v2 — Payroll / Pure calculation helpers

   月次・賞与の給与計算エンジン。
   - 社会保険料: 標準報酬月額 × 料率 ÷ 2（端数は50銭以下切捨て・50銭超切上げ）
   - 所得税: tax-table.js（月額表/電算機特例を年次で自動切替）
   - 子ども・子育て支援金: 2026年4月〜、健保加入者対象
   - 通勤手当: 非課税限度額を自動分離（所得税法施行令20条の2）
   - 年齢による保険切替: 40/65/70/75歳（生年月日登録時のみ自動判定）
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
 * @returns {{health:{}, care, pension, employmentEmployee, employmentEmployer, childSupport, effectiveDate}}
 */
export function getRatesFor(month, ratesList, legacy = {}) {
  const base = {
    health: legacy.health || DEFAULT_HEALTH_RATES,
    care: legacy.care ?? DEFAULT_CARE_RATE,
    pension: legacy.pension ?? PENSION_RATE,
    employmentEmployee: legacy.employmentEmployee ?? DEFAULT_EMPLOYMENT_RATES.employee,
    employmentEmployer: legacy.employmentEmployer ?? DEFAULT_EMPLOYMENT_RATES.employer,
    childSupport: legacy.childSupport ?? DEFAULT_CHILD_SUPPORT_RATE,
    effectiveDate: null,
  };
  const hit = (ratesList || [])
    .filter(r => r && r.effectiveDate && r.effectiveDate <= month)
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
  };
}

// ---- 年齢・休職・通勤手当 ------------------------------------------------------

/** 指定月（'YYYY-MM'、月の中央で評価）時点の年齢。生年月日未登録は null。 */
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

/**
 * 指定月時点の保険適用状況。
 * - 介護保険: 40〜64歳（健保加入者のみ）。生年月日未登録時は careEligible を尊重
 * - 厚生年金: 70歳到達で資格喪失 / 健康保険: 75歳到達で喪失
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
    if (health && age >= 75) { health = false; notes.push('75歳到達: 健康保険喪失（後期高齢者医療へ）'); }
    if (pension && age >= 70) { pension = false; notes.push('70歳到達: 厚生年金資格喪失'); }
    care = health && age >= 40 && age < 65;
    if (care && !emp.careEligible) notes.push('40〜64歳: 介護保険料を自動適用');
    if (age >= 65 && emp.careEligible) notes.push('65歳到達: 介護保険料（給与天引き）終了');
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

/**
 * 通勤手当の課税・非課税分離。
 * 公共交通機関: 月150,000円まで非課税。マイカー等: 距離未登録のため
 * 最高額31,600円（片道55km以上相当）を上限として適用。
 */
export function splitCommuteAllowance(monthly, isPublicTransport = true) {
  const m = Math.max(0, Number(monthly) || 0);
  const cap = isPublicTransport ? 150000 : 31600;
  const nonTaxable = Math.min(m, cap);
  return { total: m, nonTaxable, taxable: m - nonTaxable, cap };
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
  );

  const gross = basePay + commission + allowance + commute.total - deduction;

  // 保険適用状況（年齢・休職を反映）
  const ins = getInsuranceStatus(emp, month);
  const onLeave = isOnLeave(emp);

  // 標準報酬月額: 0 または未設定は「自動計算」
  const stdHealth  = Number(emp.stdRemuneration) > 0
    ? Number(emp.stdRemuneration)
    : getHealthStandard(basePay);
  const stdPension = Math.min(stdHealth, PENSION_CAP);

  const healthRate = (rates.health?.[emp.prefecture]
    ?? rates.healthRate  // 旧形式との互換
    ?? DEFAULT_HEALTH_RATES[emp.prefecture] ?? 10.0);
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

  return {
    basePay, commission, allowance, deduction,
    commuteTotal: commute.total, commuteNonTaxable: commute.nonTaxable,
    gross,
    stdRemuneration: stdHealth,
    health, pension, care, childSupport, employment,
    social, taxable, incomeTax, residentTax,
    totalDed, net,
    age: ins.age, insuranceNotes: ins.notes, onLeave,
  };
}

// ---- Bonus calculation ----------------------------------------------------

/**
 * 賞与を計算する一括関数
 *
 * @param emp    payrollEmployees doc
 * @param input  { month, amount, prevMonthAfterSocial, rates }
 */
export function calcBonusPaycheck(emp, input = {}) {
  const month = input.month || null;
  const amount = Number(input.amount) || 0;
  const prevMonthAfterSocial = Number(input.prevMonthAfterSocial) || 0;
  const rates = input.rates || {};

  const ins = getInsuranceStatus(emp, month);
  const onLeave = isOnLeave(emp);

  // 標準賞与額: 1,000円未満切捨て
  // 健保: 年度累計573万円上限（簡易実装のため単月ではカットしない）
  // 厚年: 1回あたり150万円上限
  const stdBonus    = Math.floor(amount / 1000) * 1000;
  const healthBase  = stdBonus;
  const pensionBase = Math.min(stdBonus, 1500000);

  const healthRate  = (rates.health?.[emp.prefecture]
    ?? rates.healthRate ?? DEFAULT_HEALTH_RATES[emp.prefecture] ?? 10.0);
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

  // 賞与所得税 = (賞与 − 社保) × 算出率（1円未満切捨て）
  const rate = getBonusTaxRateForMonth(prevMonthAfterSocial, emp.dependents || 0, month);
  const incomeTax = Math.floor(Math.max(0, amount - social) * rate);

  const totalDed = social + incomeTax;
  const net = amount - totalDed;

  return {
    amount, health, pension, care, childSupport, employment,
    social, incomeTax, taxRate: rate, totalDed, net,
    age: ins.age, insuranceNotes: ins.notes, onLeave,
  };
}
