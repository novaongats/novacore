/* ============================================================
   NOVA Core v2 — Payroll / Employee bank accounts + 全銀協 CSV
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useMemo } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection, where } from '../../store.js';
import { formatYen, thisMonth, monthLabel, addMonths, asArray, toCsv, downloadTextFile } from '../../shared.js';

const html = htm.bind(h);

// ---- 全銀フォーマット向け 受取人カナ正規化 ----------------------------------
// 全角カナ→半角カナ（濁点・半濁点は別文字）、ひらがな→カナ、小書き→並字、
// 長音「ー」→「-」、中点→「.」、全角英数→半角、英字は大文字化。
// 全銀で使えない文字はそのまま残す（銀行側で要確認）。

const ZENGIN_MAP = {
  'ア':'ｱ','イ':'ｲ','ウ':'ｳ','エ':'ｴ','オ':'ｵ',
  'カ':'ｶ','キ':'ｷ','ク':'ｸ','ケ':'ｹ','コ':'ｺ',
  'サ':'ｻ','シ':'ｼ','ス':'ｽ','セ':'ｾ','ソ':'ｿ',
  'タ':'ﾀ','チ':'ﾁ','ツ':'ﾂ','テ':'ﾃ','ト':'ﾄ',
  'ナ':'ﾅ','ニ':'ﾆ','ヌ':'ﾇ','ネ':'ﾈ','ノ':'ﾉ',
  'ハ':'ﾊ','ヒ':'ﾋ','フ':'ﾌ','ヘ':'ﾍ','ホ':'ﾎ',
  'マ':'ﾏ','ミ':'ﾐ','ム':'ﾑ','メ':'ﾒ','モ':'ﾓ',
  'ヤ':'ﾔ','ユ':'ﾕ','ヨ':'ﾖ',
  'ラ':'ﾗ','リ':'ﾘ','ル':'ﾙ','レ':'ﾚ','ロ':'ﾛ',
  'ワ':'ﾜ','ヲ':'ｦ','ン':'ﾝ',
  'ガ':'ｶﾞ','ギ':'ｷﾞ','グ':'ｸﾞ','ゲ':'ｹﾞ','ゴ':'ｺﾞ',
  'ザ':'ｻﾞ','ジ':'ｼﾞ','ズ':'ｽﾞ','ゼ':'ｾﾞ','ゾ':'ｿﾞ',
  'ダ':'ﾀﾞ','ヂ':'ﾁﾞ','ヅ':'ﾂﾞ','デ':'ﾃﾞ','ド':'ﾄﾞ',
  'バ':'ﾊﾞ','ビ':'ﾋﾞ','ブ':'ﾌﾞ','ベ':'ﾍﾞ','ボ':'ﾎﾞ',
  'パ':'ﾊﾟ','ピ':'ﾋﾟ','プ':'ﾌﾟ','ペ':'ﾍﾟ','ポ':'ﾎﾟ',
  'ヴ':'ｳﾞ',
  'ヰ':'ｲ','ヱ':'ｴ','ヷ':'ﾜﾞ','ヺ':'ｦﾞ',
  '゙':'ﾞ','゚':'ﾟ',  // 結合濁点 U+3099 → ﾞ / 結合半濁点 U+309A → ﾟ（NFD等で分解された文字列用）
  'ァ':'ｱ','ィ':'ｲ','ゥ':'ｳ','ェ':'ｴ','ォ':'ｵ',
  'ッ':'ﾂ','ャ':'ﾔ','ュ':'ﾕ','ョ':'ﾖ','ヮ':'ﾜ','ヵ':'ｶ','ヶ':'ｹ',
  'ー':'-','－':'-','‐':'-','―':'-','・':'.','。':'.','　':' ',
  '（':'(','）':')','．':'.','／':'/',
};

const HALF_SMALL_KANA = {
  'ｧ':'ｱ','ｨ':'ｲ','ｩ':'ｳ','ｪ':'ｴ','ｫ':'ｵ','ｬ':'ﾔ','ｭ':'ﾕ','ｮ':'ﾖ','ｯ':'ﾂ',
};

export function zenginKana(input) {
  let s = String(input || '');
  // ひらがな → カタカナ
  s = s.replace(/[ぁ-ゖ]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));
  // 全角英数 → 半角
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  // 半角カナの小書き（既に半角入力されたもの）→ 並字
  s = s.replace(/[ｧｨｩｪｫｬｭｮｯ]/g, ch => HALF_SMALL_KANA[ch]);
  // 全角カナ・記号 → 半角（マップ）
  s = s.split('').map(ch => ZENGIN_MAP[ch] ?? ch).join('');
  return s.toUpperCase().trim();
}

// ---- 全銀協 総合振込/給与振込フォーマット（固定長120バイト） -------------------
// 出典（v1 index.html B-8 から移植）: 全国銀行協会「給与振込フォーマット」
// ファイル構造: ヘッダー(120) + データレコード(120) × N + トレーラー(120) + エンド(120)
// 文字コード: Shift_JIS / 改行 CR+LF。
// 使用可能文字は半角カナ・半角英数記号のみ（すべて SJIS 1バイト文字）のため、
// zenginKana で正規化 → 許容外の文字を除去 → ASCII/半角カナを手組みで SJIS
// バイト列（0x20-0x7E / 0xA1-0xDF）に変換する。外部ライブラリ不使用。

// 全銀フォーマットの自社（委託者）情報は payrollBankAccounts の特別docに保存
export const ZENGIN_COMPANY_DOC_ID = '_zengin_company';

const ZENGIN_ALLOWED = /^[\x20-\x7E｡-ﾟ]$/;

/** zenginKana 変換後、全銀で使用できない文字（全角等）を除去する */
export function zenginField(s) {
  return zenginKana(s).split('').filter(ch => ZENGIN_ALLOWED.test(ch)).join('').trim();
}

/** カナ・英数フィールド: 指定バイト数（=文字数、全て1バイト）で右スペース埋め */
function padKanaField(s, len) {
  const t = zenginField(s).slice(0, len);
  return t + ' '.repeat(len - t.length);
}

/** 数値フィールド: 数字以外を除去して左ゼロ埋め（超過は下位桁を残す） */
function padNumField(v, len) {
  const digits = String(v ?? '').replace(/\D/g, '');
  return (digits === '' ? '0' : digits).padStart(len, '0').slice(-len);
}

/** 金額・件数フィールド: 数値を左ゼロ埋め */
function padAmountField(n, len) {
  return String(Math.max(0, Math.floor(Number(n) || 0))).padStart(len, '0').slice(-len);
}

/**
 * 全銀協フォーマットの全レコード（120桁固定長の文字列配列）を組み立てる。
 * @param company 自社（委託者）情報 { consignorCode, consignorName, bankCode,
 *                bankName, branchCode, branchName, accountType, accountNumber }
 * @param rows    [{ emp, acct, rec }]（rec.net を振込金額とする）
 * @param mmdd    取組日 'MMDD'
 * @param payKind 'monthly' | 'bonus'（振込指定区分 7=給与 / 8=賞与）
 */
export function buildZenginLines({ company, rows, mmdd, payKind }) {
  const c = company || {};
  // ヘッダー: 区分1 + 種別21(給与振込) + コード区分0(JIS) + 委託者コード10
  //   + 委託者名40 + 取組日4 + 仕向銀行番号4 + 仕向銀行名15 + 仕向支店番号3
  //   + 仕向支店名15 + 預金種目1 + 口座番号7 + ダミー17 = 120
  const header = '1' + '21' + '0'
    + padNumField(c.consignorCode, 10)
    + padKanaField(c.consignorName, 40)
    + mmdd
    + padNumField(c.bankCode, 4)
    + padKanaField(c.bankName, 15)
    + padNumField(c.branchCode, 3)
    + padKanaField(c.branchName, 15)
    + (c.accountType === '当座' ? '2' : '1')
    + padNumField(c.accountNumber, 7)
    + ' '.repeat(17);

  // データ: 区分2 + 銀行番号4 + 銀行名15 + 支店番号3 + 支店名15 + 手形交換所4
  //   + 預金種目1 + 口座番号7 + 受取人名30 + 金額10 + 新規コード1
  //   + 顧客コード1(10) + 顧客コード2(10) + 振込指定区分1 + 識別表示1 + ダミー7 = 120
  const data = rows.map(({ emp, acct, rec }) =>
    '2'
    + padNumField(acct.bankCode, 4)
    + padKanaField(acct.bankName, 15)
    + padNumField(acct.branchCode, 3)
    + padKanaField(acct.branchName, 15)
    + '0000'
    + (acct.accountType === '当座' ? '2' : '1')
    + padNumField(acct.accountNumber, 7)
    + padKanaField(acct.accountHolderKana || acct.accountHolder || '', 30)
    + padAmountField(rec.net || 0, 10)
    + '0'
    + padKanaField(emp.id, 10)
    + ' '.repeat(10)
    + (payKind === 'bonus' ? '8' : '7')
    + ' '
    + ' '.repeat(7));

  // トレーラー: 区分8 + 合計件数6 + 合計金額12 + ダミー101 = 120
  const totalAmount = rows.reduce((s, r) => s + (r.rec.net || 0), 0);
  const trailer = '8'
    + padAmountField(rows.length, 6)
    + padAmountField(totalAmount, 12)
    + ' '.repeat(101);

  // エンド: 区分9 + ダミー119 = 120
  const end = '9' + ' '.repeat(119);

  return [header, ...data, trailer, end];
}

/**
 * 全銀の使用可能文字（ASCII 0x20-0x7E / 半角カナ U+FF61-FF9F）と CR/LF のみから
 * なる文字列を Shift_JIS バイト列に変換する。
 * ASCII → 同値バイト、半角カナ → 0xA1-0xDF（SJIS 1バイトカナ）。
 */
export function encodeSjisKana(text) {
  const out = new Uint8Array(text.length);
  let i = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === 0x0D || cp === 0x0A) out[i++] = cp;
    else if (cp >= 0x20 && cp <= 0x7E) out[i++] = cp;
    else if (cp >= 0xFF61 && cp <= 0xFF9F) out[i++] = 0xA1 + (cp - 0xFF61);
    else out[i++] = 0x20;  // 想定外の文字は事前に除去済みだが安全側でスペース
  }
  return out.subarray(0, i);
}

/** SJIS バイト列をファイルとしてダウンロード */
function downloadSjisFile(text, filename) {
  const blob = new Blob([encodeSjisKana(text)], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function BanksTab() {
  const employees = useCollection(repos.payrollEmployees);
  const accounts  = useCollection(repos.payrollBankAccounts);

  const [editing, setEditing] = useState(null);
  const [exportMonth, setExportMonth] = useState(thisMonth());

  const empList = asArray(employees.data);
  // 自社（委託者）情報の特別docは従業員口座マップから除外する
  const acctDocs = asArray(accounts.data);
  const acctMap = new Map(acctDocs
    .filter(a => a.empId && a.empId !== ZENGIN_COMPANY_DOC_ID)
    .map(a => [a.empId, a]));
  const company = acctDocs.find(a => a.empId === ZENGIN_COMPANY_DOC_ID) || null;

  return html`
    <div>
      <${ExportSection} key=${exportMonth} month=${exportMonth} onChangeMonth=${setExportMonth}
                      employees=${empList} acctMap=${acctMap} company=${company} />

      <div class="card" style=${{ padding: 20 }}>
        <div style=${{ display: 'flex', justifyContent: 'space-between',
                       alignItems: 'center', marginBottom: 14 }}>
          <div style=${{ fontSize: 14, fontWeight: 700 }}>🏦 従業員別 振込口座</div>
          <div style=${{ fontSize: 11, color: 'var(--text-3)' }}>
            ${acctMap.size} / ${empList.length} 名登録済
          </div>
        </div>

        ${empList.length === 0 ? html`
          <div style=${{ color: 'var(--text-3)', fontSize: 13, padding: 16 }}>
            先に「従業員マスタ」から従業員を登録してください。
          </div>
        ` : html`
          <div style=${{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            ${empList.map(emp => {
              const acct = acctMap.get(emp.id);
              return html`
                <div key=${emp.id} style=${row}>
                  <div style=${{ flex: 1 }}>
                    <div style=${{ fontSize: 13, fontWeight: 600 }}>${emp.name}</div>
                    ${acct ? html`
                      <div style=${{ fontSize: 11, color: 'var(--text-3)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                        ${acct.bankName} (${acct.bankCode || '----'})
                        ${acct.branchName} (${acct.branchCode || '---'})
                        / ${acct.accountType} ${acct.accountNumber}
                      </div>
                      <div style=${{ fontSize: 11, color: 'var(--text-3)' }}>
                        ${acct.accountHolder}
                        ${acct.accountHolderKana && html`<span style=${{ marginLeft: 6, color: 'var(--text-4)' }}>(${acct.accountHolderKana})</span>`}
                      </div>
                    ` : html`
                      <div style=${{ fontSize: 11, color: 'var(--danger)', marginTop: 2 }}>
                        ⚠ 口座未登録
                      </div>
                    `}
                  </div>
                  <button class="btn btn-ghost" onClick=${() => setEditing({ emp, acct })}>
                    ${acct ? '編集' : '＋ 登録'}
                  </button>
                </div>
              `;
            })}
          </div>
        `}
      </div>

      ${editing && html`
        <${AccountModal} emp=${editing.emp} existing=${editing.acct}
                        onClose=${() => setEditing(null)} />
      `}
    </div>
  `;
}

// ---- Export section --------------------------------------------------------

function ExportSection({ month, onChangeMonth, employees, acctMap, company }) {
  // 対象種別: 月次給与 or 賞与（親から key=month が付くため月切替でリセットされる）
  const [payKind, setPayKind] = useState('monthly');
  const [transferDate, setTransferDate] = useState(month + '-25');  // 既定は25日
  const [showCompany, setShowCompany] = useState(false);

  const records = useCollection(
    repos.payrollRecords,
    () => [where('month', '==', month)],
    [month],
  );
  const bonuses = useCollection(
    repos.payrollBonus,
    () => [where('month', '==', month)],
    [month],
  );
  const source = payKind === 'bonus' ? bonuses : records;
  const recMap = new Map(asArray(source.data).map(r => [r.empId, r]));

  const pairs = employees
    .map(emp => ({
      emp,
      acct: acctMap.get(emp.id),
      rec:  recMap.get(emp.id),
    }))
    .filter(p => p.rec);

  const totalAmount = pairs.reduce((s, p) => s + (p.rec?.net || 0), 0);
  const missingAcct = pairs.filter(p => !p.acct);
  // 名義カナ未登録で漢字等のままフォールバック出力になる従業員
  // （zenginKana 変換後も半角カナ・半角英数記号以外が残る場合のみ警告）
  const kanaMissing = pairs.filter(p =>
    p.acct && !(p.acct.accountHolderKana || '').trim()
    && /[^\x20-\x7E｡-ﾟ]/.test(zenginKana(p.acct.accountHolder || '')));
  // 全銀フォーマットに必須の銀行コード・支店コードが未登録の従業員
  const codeMissing = pairs.filter(p =>
    p.acct && (!(p.acct.bankCode || '').trim() || !(p.acct.branchCode || '').trim()));

  function eligiblePairsOrNull() {
    if (missingAcct.length > 0) {
      if (!confirm(`${missingAcct.length}名の口座情報が未登録です。該当者を除外して出力しますか？`)) return null;
    }
    const eligible = pairs.filter(p => p.acct);
    if (eligible.length === 0) {
      alert('振込対象がありません');
      return null;
    }
    return eligible;
  }

  function exportZengin() {
    if (!company || !(company.bankName || '').trim()) {
      alert('全銀フォーマットの出力には自社（委託者）の情報が必要です。\n「⚙ 振込元（委託者）情報」から登録してください。');
      setShowCompany(true);
      return;
    }
    if (codeMissing.length > 0) {
      if (!confirm(`以下の従業員の銀行コード（4桁）または支店コード（3桁）が未登録です:\n\n`
        + codeMissing.map(p => `・${p.emp.name}`).join('\n')
        + `\n\n未登録分は 0000 で出力されます（銀行で受け付けられません）。このまま出力しますか？`)) return;
    }
    const eligible = eligiblePairsOrNull();
    if (!eligible) return;

    const dm = /^\d{4}-(\d{2})-(\d{2})$/.exec(transferDate || '');
    if (!dm) { alert('振込日を入力してください（取組日として使用します）'); return; }
    const mmdd = dm[1] + dm[2];

    const lines = buildZenginLines({ company, rows: eligible, mmdd, payKind });
    const bad = lines.filter(l => l.length !== 120);
    if (bad.length > 0) {  // 保険: 各レコードは必ず120バイト固定
      alert('内部エラー: レコード長が120バイトになりませんでした。出力を中止します。');
      console.error('[payroll/banks] zengin record length mismatch', bad);
      return;
    }
    const prefix = payKind === 'bonus' ? 'zengin_bonus' : 'zengin_salary';
    downloadSjisFile(lines.join('\r\n') + '\r\n', `${prefix}_${month}.txt`);

    const totalCount = eligible.length;
    const total = eligible.reduce((s, p) => s + (p.rec?.net || 0), 0);
    alert(`全銀協形式（Shift_JIS・固定長120バイト）の振込データを出力しました\n\n`
      + `対象月: ${month} / 取組日: ${transferDate}\n対象: ${totalCount}名 / 合計: ${formatYen(total)}\n\n`
      + `⚠ 委託者コードは銀行から指定された10桁を「振込元（委託者）情報」に登録してください。\n`
      + `⚠ 初回は銀行側で正しく取り込めるか担当者に確認してください。`);
  }

  function exportCsv() {
    const eligible = eligiblePairsOrNull();
    if (!eligible) return;

    // 簡易 CSV フォーマット (全銀協フォーマットは固定長テキストだが、実用的なCSV出力として)
    // 参考: 日付 / 銀行名 / 支店名 / 支店コード / 口座種別(1:普通 2:当座) / 口座番号 / 名義カナ / 金額
    const rows = [['振込日', '銀行名', '支店名', '支店コード', '種別', '口座番号', '名義（カナ）', '金額']];
    for (const { acct, rec } of eligible) {
      rows.push([
        transferDate || (month + '-25'),
        acct.bankName || '',
        acct.branchName || '',
        acct.branchCode || '',
        acct.accountType === '当座' ? '2' : '1',
        (acct.accountNumber || '').padStart(7, '0'),
        zenginKana(acct.accountHolderKana || acct.accountHolder || ''),
        rec.net || 0,
      ]);
    }
    const prefix = payKind === 'bonus' ? 'bonus_transfer' : 'salary_transfer';
    downloadTextFile(toCsv(rows), `${prefix}_${month}.csv`);
  }

  return html`
    <div class="card" style=${{ padding: 20, marginBottom: 18 }}>
      <div style=${{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>📥 振込データ出力</div>

      <div style=${{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <button class="btn btn-ghost" onClick=${() => onChangeMonth(addMonths(month, -1))}>◀</button>
        <div style=${{ fontSize: 15, fontWeight: 700, minWidth: 100, textAlign: 'center' }}>
          ${monthLabel(month)}
        </div>
        <button class="btn btn-ghost" onClick=${() => onChangeMonth(addMonths(month, 1))}>▶</button>

        <select value=${payKind} onChange=${e => setPayKind(e.target.value)} style=${selectCompact}>
          <option value="monthly">月次給与</option>
          <option value="bonus">賞与</option>
        </select>

        <label style=${{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
                         color: 'var(--text-3)', fontWeight: 600 }}>
          振込日
          <input type="date" value=${transferDate}
                 onInput=${e => setTransferDate(e.target.value)} style=${selectCompact} />
        </label>
      </div>

      <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
        <div style=${stat}>
          <div style=${statLabel}>対象人数</div>
          <div style=${statValue}>${pairs.length} 名</div>
        </div>
        <div style=${stat}>
          <div style=${statLabel}>振込額合計</div>
          <div style=${{ ...statValue, color: 'var(--primary)' }}>${formatYen(totalAmount)}</div>
        </div>
        <div style=${stat}>
          <div style=${statLabel}>口座未登録</div>
          <div style=${{
            ...statValue,
            color: missingAcct.length > 0 ? 'var(--danger)' : 'var(--text-3)',
          }}>${missingAcct.length} 名</div>
        </div>
      </div>

      ${missingAcct.length > 0 && html`
        <div class="note note-warn">
          以下の従業員の口座情報が未登録です:
          <strong>${missingAcct.map(p => p.emp.name).join('、')}</strong>
        </div>
      `}

      ${kanaMissing.length > 0 && html`
        <div class="note note-warn">
          カナ未登録: <strong>${kanaMissing.map(p => p.emp.name).join('、')}</strong><br/>
          口座名義（カナ）が未登録のため、名義が漢字のままCSVに出力されます
          （全銀フォーマットでは漢字は出力されず名義が空になります）。
          振込データとして使用する前に、口座編集から「口座名義（カナ）」を登録してください。
        </div>
      `}

      ${codeMissing.length > 0 && html`
        <div class="note note-warn">
          銀行コード/支店コード未登録:
          <strong>${codeMissing.map(p => p.emp.name).join('、')}</strong><br/>
          全銀フォーマットの出力に必要です（銀行4桁・支店3桁）。口座編集から登録してください。
        </div>
      `}

      <div style=${{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button class="btn" onClick=${exportCsv} disabled=${pairs.length === 0}>
          📥 振込CSV を出力
        </button>
        <button class="btn" onClick=${exportZengin} disabled=${pairs.length === 0}>
          📥 全銀フォーマット（.txt）
        </button>
        <button class="btn btn-ghost" onClick=${() => setShowCompany(true)}>
          ⚙ 振込元（委託者）情報
        </button>
        <span style=${{ fontSize: 11, color: company ? 'var(--text-3)' : 'var(--danger)' }}>
          ${company
            ? `委託者: ${company.consignorName || '(名称未設定)'} / ${company.bankName || ''} ${company.branchName || ''}`
            : '⚠ 全銀フォーマットには委託者情報の登録が必要です'}
        </span>
      </div>
      <div style=${{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
        ※ 全銀フォーマットは全銀協「給与振込」固定長120バイト（Shift_JIS・CR+LF）。
        銀行のネットバンキング（総合振込/給与振込）にそのままアップロードできます。
        初回は取り込み可否を銀行の担当者に確認してください。
      </div>

      ${showCompany && html`
        <${CompanyModal} existing=${company} onClose=${() => setShowCompany(false)} />
      `}
    </div>
  `;
}

// ---- 振込元（委託者）情報モーダル -------------------------------------------

const COMPANY_EMPTY = {
  consignorCode: '',     // 委託者コード（銀行から指定される10桁）
  consignorName: '',     // 委託者名（半角カナ・40桁）
  bankCode: '',          // 仕向銀行コード（4桁）
  bankName: '',          // 仕向銀行名（カナ）
  branchCode: '',        // 仕向支店コード（3桁）
  branchName: '',        // 仕向支店名（カナ）
  accountType: '普通',
  accountNumber: '',     // 7桁
};

function CompanyModal({ existing, onClose }) {
  const [form, setForm] = useState({ ...COMPANY_EMPTY, ...existing });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function save() {
    setErr(null);
    if (!form.bankName.trim()) {
      setErr('仕向銀行名（自社口座の銀行名）は必須です');
      return;
    }
    if (form.consignorCode.trim() && !/^\d{1,10}$/.test(form.consignorCode.trim())) {
      setErr('委託者コードは数字10桁以内で入力してください（銀行から指定された値）');
      return;
    }
    setBusy(true);
    try {
      await repos.payrollBankAccounts.setId(ZENGIN_COMPANY_DOC_ID, {
        empId: ZENGIN_COMPANY_DOC_ID,
        consignorCode: form.consignorCode.trim(),
        consignorName: form.consignorName.trim(),
        bankCode: form.bankCode.trim(),
        bankName: form.bankName.trim(),
        branchCode: form.branchCode.trim(),
        branchName: form.branchName.trim(),
        accountType: form.accountType,
        accountNumber: form.accountNumber.trim(),
      }, { merge: true });
      onClose();
    } catch (e) {
      console.error('[payroll/banks] company save failed', e);
      setErr('保存に失敗: ' + (e.message || e));
      setBusy(false);
    }
  }

  return html`
    <div style=${modalBackdrop} onClick=${e => e.target === e.currentTarget && onClose()}>
      <div style=${modalCard}>
        <div style=${modalHeader}>
          <div style=${{ fontWeight: 700, fontSize: 16 }}>⚙ 振込元（委託者）情報</div>
          <button class="btn btn-ghost" onClick=${onClose} disabled=${busy}>✕</button>
        </div>
        <div style=${{ padding: 20, display: 'grid', gap: 12 }}>
          ${err && html`<div class="note note-err">${err}</div>`}
          <div class="note note-info" style=${{ fontSize: 12 }}>
            全銀フォーマットのヘッダーに出力される自社情報です。<br/>
            <strong>委託者コード</strong>は給与振込の契約時に銀行から指定される10桁の番号です。
            名称・銀行名・支店名は<strong>半角カナ</strong>推奨（全角でも自動変換されます）。
          </div>
          <div style=${{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 10 }}>
            <div class="field">
              <label>委託者コード（10桁）</label>
              <input type="text" value=${form.consignorCode}
                     onInput=${e => set('consignorCode', e.target.value)} disabled=${busy}
                     style=${{ fontFamily: 'var(--font-mono)' }} placeholder="0123456789" />
            </div>
            <div class="field">
              <label>委託者名（カナ・40桁以内）</label>
              <input type="text" value=${form.consignorName}
                     onInput=${e => set('consignorName', e.target.value)} disabled=${busy}
                     placeholder="例: ﾕ)ﾉｳﾞｧ" />
            </div>
          </div>
          <div style=${{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10 }}>
            <div class="field">
              <label>銀行コード（4桁）</label>
              <input type="text" value=${form.bankCode}
                     onInput=${e => set('bankCode', e.target.value)} disabled=${busy}
                     style=${{ fontFamily: 'var(--font-mono)' }} placeholder="0001" />
            </div>
            <div class="field">
              <label>仕向銀行名（自社口座の銀行）*</label>
              <input type="text" value=${form.bankName}
                     onInput=${e => set('bankName', e.target.value)} disabled=${busy} />
            </div>
          </div>
          <div style=${{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10 }}>
            <div class="field">
              <label>支店コード（3桁）</label>
              <input type="text" value=${form.branchCode}
                     onInput=${e => set('branchCode', e.target.value)} disabled=${busy}
                     style=${{ fontFamily: 'var(--font-mono)' }} placeholder="001" />
            </div>
            <div class="field">
              <label>仕向支店名</label>
              <input type="text" value=${form.branchName}
                     onInput=${e => set('branchName', e.target.value)} disabled=${busy} />
            </div>
          </div>
          <div style=${{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10 }}>
            <div class="field">
              <label>預金種目</label>
              <select value=${form.accountType} onChange=${e => set('accountType', e.target.value)}
                      disabled=${busy} style=${selectStyle}>
                <option value="普通">普通</option>
                <option value="当座">当座</option>
              </select>
            </div>
            <div class="field">
              <label>口座番号（7桁）</label>
              <input type="text" value=${form.accountNumber}
                     onInput=${e => set('accountNumber', e.target.value)} disabled=${busy}
                     style=${{ fontFamily: 'var(--font-mono)' }} placeholder="1234567" />
            </div>
          </div>
        </div>
        <div style=${modalFooter}>
          <div></div>
          <div style=${{ display: 'flex', gap: 8 }}>
            <button class="btn btn-ghost" onClick=${onClose} disabled=${busy}>キャンセル</button>
            <button class="btn" onClick=${save} disabled=${busy}>${busy ? '保存中...' : '保存'}</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ---- Account modal ---------------------------------------------------------

const EMPTY = {
  bankName: '',
  bankCode: '',      // 銀行コード4桁（全銀フォーマットに必須）
  branchName: '',
  branchCode: '',
  accountType: '普通',
  accountNumber: '',
  accountHolder: '',
  accountHolderKana: '',
};

function AccountModal({ emp, existing, onClose }) {
  const [form, setForm] = useState({ ...EMPTY, ...existing, accountHolder: existing?.accountHolder || emp.name });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function save() {
    setErr(null);
    if (!form.bankName.trim() || !form.accountNumber.trim()) {
      setErr('銀行名と口座番号は必須です');
      return;
    }
    setBusy(true);
    try {
      await repos.payrollBankAccounts.setId(emp.id, {
        empId: emp.id,
        bankName: form.bankName.trim(),
        bankCode: form.bankCode.trim(),
        branchName: form.branchName.trim(),
        branchCode: form.branchCode.trim(),
        accountType: form.accountType,
        accountNumber: form.accountNumber.trim(),
        accountHolder: form.accountHolder.trim(),
        accountHolderKana: form.accountHolderKana.trim(),
      }, { merge: true });
      onClose();
    } catch (e) {
      console.error('[payroll/banks] save failed', e);
      setErr('保存に失敗: ' + (e.message || e));
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    if (!confirm('この口座情報を削除しますか？')) return;
    setBusy(true);
    try {
      await repos.payrollBankAccounts.remove(emp.id);
      onClose();
    } catch (e) {
      setErr('削除に失敗: ' + (e.message || e));
      setBusy(false);
    }
  }

  return html`
    <div style=${modalBackdrop} onClick=${e => e.target === e.currentTarget && onClose()}>
      <div style=${modalCard}>
        <div style=${modalHeader}>
          <div style=${{ fontWeight: 700, fontSize: 16 }}>
            🏦 ${emp.name} の振込口座
          </div>
          <button class="btn btn-ghost" onClick=${onClose} disabled=${busy}>✕</button>
        </div>
        <div style=${{ padding: 20, display: 'grid', gap: 12 }}>
          ${err && html`<div class="note note-err">${err}</div>`}
          <div style=${{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <div class="field">
              <label>銀行名 *</label>
              <input type="text" value=${form.bankName}
                     onInput=${e => set('bankName', e.target.value)} disabled=${busy} />
            </div>
            <div class="field">
              <label>銀行コード（4桁）</label>
              <input type="text" value=${form.bankCode}
                     onInput=${e => set('bankCode', e.target.value)} disabled=${busy}
                     style=${{ fontFamily: 'var(--font-mono)' }} placeholder="0001" />
            </div>
          </div>
          <div style=${{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <div class="field">
              <label>支店名</label>
              <input type="text" value=${form.branchName}
                     onInput=${e => set('branchName', e.target.value)} disabled=${busy} />
            </div>
            <div class="field">
              <label>支店コード（3桁）</label>
              <input type="text" value=${form.branchCode}
                     onInput=${e => set('branchCode', e.target.value)} disabled=${busy}
                     style=${{ fontFamily: 'var(--font-mono)' }} placeholder="001" />
            </div>
          </div>
          <div style=${{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10 }}>
            <div class="field">
              <label>口座種別</label>
              <select value=${form.accountType} onChange=${e => set('accountType', e.target.value)}
                      disabled=${busy} style=${selectStyle}>
                <option value="普通">普通</option>
                <option value="当座">当座</option>
              </select>
            </div>
            <div class="field">
              <label>口座番号 *</label>
              <input type="text" value=${form.accountNumber}
                     onInput=${e => set('accountNumber', e.target.value)} disabled=${busy}
                     style=${{ fontFamily: 'var(--font-mono)' }} placeholder="1234567" />
            </div>
          </div>
          <div class="field">
            <label>口座名義</label>
            <input type="text" value=${form.accountHolder}
                   onInput=${e => set('accountHolder', e.target.value)} disabled=${busy} />
          </div>
          <div class="field">
            <label>口座名義（カナ）</label>
            <input type="text" value=${form.accountHolderKana}
                   onInput=${e => set('accountHolderKana', e.target.value)} disabled=${busy}
                   placeholder="例: ﾔﾏﾀﾞ ﾀﾛｳ" />
          </div>
        </div>
        <div style=${modalFooter}>
          <div>
            ${existing && html`
              <button class="btn btn-danger" onClick=${remove} disabled=${busy}>削除</button>
            `}
          </div>
          <div style=${{ display: 'flex', gap: 8 }}>
            <button class="btn btn-ghost" onClick=${onClose} disabled=${busy}>キャンセル</button>
            <button class="btn" onClick=${save} disabled=${busy}>${busy ? '保存中...' : '保存'}</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ---- Styles ---------------------------------------------------------------

const row = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '11px 14px', borderRadius: 10,
  background: 'var(--bg-alt)',
};
const stat = {
  padding: 12, borderRadius: 10, background: 'var(--bg-alt)',
};
const statLabel = {
  fontSize: 10, color: 'var(--text-3)', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4,
};
const statValue = { fontSize: 16, fontWeight: 700 };
const selectCompact = {
  padding: '8px 10px', border: '1px solid var(--border)',
  borderRadius: 8, background: 'var(--surface)', fontSize: 12,
};
const selectStyle = {
  width: '100%', padding: '10px 12px',
  border: '1px solid var(--border)', borderRadius: 8,
  background: '#f8f9fc', fontFamily: 'inherit', fontSize: 14,
};
const modalBackdrop = {
  position: 'fixed', inset: 0, background: 'rgba(12,12,20,0.5)',
  backdropFilter: 'blur(6px)', zIndex: 9999,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const modalCard = {
  background: 'var(--surface)', borderRadius: 18,
  maxWidth: 560, width: '100%', maxHeight: '90vh', overflow: 'auto',
  boxShadow: 'var(--shadow-lg)',
};
const modalHeader = {
  padding: 20, borderBottom: '1px solid var(--border)',
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
};
const modalFooter = {
  padding: 16, borderTop: '1px solid var(--border)',
  display: 'flex', justifyContent: 'space-between',
};
