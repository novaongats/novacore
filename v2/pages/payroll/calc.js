/* ============================================================
   NOVA Core v2 — Payroll / Pure calculation helpers
   ============================================================ */

import {
  STD_REMUNERATION, PENSION_CAP,
  DEFAULT_HEALTH_RATES, DEFAULT_CARE_RATE,
  PENSION_RATE, DEFAULT_EMPLOYMENT_RATES,
  EMP_TYPE_MAP,
} from './constants.js';

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
 * 厚生年金 standard remuneration is capped at PENSION_CAP (650k as of 2024).
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

// ---- Insurance premium calculations ---------------------------------------

/**
 * 健康保険料（従業員負担、折半）= 標準報酬月額 × rate / 2
 * rate は都道府県別（%）。protocol: round to whole yen.
 */
export function calcHealthPremium(stdRemuneration, ratePercent) {
  if (!stdRemuneration || !ratePercent) return 0;
  const total = stdRemuneration * (ratePercent / 100);
  return Math.round(total / 2);
}

/**
 * 介護保険料（40歳以上、従業員負担、折半）
 */
export function calcCarePremium(stdRemuneration, ratePercent) {
  if (!stdRemuneration || !ratePercent) return 0;
  const total = stdRemuneration * (ratePercent / 100);
  return Math.round(total / 2);
}

/**
 * 厚生年金保険料（従業員負担、折半）= 標準報酬月額 × 18.30% / 2
 */
export function calcPensionPremium(stdRemuneration, ratePercent = PENSION_RATE) {
  if (!stdRemuneration) return 0;
  const capped = Math.min(stdRemuneration, PENSION_CAP);
  const total = capped * (ratePercent / 100);
  return Math.round(total / 2);
}

/**
 * 雇用保険料（従業員負担）= 総支給額 × 0.6%
 */
export function calcEmploymentPremium(grossSalary, employeeRatePercent = DEFAULT_EMPLOYMENT_RATES.employee) {
  if (!grossSalary) return 0;
  return Math.round(grossSalary * (employeeRatePercent / 100));
}

// ---- Income tax (源泉所得税 月額表 甲欄) -----------------------------------

/**
 * 月次源泉徴収税額を計算
 *
 * 2025 年時点の 月額表 甲欄 の近似計算式。
 * 実際の国税庁発行の表と±数円のズレがある場合あり。
 *
 * @param grossSalary  総支給額
 * @param socialIns    社会保険料合計 (健保 + 年金 + 介護 + 雇保)
 * @param dependents   扶養親族等の数 (配偶者含む)
 */
export function calcIncomeTax(grossSalary, socialIns, dependents = 0) {
  const gross = Number(grossSalary) || 0;
  const social = Number(socialIns) || 0;
  const dep = Math.max(0, Number(dependents) || 0);

  // 課税対象額 = 総支給 − 社保 − 扶養控除相当
  const taxable = Math.max(0, gross - social - dep * 38000);
  if (taxable < 88000) return 0;

  // 2025 月額表 甲欄 （簡略化した傾き近似）
  let tax;
  if (taxable <  260000) tax = (taxable -   88000) * 0.05105;
  else if (taxable <  439000) tax =   8780 + (taxable -  260000) * 0.10210;
  else if (taxable <  706000) tax =  27070 + (taxable -  439000) * 0.20421;
  else if (taxable < 1017000) tax =  81550 + (taxable -  706000) * 0.23483;
  else if (taxable < 2220000) tax = 154620 + (taxable - 1017000) * 0.33693;
  else                        tax = 560060 + (taxable - 2220000) * 0.40840;

  return Math.round(tax);
}

// ---- Bonus tax rate (賞与源泉徴収税額表 甲欄) ------------------------------

/**
 * 賞与に対する源泉徴収税率を返す（小数、例: 0.1021 = 10.21%）。
 * 前月の「社会保険料控除後の給与」とその扶養人数で決定。
 */
export function getBonusTaxRate(prevMonthAfterSocial, dependents = 0) {
  const gross = Number(prevMonthAfterSocial) || 0;
  const dep = Math.max(0, Number(dependents) || 0);

  // 扶養人数別の閾値テーブル（抜粋・主要部分）
  // 2025 賞与源泉徴収税額表 甲欄
  // 下表: [閾値下限, 扶養0, 扶養1, 扶養2, 扶養3, 扶養4]
  const table = [
    [     0, 0,       0,       0,       0,       0      ],
    [ 68000, 0,       0,       0,       0,       0      ],
    [ 79000, 0.02042, 0,       0,       0,       0      ],
    [252000, 0.04084, 0.02042, 0,       0,       0      ],
    [300000, 0.06126, 0.04084, 0.02042, 0,       0      ],
    [334000, 0.06126, 0.06126, 0.04084, 0.02042, 0      ],
    [363000, 0.08168, 0.06126, 0.06126, 0.04084, 0.02042],
    [395000, 0.08168, 0.08168, 0.06126, 0.06126, 0.04084],
    [426000, 0.10210, 0.08168, 0.08168, 0.06126, 0.06126],
    [520000, 0.10210, 0.10210, 0.10210, 0.08168, 0.08168],
    [601000, 0.12252, 0.12252, 0.10210, 0.10210, 0.10210],
    [678000, 0.14294, 0.12252, 0.12252, 0.12252, 0.10210],
    [708000, 0.14294, 0.14294, 0.14294, 0.12252, 0.12252],
    [745000, 0.16336, 0.16336, 0.14294, 0.14294, 0.14294],
    [788000, 0.18378, 0.16336, 0.16336, 0.16336, 0.14294],
    [846000, 0.18378, 0.18378, 0.18378, 0.16336, 0.16336],
    [914000, 0.20420, 0.18378, 0.18378, 0.18378, 0.18378],
    [1312000, 0.22462, 0.22462, 0.22462, 0.22462, 0.22462],
    [1521000, 0.24504, 0.24504, 0.24504, 0.24504, 0.24504],
    [2621000, 0.26547, 0.26547, 0.26547, 0.26547, 0.26547],
    [3495000, 0.28589, 0.28589, 0.28589, 0.28589, 0.28589],
    [Infinity, 0.30631, 0.30631, 0.30631, 0.30631, 0.30631],
  ];
  const depIdx = Math.min(dep, 4) + 1;
  for (let i = table.length - 1; i >= 0; i--) {
    if (gross >= table[i][0]) return table[i][depIdx];
  }
  return 0;
}

/**
 * 賞与所得税の計算
 */
export function calcBonusIncomeTax(bonusAmount, socialInsOnBonus, prevMonthAfterSocial, dependents = 0) {
  const rate = getBonusTaxRate(prevMonthAfterSocial, dependents);
  const taxable = Math.max(0, (Number(bonusAmount) || 0) - (Number(socialInsOnBonus) || 0));
  return Math.round(taxable * rate);
}

// ---- Full monthly paycheck calculation ------------------------------------

/**
 * 月次給与を計算する一括関数
 *
 * @param emp       payrollEmployees doc
 * @param input     { basePay?, hours?, commission, allowance, deduction, residentTax, rates }
 * @returns         { basePay, commission, allowance, deduction, gross, health, pension, care,
 *                    employment, social, incomeTax, residentTax, totalDed, net }
 */
export function calcMonthlyPaycheck(emp, input = {}) {
  const typeInfo = EMP_TYPE_MAP[emp.type] || EMP_TYPE_MAP.regular;
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
    const hours   = Number(input.hours) || 0;
    const wage    = Number(emp.hourlyWage) || 0;
    basePay = Math.round(hours * wage);
  }

  const gross = basePay + commission + allowance - deduction;

  // Insurance premiums
  // 標準報酬月額: 0 または未設定は「自動計算」（employees.js は未入力を 0 で保存する）
  const stdHealth  = Number(emp.stdRemuneration) > 0 ? Number(emp.stdRemuneration) : getHealthStandard(basePay);
  const stdPension = Math.min(stdHealth, PENSION_CAP);

  const healthRate     = typeInfo.hasHealth ? (rates.healthRate ?? DEFAULT_HEALTH_RATES[emp.prefecture] ?? 10.0) : 0;
  const careRate       = (typeInfo.hasHealth && emp.careEligible) ? (rates.careRate ?? DEFAULT_CARE_RATE) : 0;
  const pensionRateP   = typeInfo.hasPension ? (rates.pensionRate ?? PENSION_RATE) : 0;
  const empEmployeeRate = typeInfo.hasEmployment ? (rates.employmentEmployee ?? DEFAULT_EMPLOYMENT_RATES.employee) : 0;

  const health      = calcHealthPremium(stdHealth, healthRate);
  const care        = calcCarePremium(stdHealth, careRate);
  const pension     = calcPensionPremium(stdPension, pensionRateP);
  const employment  = calcEmploymentPremium(gross, empEmployeeRate);
  const social      = health + care + pension + employment;

  // Income tax
  const incomeTax = calcIncomeTax(gross, social, emp.dependents || 0);

  // Net
  const totalDed = social + incomeTax + residentTax;
  const net = gross - totalDed;

  return {
    basePay, commission, allowance, deduction, gross,
    stdRemuneration: stdHealth,
    health, pension, care, employment,
    social, incomeTax, residentTax,
    totalDed, net,
  };
}

// ---- Bonus calculation ----------------------------------------------------

export function calcBonusPaycheck(emp, input = {}) {
  const typeInfo = EMP_TYPE_MAP[emp.type] || EMP_TYPE_MAP.regular;
  const amount = Number(input.amount) || 0;
  const prevMonthAfterSocial = Number(input.prevMonthAfterSocial) || 0;
  const rates = input.rates || {};

  // Insurance (based on actual bonus amount, capped at 特別上限)
  // 健保: 年累計上限 573万円。簡易実装では単月カット無し
  // 厚年: 1回 150万円上限
  const healthBase  = amount;
  const pensionBase = Math.min(amount, 1500000);

  const healthRate     = typeInfo.hasHealth ? (rates.healthRate ?? DEFAULT_HEALTH_RATES[emp.prefecture] ?? 10.0) : 0;
  const careRate       = (typeInfo.hasHealth && emp.careEligible) ? (rates.careRate ?? DEFAULT_CARE_RATE) : 0;
  const pensionRateP   = typeInfo.hasPension ? (rates.pensionRate ?? PENSION_RATE) : 0;
  const empEmployeeRate = typeInfo.hasEmployment ? (rates.employmentEmployee ?? DEFAULT_EMPLOYMENT_RATES.employee) : 0;

  const health      = Math.round(healthBase  * (healthRate  / 100) / 2);
  const care        = Math.round(healthBase  * (careRate    / 100) / 2);
  const pension     = Math.round(pensionBase * (pensionRateP / 100) / 2);
  const employment  = Math.round(amount * (empEmployeeRate / 100));
  const social      = health + care + pension + employment;

  const incomeTax = calcBonusIncomeTax(amount, social, prevMonthAfterSocial, emp.dependents || 0);

  const totalDed = social + incomeTax;
  const net = amount - totalDed;

  return {
    amount, health, pension, care, employment,
    social, incomeTax, totalDed, net,
  };
}
