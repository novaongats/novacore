# NOVACore — プロジェクトガイド

## 概要
NOVACoreは有限会社NOVAの事業を一元管理するWebアプリケーション（単一HTML）。
SNSアフィリエイト、SNSコンサル、制作コンテンツ、競艇予想の売上・経費・利益と、全社の給与を管理する。

**あん庵（飲食事業）は別システムに移管済み**（2026-07にAnCoreページを削除）。JinCoreも本ファイルには存在しない。

## 技術構成
- **単一ファイル**: `index.html` に全HTML/CSS/JSが含まれる（約19,600行）
- **デザイン**: NOVA Precision Dark（Sora/Noto Sans JP/JetBrains Mono, #6366f1 primary）
  + **NOVA UI v23**: 親ウィンドウの `NOVA_UI_CSS` を全iframeへ実行時注入する統一デザインレイヤー（上書き型）
- **帳票**: 親ウィンドウの `novaReport.open({title,subtitle,orientation,bodyHtml})` が共通帳票システム。iframeからは `parent.novaReport.open()`。会社情報ヘッダーは `payroll_v2_company_info` から自動取得
- **データ永続化**: localStorage + Firebase Realtime Database（novaSync）
- **iframe構成**: 5つのiframeページ（競艇計算・現金出納帳・売上入力・請求書・給与計算）+ 親ドキュメント直下のページ（ダッシュボード・売上管理・税理士レポート・AI・ユーザー管理ほか）
- **Cloudflare Pages**: `wrangler pages deploy . --project-name=novacore --branch=main` で本番。Functions（functions/）はGmail OAuth+給与明細送信

## ⚠️ 編集時の最重要注意
1. **iframeの中身は `srcdoc` 属性**。属性内では `"`→`&quot;`、`&`→`&amp;` に必ずエスケープ（`<` `>` はそのままでよい）。新規JSでは `&&` を避け `continue`/ネストif で書くと安全
2. **iframeを削除・移動するとき**: iframe同士の「間」に親ドキュメントのページdivが挟まっている。マーカー間一括削除は巻き込み事故のもと（実際にAI/ユーザー管理等4ページを巻き込んだ）。必ず `id="p_*"` の全数を削除前後で照合すること
3. **novaSync (FIREBASE_WINS_KEYS = payroll_v2_*)**:
   - pull前のiframe初期化push（エコー）は自動破棄される（bootSnapshot方式）
   - 空のローカル値が実データを持つリモートを上書きするpushは無条件ブロック（安全弁）
   - **この安全弁を弱める変更は絶対にしない**（給与データ全消失事故が2度発生した）
   - 復旧ツール: `/rescue.html`（同期コードなしでlocalStorage→Firebase書き戻し）
4. **nova_sales の削除は tombstone 方式**（`_deleted: Date.now()`）。物理削除するとFirebaseマージで復活する。書き込みは `salesLoadAllRaw()`、読み取りは `salesLoadAll()`（削除済み除外）

## ページ・ツール一覧
| ページ | ID | 役割 | 主要localStorageキー |
|--------|-----|------|---------------------|
| ダッシュボード | p_dashboard | ホーム・概況 | nova_tasks, nova_events, nova_posts |
| 売上管理 | p_sales | 全社収支ダッシュボード（read-only集約） | `nova_sales` |
| 売上入力 | p_sales_tracker | SNS/コンテンツ/競艇の売上+月次コスト | `nova_st3_daily`, `nova_st3_cats`, `nova_st3_costs` |
| 現金出納帳 | p_expenses | 全社の日常現金支出 | `expense-tracker-data-v2` |
| 競艇計算 | p_profit | 競艇収支計算→売上入力に送信 | `boatrace-revenue-data-v4-html` |
| 給与計算 | p_payroll | 全社給与管理（**本番運用中** v2.7.0） | `payroll_v2_records`, `payroll_v2_employees` ほか payroll_v2_* |
| 請求書 | p_invoices | 請求書・領収書発行 | `invoice_history`, `client_master`, `bank_master` |
| 税理士レポート | p_tax_report | 月次帳票（genTax） | — |
| 領収書仕分け | p_receipt_sort | AI仕分け→出納帳自動登録（実装済み） | `rcpt_*` |
| 給与明細送付先 | p_payslip_master | Gmail一斉送信（Cloudflare Functions経由） | — |

## 売上管理の集約（salesGetMonthData）
nova_sales実レコード + 以下の read-only 仮想マージ（IDでdedup）:
- `nova_st3_daily`（tracker売上、`_deleted`除外）
- `nova_st3_costs` + レベシェア（tracker_cost経費）
- `expense-tracker-data-v2`（cashbook、honbu/cashbookの1レコード）
- **`payroll_v2_records`（人件費、dept:honbu/category:salary/source:payroll）** — 本部にsalary/labor手動経費がある月は二重計上防止で自動停止

## 給与計算 v2.7.0 の状態
- **源泉徴収税額表: 令和8年版**（国税庁公式Excelから自動変換した `R8_MONTHLY_TAX_TABLE` 232行 + 740,000円超の超過規定 `R8_MONTHLY_TAX_OVER_LIMIT`）。賞与も `R8_BONUS_TAX_TABLE`
- **乙欄対応**: 従業員マスタ `taxColumn: 'kou'|'otsu'`
- 社保端数は**切り捨て**（`roundShakai`）— 顧問税理士（中西会計）の実務に一致させている。変更禁止
- 雇用保険 0.55%/0.90%（令和8年度、`EMPLOYMENT_RATE_FY2026`）
- 手動上書きフラグ `incomeTaxOverride`/`healthOverride` は全再計算パスで保持される
- **扶養人数フィールド = 「源泉控除対象の扶養親族等の数」（16歳未満は数えない）**。税理士は鈴木亨・可子・広浜を0人で計算している
- 月次フロー: 給与一覧 →「📋 翌月分を同額でコピー作成」→「🔍 数値検証（診断）」→ 振込

## 部門コード
```javascript
var SALES_DEPTS = [
  {key:'sns', label:'SNS事業'}, {key:'content', label:'制作コンテンツ'},
  {key:'boat', label:'競艇事業'}, {key:'food', label:'飲食事業'}, // foodは旧あん庵送信分の履歴表示用
  {key:'other', label:'その他'}
];
// + {key:'honbu', label:'本部'}（経費・人件費）
```

## 競艇→売上入力の連携
- 送信item名 `競艇A(たつや)`→boat_zero、`競艇B(しょうへい)`→boat_sec
- 同月・同カテゴリは**置換**（再送での二重計上なし）。カテゴリ不在時は自動作成

## 最近の大きな変更履歴（2026-07）
- v22: データ保全修正8件（tombstone化・Firebase巻き戻り・競艇誤振替・CSVカンマ・出納帳ハードコード57件除去・本部送信月選択）
- 給与v2.7.0: 令和8年税額表総入替・乙欄・雇用保険0.55%
- v23: あん庵ページ削除（-7,400行）・人件費の全社損益連携・同期安全弁
- v23.1: NOVA UI v23統一デザインレイヤー + novaReport帳票基盤 + 主要帳票の刷新

## 既知の課題・残作業
- 競艇集計表の印刷CSS（style属性セレクタ依存で壊れやすい）→ novaReportへ移行予定
- 賃金台帳・源泉徴収票の様式強化（源泉徴収票は社内確認用レベル。控除額が令和7年改正未対応）
- 年末調整タブは集計表示のみ（精算機能なし）
- JSON.parse の try-catch 未保護箇所 / alert多用のトースト化 / XSSエスケープ統一
- **Firebase RTDBが無認証開放状態**（最優先セキュリティ課題。Firebase Auth導入はコンソール操作が必要）
- Claude APIキーがlocalStorage平文（Functions経由のプロキシ化を検討）
- パスワードが簡易ハッシュ（simpleHash）

## 開発ルール
- index.htmlを直接編集。変更後は `git commit`。本番反映は wrangler deploy（ユーザーの承認を得ること）
- 大規模な機械編集はNodeスクリプト（マーカー探索は改行コード非依存で書く。ファイルはCRLF混在）
- 検証: `.claude/launch.json` の novacore サーバ（`npx serve -l 8788`）+ ローカルプレビュー。**プレビューでFirebaseに接続されるため、給与系の書き込み挙動に注意**（安全弁があるが油断しない）
- 税額表・料率などの法定数値は**必ず公式ソースから機械変換**し、税理士確定値と照合テストをする（手転記禁止）

## ワークフロー・オーケストレーション

### 1. プランモードの原則適用
- 3ステップ以上の作業や、アーキテクチャ上の決定を伴う重要なタスクでは、必ず「プランモード」に入ること。
- 作業が停滞したり予期せぬ方向へ進んだりした場合は、即座に中断して計画を練り直すこと。無理に進めてはならない。

### 2. サブエージェントの活用戦略
- 調査、探索、並列分析などはサブエージェントに任せ、メインのコンテキストをクリーンに保つこと。
- 1つのサブエージェントにつき1つのタスクを割り当てること。

### 3. 自己改善ループ
- ユーザーから修正指示を受けた後は、そのパターンを `tasks/lessons.md` に記録すること。

### 4. 完了前の検証
- 動作の証明ができるまで、タスクを完了と見なさないこと。テスト・ログ・実画面で正当性を実証すること。

### 5. エレガントさの追求（バランス重視）
- 対処療法ではなく根本原因を直すこと。ただし単純な修正に過剰なエンジニアリングをしないこと。

### 6. 自律的なバグ修正
- バグ報告を受けた際は、自力でログ・エラーを特定し解決すること。

## タスク管理
1. 計画をチェックリスト形式で提示し、承認を得てから実装する。
2. 完了項目は随時チェックし、各ステップでハイレベルな要約を提示する。

## コア原則
- **シンプルさの追求**: あらゆる変更を可能な限りシンプルに保ち、影響範囲を最小化する。
- **妥協の排除**: 根本原因を突き止める。一時しのぎの修正はしない。
- **データ保全最優先**: 給与・売上データを危険に晒す変更は、どんなに小さくても検証環境で実証してから本番に出す。
