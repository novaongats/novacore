/* ============================================================
   NOVA Core v2 — Settings page（設定ハブ）
   会社の各種設定をここに集約する:
   プロフィール / ユーザー管理 / 会社・事業 / 給与料率 / API / データ移行

   保存先ポリシー:
   - 会社共通の設定 → Firestore（settings/* や各マスタコレクション）
   - 端末固有の設定（APIキー等）→ localStorage
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useEffect } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import {
  changePassword, createUser, listUsers, saveProfile, isAdmin,
} from '../auth.js';
import { previewImport, runImport, listMappings } from '../importer.js';
import { IssuerTab } from './invoices/issuer.js';
import { RatesTab } from './payroll/rates.js';
import { DeptsAdminSection } from './depts-admin.js';

const html = htm.bind(h);

// ---- Tab definitions -------------------------------------------------------

const TABS = [
  { id: 'profile',  label: 'プロフィール' },
  { id: 'users',    label: 'ユーザー管理', adminOnly: true },
  { id: 'company',  label: '会社・事業',   adminOnly: true },
  { id: 'rates',    label: '給与料率',     adminOnly: true },
  { id: 'api',      label: 'API設定' },
  { id: 'data',     label: 'データ移行',   adminOnly: true },
];

// ---- Main page -------------------------------------------------------------

export function SettingsPage({ user }) {
  const availableTabs = TABS.filter(t => !t.adminOnly || isAdmin(user));
  const [tab, setTab] = useState(availableTabs[0]?.id || 'profile');

  return html`
    <div style=${{ maxWidth: 960 }}>
      <div class="tabbar">
        ${availableTabs.map(t => html`
          <button key=${t.id}
            class=${'tab' + (tab === t.id ? ' active' : '')}
            onClick=${() => setTab(t.id)}>
            ${t.label}
          </button>
        `)}
      </div>

      <div style=${{ marginTop: 20 }}>
        ${tab === 'profile' && html`<${ProfileTab} user=${user} />`}
        ${tab === 'users'   && html`<${UsersTab}   user=${user} />`}
        ${tab === 'company' && html`<${CompanyTab} />`}
        ${tab === 'rates'   && html`
          <div class="note note-info">
            給与計算の社会保険・雇用保険料率です（給与計算ページの「料率設定」タブと同じもの）。
          </div>
          <${RatesTab} />
        `}
        ${tab === 'data'    && html`<${DataTab}    user=${user} />`}
        ${tab === 'api'     && html`<${ApiTab} />`}
      </div>
    </div>
    <style>
      .tabbar { display: flex; gap: 4px; border-bottom: 1px solid var(--border); }
      .tab {
        padding: 10px 18px; border: none; background: transparent;
        color: var(--text-3); font-size: 13px; font-weight: 500;
        cursor: pointer; border-bottom: 2px solid transparent;
        margin-bottom: -1px; font-family: var(--font-jp); transition: all var(--tx-base);
      }
      .tab:hover { color: var(--primary); }
      .tab.active {
        color: var(--primary); border-bottom-color: var(--primary); font-weight: 700;
      }
      .settings-card { margin-bottom: 16px; }
      .settings-card h3 {
        font-size: 14px; font-weight: 700; margin-bottom: 14px;
        padding-bottom: 10px; border-bottom: 1px solid var(--border-2);
      }
      .kv-row {
        display: flex; justify-content: space-between; padding: 8px 0;
        border-bottom: 1px solid var(--border-2); font-size: 13px;
      }
      .kv-row:last-child { border: none; }
      .kv-row .k { color: var(--text-3); }
      .kv-row .v { font-weight: 600; }
      .note {
        padding: 10px 14px; border-radius: 10px; font-size: 12px;
        line-height: 1.7; margin-bottom: 14px;
      }
      .note-warn { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
      .note-info { background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; }
      .note-ok   { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
      .note-err  { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
      .progress-bar {
        height: 10px; background: var(--border); border-radius: 99px;
        overflow: hidden; margin-top: 8px;
      }
      .progress-bar-fill {
        height: 100%; background: var(--primary);
        transition: width .2s;
      }
    </style>
  `;
}

// ---- Profile tab -----------------------------------------------------------

function ProfileTab({ user }) {
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    if (pw1.length < 8) {
      setMsg({ kind: 'err', text: 'パスワードは8文字以上で設定してください' });
      return;
    }
    if (pw1 !== pw2) {
      setMsg({ kind: 'err', text: 'パスワードが一致しません' });
      return;
    }
    setBusy(true);
    try {
      await changePassword(pw1);
      setMsg({ kind: 'ok', text: 'パスワードを変更しました' });
      setPw1(''); setPw2('');
    } catch (e) {
      const code = e?.code || '';
      let text = 'エラー: ' + (e.message || code);
      if (code === 'auth/requires-recent-login') {
        text = 'セキュリティのため再ログインが必要です。一度ログアウトして再度試してください。';
      } else if (code === 'auth/weak-password') {
        text = 'パスワードが弱すぎます';
      }
      setMsg({ kind: 'err', text });
    } finally {
      setBusy(false);
    }
  }

  return html`
    <div class="card settings-card">
      <h3>👤 基本情報</h3>
      <div class="kv-row"><span class="k">ユーザーID</span><span class="v mono">${user.userId || user.uid}</span></div>
      <div class="kv-row"><span class="k">名前</span><span class="v">${user.name}</span></div>
      <div class="kv-row"><span class="k">役職</span><span class="v">${user.role || '-'}</span></div>
      <div class="kv-row"><span class="k">権限</span><span class="v">${user.level}</span></div>
      <div class="kv-row"><span class="k">メール</span><span class="v mono">${user.email}</span></div>
    </div>

    <form class="card settings-card" onSubmit=${submit}>
      <h3>🔑 パスワード変更</h3>
      ${msg && html`<div class=${'note note-' + msg.kind}>${msg.text}</div>`}
      <div class="field">
        <label>新しいパスワード（8文字以上）</label>
        <input type="password" value=${pw1} onInput=${e => setPw1(e.target.value)} disabled=${busy} />
      </div>
      <div class="field">
        <label>確認のため再入力</label>
        <input type="password" value=${pw2} onInput=${e => setPw2(e.target.value)} disabled=${busy} />
      </div>
      <button type="submit" class="btn" disabled=${busy}>
        ${busy ? '変更中...' : 'パスワードを変更'}
      </button>
    </form>
  `;
}

// ---- Company tab (発行者情報 + 事業マスタ) ----------------------------------

function CompanyTab() {
  return html`
    <div class="note note-info">
      会社情報（請求書・領収書の発行元として使用）と、事業（部門）マスタの管理です。
    </div>
    <${IssuerTab} />
    <div style=${{ marginTop: 20 }}></div>
    <${DeptsAdminSection} />
  `;
}

// ---- Users tab (admin only) ------------------------------------------------

function UsersTab({ user }) {
  const [users, setUsers] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [err, setErr] = useState(null);

  async function refresh() {
    try {
      setErr(null);
      const list = await listUsers();
      setUsers(list);
    } catch (e) {
      setErr(e.message || String(e));
    }
  }

  useEffect(() => { refresh(); }, []);

  return html`
    <div class="card settings-card">
      <h3 style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>👥 ユーザー一覧</span>
        <button class="btn" onClick=${() => setShowNew(true)}>＋ ユーザー追加</button>
      </h3>
      ${err && html`<div class="note note-err">${err}</div>`}
      ${users === null && html`<div style=${{ color: 'var(--text-3)' }}>読込中...</div>`}
      ${users && users.length === 0 && html`
        <div style=${{ color: 'var(--text-3)' }}>ユーザーがまだいません</div>
      `}
      ${users && users.length > 0 && html`
        <table style=${{ width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              <th style=${{ textAlign: 'left', padding: '8px 4px', color: 'var(--text-3)', fontWeight: 600 }}>ID</th>
              <th style=${{ textAlign: 'left', padding: '8px 4px', color: 'var(--text-3)', fontWeight: 600 }}>名前</th>
              <th style=${{ textAlign: 'left', padding: '8px 4px', color: 'var(--text-3)', fontWeight: 600 }}>役職</th>
              <th style=${{ textAlign: 'left', padding: '8px 4px', color: 'var(--text-3)', fontWeight: 600 }}>権限</th>
            </tr>
          </thead>
          <tbody>
            ${users.map(u => html`
              <tr key=${u.uid} style=${{ borderTop: '1px solid var(--border-2)' }}>
                <td style=${{ padding: '8px 4px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>${u.userId || u.uid}</td>
                <td style=${{ padding: '8px 4px' }}>${u.name}${u.uid === user.uid && html` <span style=${{ color: 'var(--text-4)', fontSize: 11 }}>(あなた)</span>`}</td>
                <td style=${{ padding: '8px 4px' }}>${u.role || '-'}</td>
                <td style=${{ padding: '8px 4px' }}>${u.level || '-'}</td>
              </tr>
            `)}
          </tbody>
        </table>
      `}
    </div>

    ${showNew && html`<${NewUserModal} onClose=${() => { setShowNew(false); refresh(); }} />`}
  `;
}

function NewUserModal({ onClose }) {
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('スタッフ');
  const [level, setLevel] = useState('staff');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    if (!id.trim() || pw.length < 8 || !name.trim()) {
      setErr('ID・名前・パスワード(8文字以上)は必須です');
      return;
    }
    setBusy(true);
    try {
      await createUser(id, pw, {
        name, role, level,
        color: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'),
        pages: level === 'admin' ? ['*'] : ['home', 'sales'],
      });
      alert(`ユーザー「${name}」を作成しました。\nあなたのログインはそのまま維持されています。`);
      onClose();
    } catch (e) {
      const code = e?.code || '';
      let text = e.message || code;
      if (code === 'auth/email-already-in-use') text = 'このIDは既に使われています';
      else if (code === 'auth/weak-password') text = 'パスワードが弱すぎます（8文字以上推奨）';
      setErr(text);
    } finally {
      setBusy(false);
    }
  }

  return html`
    <div style=${{
      position: 'fixed', inset: 0, background: 'rgba(12,12,20,0.5)',
      backdropFilter: 'blur(4px)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick=${e => e.target === e.currentTarget && onClose()}>
      <form onSubmit=${submit} style=${{
        background: 'var(--surface)', borderRadius: 16, padding: 28,
        maxWidth: 440, width: '100%', boxShadow: 'var(--shadow-lg)',
      }}>
        <h3 style=${{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>新規ユーザー作成</h3>
        ${err && html`<div class="note note-err">${err}</div>`}
        <div class="field">
          <label>ユーザーID *</label>
          <input type="text" value=${id} onInput=${e => setId(e.target.value)} disabled=${busy} placeholder="例: tanaka" />
        </div>
        <div class="field">
          <label>名前 *</label>
          <input type="text" value=${name} onInput=${e => setName(e.target.value)} disabled=${busy} />
        </div>
        <div class="field">
          <label>役職</label>
          <input type="text" value=${role} onInput=${e => setRole(e.target.value)} disabled=${busy} />
        </div>
        <div class="field">
          <label>権限レベル</label>
          <select value=${level} onChange=${e => setLevel(e.target.value)} disabled=${busy}
                  style=${{ width: '100%', padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 10, background: '#f8f9fc', fontFamily: 'inherit' }}>
            <option value="staff">スタッフ</option>
            <option value="manager">マネージャー</option>
            <option value="admin">管理者</option>
          </select>
        </div>
        <div class="field">
          <label>初期パスワード（8文字以上）*</label>
          <input type="text" value=${pw} onInput=${e => setPw(e.target.value)} disabled=${busy} />
        </div>
        <div style=${{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" class="btn btn-ghost" onClick=${onClose} disabled=${busy}>キャンセル</button>
          <button type="submit" class="btn" disabled=${busy}>${busy ? '作成中...' : '作成'}</button>
        </div>
      </form>
    </div>
  `;
}

// ---- Data tab (import / export) --------------------------------------------

function DataTab() {
  const [preview, setPreview] = useState(null);
  const [raw, setRaw] = useState(null);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  async function handleFile(file) {
    setErr(null); setPreview(null); setResult(null); setProgress(null);
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const pv = previewImport(json);
      setRaw(json);
      setPreview(pv);
    } catch (e) {
      setErr('JSONの読込に失敗: ' + (e.message || e));
    }
  }

  // 同一オリジンで旧版を使っていた端末なら、localStorage から直接読み込める
  function loadFromLocalStorage() {
    setErr(null); setPreview(null); setResult(null); setProgress(null);
    try {
      const data = {};
      let found = 0;
      for (const m of listMappings()) {
        const rawVal = localStorage.getItem(m.legacyKey);
        if (rawVal == null) continue;
        try { data[m.legacyKey] = JSON.parse(rawVal); found++; }
        catch { /* 非JSONキーはスキップ */ }
      }
      if (found === 0) {
        setErr('この端末の localStorage に旧NOVACoreのデータが見つかりませんでした。' +
               '旧版を開いていたブラウザ・同じドメインで実行するか、エクスポートJSONを使ってください。');
        return;
      }
      const pv = previewImport(data);
      setRaw(data);
      setPreview(pv);
    } catch (e) {
      setErr('読込に失敗: ' + (e.message || e));
    }
  }

  async function doImport() {
    if (!raw) return;
    if (!confirm('Firestoreへインポートを開始します。同じIDのドキュメントは上書き（merge）されます。よろしいですか？')) return;
    setResult(null);
    setProgress({ current: 0, total: 0, label: '準備中' });
    try {
      const res = await runImport(raw, (p) => setProgress(p));
      setResult(res);
    } catch (e) {
      setErr('インポートエラー: ' + (e.message || e));
    } finally {
      setProgress(null);
    }
  }

  return html`
    <div class="card settings-card">
      <h3>📥 レガシーデータインポート</h3>
      <div class="note note-info">
        v1 の <code>index.html</code> から <code>tools/export-legacy.html</code> で書き出した
        JSON ファイル（<code>novacore-main-YYYY-MM-DD.json</code>）を選択してください。<br/>
        既存のドキュメントはマージされます（上書きではなく差分更新）。
      </div>
      ${err && html`<div class="note note-err">${err}</div>`}

      <div style=${{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <input type="file" accept=".json" onChange=${e => handleFile(e.target.files[0])} />
        <span style=${{ color: 'var(--text-3)', fontSize: 12 }}>または</span>
        <button class="btn btn-ghost" onClick=${loadFromLocalStorage}>
          💾 この端末の旧版データを直接読み込む
        </button>
      </div>

      ${preview && html`
        <h4 style=${{ fontSize: 13, fontWeight: 700, margin: '16px 0 8px' }}>
          プレビュー（${preview.summary.length} キーが認識されました）
        </h4>
        <table style=${{ width: '100%', fontSize: 12.5, marginBottom: 12 }}>
          <thead>
            <tr style=${{ background: 'var(--bg-alt)' }}>
              <th style=${{ textAlign: 'left', padding: '6px 10px', color: 'var(--text-3)', fontWeight: 600 }}>v1キー</th>
              <th style=${{ textAlign: 'left', padding: '6px 10px', color: 'var(--text-3)', fontWeight: 600 }}>→ v2コレクション</th>
              <th style=${{ textAlign: 'right', padding: '6px 10px', color: 'var(--text-3)', fontWeight: 600 }}>件数</th>
            </tr>
          </thead>
          <tbody>
            ${preview.summary.map(s => html`
              <tr key=${s.legacyKey} style=${{ borderBottom: '1px solid var(--border-2)' }}>
                <td style=${{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>${s.legacyKey}</td>
                <td style=${{ padding: '6px 10px' }}>${s.repo}</td>
                <td style=${{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>${s.count}</td>
              </tr>
            `)}
          </tbody>
        </table>
        ${preview.unmapped.length > 0 && html`
          <div class="note note-warn">
            <strong>スキップされるキー (${preview.unmapped.length}):</strong>
            <code style=${{ fontSize: 11 }}>${preview.unmapped.join(', ')}</code>
          </div>
        `}
        <button class="btn" onClick=${doImport} disabled=${!!progress}>
          ${progress ? 'インポート中...' : '📥 インポート実行'}
        </button>
      `}

      ${progress && html`
        <div style=${{ marginTop: 16 }}>
          <div style=${{ fontSize: 13, marginBottom: 6 }}>
            ${progress.label} (${progress.current}/${progress.total})
          </div>
          <div class="progress-bar">
            <div class="progress-bar-fill" style=${{
              width: (progress.total ? (progress.current / progress.total * 100) : 0) + '%'
            }}></div>
          </div>
        </div>
      `}

      ${result && html`
        <div class=${'note ' + (result.failed ? 'note-warn' : 'note-ok')} style=${{ marginTop: 16 }}>
          <strong>完了:</strong> ${result.imported} 件書込
          ${result.failed > 0 && html` / ${result.failed} 件失敗`}
          ${result.errors.length > 0 && html`
            <ul style=${{ marginTop: 8, paddingLeft: 20, fontSize: 11 }}>
              ${result.errors.slice(0, 5).map((e, i) => html`<li key=${i}>${e.key}: ${e.reason}</li>`)}
            </ul>
          `}
        </div>

        <div class="note note-warn" style=${{ marginTop: 12 }}>
          <strong>📋 移行後チェックリスト（必ず確認してください）</strong>
          <ol style=${{ marginTop: 8, paddingLeft: 20, lineHeight: 2 }}>
            <li><strong>料率プリセットの適用</strong>: 給与計算 → 料率設定 →「最新プリセットを適用」を実行（令和8年度の健保・介護・雇保・支援金）</li>
            <li><strong>従業員マスタの扶養人数</strong>: 旧マスタの値がそのまま移行されます。要確認（亨・可子・広浜は扶養0への修正が保留中）</li>
            <li><strong>住民税の月額</strong>: 令和8年度の月別額を確認（志賀 ¥26,500・壁谷 ¥38,100 が2026年7月分から）</li>
            <li><strong>標準報酬月額</strong>: 旧マスタに登録が無い従業員は厚生年金額から逆算しています。従業員マスタで各人の等級を確認</li>
            <li><strong>介護保険料</strong>: 旧版は料率1.82%（古い値）を想定していました。v2は公表値（令和8年度 1.62%）で計算するため、金額が変わったら税理士に確認</li>
            <li><strong>過去の給与一覧</strong>: 給与一覧タブで過去月の総支給・差引が ¥0 でなく正しく表示されるか確認</li>
          </ol>
        </div>
      `}
    </div>

    <div class="card settings-card">
      <h3>🗂 マッピング定義</h3>
      <div class="note note-info">
        v1 localStorage キーと v2 Firestore コレクションの対応表
      </div>
      <table style=${{ width: '100%', fontSize: 12 }}>
        <tbody>
          ${listMappings().map(m => html`
            <tr key=${m.legacyKey} style=${{ borderBottom: '1px solid var(--border-2)' }}>
              <td style=${{ padding: '5px 10px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>${m.legacyKey}</td>
              <td style=${{ padding: '5px 10px', color: 'var(--text-3)' }}>→</td>
              <td style=${{ padding: '5px 10px', fontWeight: 600 }}>${m.targetRepo}</td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>
  `;
}

// ---- API key tab -----------------------------------------------------------

const API_LS_KEY = 'nova_v2_rcpt_api_key';

function ApiTab() {
  const [key, setKey] = useState(() => localStorage.getItem(API_LS_KEY) || '');
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(!localStorage.getItem(API_LS_KEY));

  function save() {
    localStorage.setItem(API_LS_KEY, key.trim());
    setSaved(true);
    setEditing(false);
    setTimeout(() => setSaved(false), 2000);
  }

  function clearKey() {
    if (!confirm('APIキーを削除しますか？')) return;
    localStorage.removeItem(API_LS_KEY);
    setKey('');
    setEditing(true);
  }

  const masked = key ? key.slice(0, 10) + '...' + key.slice(-4) : '';

  return html`
    <div class="card settings-card">
      <h3>🔑 Claude API キー</h3>
      <div class="note note-warn">
        <strong>端末ローカルのみに保存されます。</strong>
        Firestore へは同期されません（v1のセキュリティ問題を修正）。<br/>
        他の端末でも使うには、それぞれの端末で再入力が必要です。
      </div>

      ${!editing && key && html`
        <div style=${{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style=${{
            flex: 1, padding: '10px 14px', background: 'var(--success-soft)',
            color: 'var(--success)', borderRadius: 10, fontFamily: 'var(--font-mono)', fontSize: 13,
          }}>
            ✓ 設定済み: ${masked}
          </div>
          <button class="btn btn-ghost" onClick=${() => setEditing(true)}>変更</button>
          <button class="btn btn-danger" onClick=${clearKey}>削除</button>
        </div>
      `}

      ${editing && html`
        <div class="field">
          <label>Anthropic API キー（sk-ant-... から始まる文字列）</label>
          <input type="password" value=${key} onInput=${e => setKey(e.target.value)}
                 placeholder="sk-ant-..." style=${{ fontFamily: 'var(--font-mono)' }} />
        </div>
        <button class="btn" onClick=${save}>保存</button>
        ${saved && html`<span style=${{ marginLeft: 12, color: 'var(--success)', fontSize: 12 }}>✓ 保存しました</span>`}
      `}

      <div class="note note-info" style=${{ marginTop: 16 }}>
        取得方法: <a href="https://console.anthropic.com/settings/keys" target="_blank"
                   style=${{ color: 'var(--primary)' }}>console.anthropic.com/settings/keys</a>
      </div>
    </div>
  `;
}

// Helper export for other pages that need to read the API key
export function getClaudeApiKey() {
  return localStorage.getItem(API_LS_KEY) || '';
}
