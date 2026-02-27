# NOVACore — プロジェクトガイド

## 概要
NOVACoreは有限会社NOVAの全事業を一元管理するWebアプリケーション（単一HTML）。
SNSアフィリエイト、SNSコンサル、制作コンテンツ、競艇予想、飲食事業（あん庵）の売上・経費・利益を管理する。

## 技術構成
- **単一ファイル**: `index.html` に全HTML/CSS/JSが含まれる（約19,900行）
- **デザインシステム**: NOVA Precision Dark（Sora/Noto Sans JP/JetBrains Mono, #6366f1 primary, #0c0c14 sidebar, #f4f6fa main）
- **データ永続化**: localStorage（26キー）+ Firebase Realtime Database（同期）
- **iframe構成**: 14のiframeページ（売上入力, 経費管理, 給与計算, 請求書, 領収書仕分け, あん庵管理 等）
- **iframe通信**: window.postMessage で親子間通信

## ページ・ツール一覧と役割

### データ入力ツール（正のデータを持つ）
| ページ | ID | 役割 | 主要localStorageキー |
|--------|-----|------|---------------------|
| 売上入力 | p_sales_tracker | SNS/コンテンツ/競艇の売上+月次コスト | `nova_st3_daily`, `nova_st3_cats`, `nova_st3_costs` |
| あん庵管理 | p_ancore | 飲食事業の完全収支管理（日報+月報） | `annan_dailyReports`, `annan_monthlyReports` |
| 現金出納帳 | p_expenses | 全社の日常現金支出 | `expense-tracker-data-v2` |
| 競艇計算 | p_profit | 競艇収支計算→売上入力に送信 | `boatrace-revenue-data-v4-html` |
| 給与計算 | p_payroll | 全社給与管理（現在未使用） | `payroll_v2_records` |

### 集約・表示ツール（read-only）
| ページ | ID | 役割 |
|--------|-----|------|
| 売上管理 | p_sales | 全社収支ダッシュボード（売上+経費+利益） |
| 税理士レポート | p_tax_report | 月次帳票 |
| ダッシュボード | p_dashboard | ホーム画面・概況 |

## データスキーマ

### あん庵 日報 (annan_dailyReports)
```javascript
[{
  id, date, weather, sales, lunchSales, dinnerSales,
  cash, card, qr, tableCount, customers, unitPrice,
  employeeCount, partTimeCount, partTimeLaborCost,
  laborCostRate, targetRate, source, temperature
}]
```

### あん庵 月報 (annan_monthlyReports)
```javascript
{
  "2026-02": {
    purchase, utilities, rent, supplies, welfare, legalWelfare,
    advertising, communication, salary, misc, insurance, depreciation,
    outsource, commission, tools, materials, shipping, labor, vehicle
  }
}
```

### 売上管理 (nova_sales)
```javascript
[{
  id, date, dept, type, amount, memo, source, created,
  category // expense時のみ
}]
// type: "revenue"(default) | "expense"
// source: "manual" | "ancore" | "tracker" | "tracker_cost" | "cashbook"
// dept: "sns" | "content" | "boat" | "food" | "other" | "honbu"
```

### 売上入力 (nova_st3_daily / nova_st3_costs)
```javascript
// nova_st3_daily
[{ id, date, catId, amount, note, created }]

// nova_st3_costs
[{ yearMonth, catId, items: [{ type, amount, note }] }]
// type: "outsource" | "tools" | "commission" | "materials" 等

// nova_st3_cats でcatId → dept, name等を参照
```

### 現金出納帳 (expense-tracker-data-v2)
```javascript
{ expenses: [{ id, date, vendor, category, amount, reducedTax, hasInvoice }] }
```

## 本部送信フロー（あん庵→本部）
1. あん庵管理で日報CSV入力 → `annan_dailyReports` に保存
2. 月報で経費入力 → `annan_monthlyReports` に保存
3. 「本部送信」ボタン → `window.parent.postMessage({type:'ancore-honbu-send', ...})`
4. 親ウィンドウが受信 → `nova_sales` に売上(type:revenue) + 経費(type:expense) レコード保存

## 重要な関数

### 売上管理
- `salesGetMonthData(mk)` — 月次データ集約（tracker, ancore, cashbook全統合）
- `salesRender()` — 売上管理ページの描画
- `salesRenderTrend()` — 6ヶ月推移テーブル
- `salesLoadAll()` / `salesSaveAll(arr)` — nova_sales読み書き

### あん庵管理（iframe内）
- `getDailyReports()` — 日報取得
- `getMonthlyReports()` — 月報取得
- `gatherHonbuData(cat, mk)` — 本部送信データ収集
- `honbuSend(cat)` — 本部へ送信
- `refreshDailyList()` — 日報一覧の描画
- `mapAirMateColumns(headers)` — CSV列マッピング

### 共通
- `genTax()` — 税理士レポート生成
- `homeRender()` — ダッシュボード描画
- `novaSync.push(key)` — Firebase同期

## 部門コード
```javascript
var SALES_DEPTS = [
  {key:'sns',     label:'SNS事業'},
  {key:'content', label:'制作コンテンツ'},
  {key:'boat',    label:'競艇事業'},
  {key:'food',    label:'飲食事業'},
  {key:'other',   label:'その他'}
];
var ALL_DEPTS = SALES_DEPTS.concat([{key:'honbu', label:'本部経費'}]);
```

## 勘定科目 (EXPENSE_ACCOUNTS)
`purchase`(仕入), `outsource`(外注費), `commission`(支払手数料), `tools`(ツール費), `materials`(材料費), `utilities`(水道光熱費), `rent`(地代家賃), `supplies`(消耗品費), `welfare`(福利厚生費), `legalWelfare`(法定福利費), `shipping`(荷造運賃), `advertising`(広告宣伝費), `communication`(通信費), `salary`(給料・賞与), `labor`(人件費), `depreciation`(減価償却費), `vehicle`(車両費), `misc`(雑費), `insurance`(保険料)

## 最近の修正履歴
- v21: UI全面リデザイン（Precision Dark）、バグ修正6件、売上管理を全社収支ダッシュボード化
- 修正済みバグ: 本部送信売上¥0、経費が小口現金のみ送信、税理士レポートキー名不一致

## 既知の課題・将来対応
- 給与計算ページは未使用（将来連携予定）
- 領収書仕分け→現金出納帳の自動登録（未実装）
- あん庵月報の勘定科目を飲食業向けサブセットに絞る（未実装）
- 経費二重計上防止の仕組み（未実装）

## 開発ルール
- AnCoreのバージョンは現在 v2.2.0。更新時にインクリメント。
- JinCore（シーシャバー陣用、NOVAとは別事業）は v1.3.0。
- index.htmlを直接編集。変更後は `git commit` で記録。
- CSSはインラインまたは`<style>`タグ内。外部ファイルなし。
