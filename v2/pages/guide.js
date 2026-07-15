/* ============================================================
   NOVA Core v2 — 使い方ガイド（かんたん説明書）

   高齢・非エンジニアの給与担当者向けの「小学生でもわかる説明書」ページ。
   大きな文字・ステップ形式で、どのボタンを押すかを具体的に書く。
   親（app.js）が PAGES に GuidePage を配線して使う。
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import htm from 'https://esm.sh/htm@3.1.1';

const html = htm.bind(h);

// ---- 小さな部品 -------------------------------------------------------------

function Section({ icon, title, children }) {
  return html`
    <div class="card" style=${{ padding: 24, marginBottom: 20 }}>
      <div style=${{
        fontSize: 22, fontWeight: 800, marginBottom: 16,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style=${{ fontSize: 26 }}>${icon}</span>${title}
      </div>
      ${children}
    </div>
  `;
}

function Step({ n, children }) {
  return html`
    <div style=${{
      display: 'flex', gap: 14, alignItems: 'flex-start',
      padding: '12px 0', borderBottom: '1px dashed var(--border-2)',
    }}>
      <div style=${{
        minWidth: 34, height: 34, borderRadius: '50%',
        background: 'var(--primary)', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 17, fontWeight: 800, flexShrink: 0,
      }}>${n}</div>
      <div style=${{ fontSize: 16, lineHeight: 1.9, paddingTop: 4 }}>${children}</div>
    </div>
  `;
}

/** 画面上のボタンやメニューの名前を目立たせる */
function Btn({ children }) {
  return html`
    <span style=${{
      display: 'inline-block', padding: '2px 10px', margin: '0 2px',
      borderRadius: 8, background: 'var(--primary-soft)', color: 'var(--primary)',
      fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap',
    }}>${children}</span>
  `;
}

function Faq({ q, children }) {
  return html`
    <div style=${{ padding: '10px 0', borderBottom: '1px dashed var(--border-2)' }}>
      <div style=${{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Q. ${q}</div>
      <div style=${{ fontSize: 15, lineHeight: 1.9, color: 'var(--text-2)' }}>A. ${children}</div>
    </div>
  `;
}

// ---- ページ本体 ---------------------------------------------------------------

export function GuidePage() {
  return html`
    <div style=${{ maxWidth: 860 }}>
      <div style=${{ fontSize: 26, fontWeight: 800, marginBottom: 8 }}>
        📖 使い方ガイド（かんたん説明書）
      </div>
      <div class="note note-info" style=${{ fontSize: 15, lineHeight: 1.9, marginBottom: 20 }}>
        このページは、毎月の作業を<strong>順番どおりに押していけばできる</strong>ように書いた説明書です。<br/>
        わからなくなったら、いつでもこのページ（左のメニューの一番下あたり）に戻ってきてください。<br/>
        <strong>間違えて押しても、保存する前ならデータは変わりません。</strong>あわてなくて大丈夫です。
      </div>

      <${Section} icon="💰" title="① 今月の給与計算のやり方">
        <${Step} n="1">
          画面の左にあるメニューから <${Btn}>給与計算<//> を押します。
        <//>
        <${Step} n="2">
          上に並んでいるタブ（切り替えボタン）から <${Btn}>💰 月次給与<//> を押します。
        <//>
        <${Step} n="3">
          画面の上のほうにある「◀」「▶」で<strong>計算したい月</strong>に合わせます。
          「今月」と書かれたボタンを押すと今の月に戻ります。
        <//>
        <${Step} n="4">
          左側の名前の一覧から、<strong>計算したい人の名前</strong>を押します。
        <//>
        <${Step} n="5">
          基本給（きほんきゅう）などの金額が自動で入ります。
          歩合給（ぶあいきゅう）や手当（てあて）があれば、その欄に数字を入れます。<br/>
          下の「差引支給額（さしひきしきゅうがく）＝実際に振り込む金額」が正しいか確かめます。
        <//>
        <${Step} n="6">
          右下の <${Btn}>保存<//> を押します。名前の横に「✓ 済」と付けば完了です。
        <//>
        <${Step} n="7">
          全員分を繰り返します。<strong>毎月同じ金額の人ばかりなら</strong>、
          上の <${Btn}>📊 一括計算<//> を押して「◯名を計算」を押すと、全員まとめて計算できます。
          （すでに計算した人は自動でとばされるので安心です）
        <//>
      <//>

      <${Section} icon="🖨" title="② 給与明細（めいさい）を出す・印刷する">
        <${Step} n="1">
          <${Btn}>給与計算<//> → <${Btn}>💰 月次給与<//> で、明細を見たい人の名前を押します。
        <//>
        <${Step} n="2">
          <${Btn}>👁 明細プレビュー<//> を押すと、その人の給与明細が画面に出ます。
        <//>
        <${Step} n="3">
          全員分をまとめて印刷したいときは、上の <${Btn}>🖨 全員の明細を印刷<//> を押します。
          印刷の画面が出たら「印刷」を押してください。
        <//>
      <//>

      <${Section} icon="📧" title="③ 明細をメールで送る">
        <${Step} n="1">
          <${Btn}>給与計算<//> の上のタブから <${Btn}>📧 明細送付<//> を押します。
        <//>
        <${Step} n="2">
          送りたい月になっているか確かめてから、送る相手を選びます。
        <//>
        <${Step} n="3">
          <div style=${{ color: '#dc2626', fontWeight: 800 }}>
            送信ボタンを押す前に、必ず「名前」と「メールアドレス」の組み合わせが
            正しいか、一人ずつ確認してください。
          </div>
          給与の情報はとても大事な個人情報です。別の人に送ってしまうと取り消せません。
        <//>
        <${Step} n="4">
          メールアドレスは <${Btn}>👥 従業員マスタ<//>（給与計算の中のタブ）で
          その人を押すと登録・変更できます。
        <//>
      <//>

      <${Section} icon="▲" title="④ 売上の入力のしかた">
        <${Step} n="1">
          左のメニューから <${Btn}>売上管理<//> を押します。
        <//>
        <${Step} n="2">
          上のタブから <${Btn}>日次売上<//> を押します。
        <//>
        <${Step} n="3">
          追加のボタンを押して、日付・種類（どの事業か）・金額を入れて保存します。
        <//>
        <${Step} n="4">
          全体の様子を見たいときは <${Btn}>ダッシュボード<//> タブを押すと、
          月ごとの売上や利益がグラフで見られます。
        <//>
      <//>

      <${Section} icon="📒" title="⑤ 現金出納帳（げんきんすいとうちょう）のつけかた">
        <${Step} n="1">
          左のメニューから <${Btn}>現金出納帳<//> を押します。
        <//>
        <${Step} n="2">
          <${Btn}>📒 出納帳<//> タブで、追加のボタンを押して
          日付・お店の名前・分類・金額を入れて保存します。
        <//>
        <${Step} n="3">
          レシートの写真から自動で読み取りたいときは <${Btn}>🤖 AIスキャン<//> タブが使えます。
          読み取った内容が合っているか、金額だけは必ず目で確認してください。
        <//>
      <//>

      <${Section} icon="🆘" title="⑥ 困ったときは（よくある質問）">
        <${Faq} q="数字がおかしい気がする">
          まず「月」が正しいか（◀▶で別の月になっていないか）、
          「別の人」を見ていないかを確認してください。
          それでも変なときは、その画面を開いたまま家族（管理者）に見せてください。
        <//>
        <${Faq} q="印刷ができない">
          一度ページを読み込み直すと直ることが多いです。
          キーボードの <strong>Ctrl キーを押しながら R</strong> を押してください
          （それでもだめなら Ctrl + Shift + R）。入力途中のものは保存してから行ってください。
        <//>
        <${Faq} q="保存を押すのを忘れて画面を移動してしまった">
          保存していない入力は残りません。もう一度同じ画面を開いて入れ直してください。
          保存済みのデータは消えていないので大丈夫です。
        <//>
        <${Faq} q="間違えて保存してしまった">
          同じ画面でもう一度正しい数字を入れて保存すれば、新しい内容で上書きされます。
          給与計算なら「計算結果を削除」でやり直すこともできます。
        <//>
        <${Faq} q="保険料や税金の金額は自分で計算するの？">
          いいえ、全部自動で計算されます。料率（りつ）の設定は管理者が行うので、
          触らなくて大丈夫です。金額が税理士さんの数字と合わないときは管理者に相談してください。
        <//>
        <${Faq} q="どうしてもわからない">
          無理に操作せず、そのままの画面で家族（管理者）に電話してください。
          <strong>わからないまま「削除」や「送信」を押すのだけは避けてください。</strong>
        <//>
      <//>
    </div>
  `;
}
