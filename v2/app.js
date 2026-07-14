/* ============================================================
   NOVA Core v2 — Main entry
   Preact + htm + Firebase (Auth, Firestore, Storage), no build step.
   ============================================================ */

import { h, render } from 'https://esm.sh/preact@10.22.0';
import { useState, useEffect } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { useAuth, signIn, signOut, hasAccess, enableDevBypass, changePassword } from './auth.js';
import { initDepts } from './depts.js';
import { SettingsPage } from './pages/settings.js';
import { SalesPage } from './pages/sales/index.js';
import { CashbookPage } from './pages/cashbook/index.js';
import { InvoicesPage } from './pages/invoices/index.js';
import { DocumentsPage } from './pages/documents/index.js';
import { PayrollPage } from './pages/payroll/index.js';
import { TaxReportPage } from './pages/tax/index.js';
import { HomePage } from './pages/home.js';

const html = htm.bind(h);

// ---- Navigation ------------------------------------------------------------

const NAV = [
  { group: '経営管理' },
  { id: 'home',      label: 'ホーム',       icon: '⬡' },
  { id: 'sales',     label: '売上管理',     icon: '▲' },
  { id: 'cashbook',  label: '現金出納帳',   icon: '📒' },
  { id: 'payroll',   label: '給与計算',     icon: '⬟' },
  { group: '書類' },
  { id: 'invoices',  label: '請求・領収書', icon: '▢' },
  { id: 'docs',      label: '書類管理',     icon: '▤' },
  { id: 'tax',       label: '税理士提出書類', icon: '▧' },
  { group: '設定' },
  { id: 'settings',  label: '設定',         icon: '⚙' },
];

const DEFAULT_PAGE = 'home';
const PAGE_IDS = NAV.filter(n => n.id).map(n => n.id);

// ---- Pages ------------------------------------------------------------------

const PAGES = {
  home:     HomePage,
  settings: SettingsPage,
  sales:    SalesPage,
  cashbook: CashbookPage,
  invoices: InvoicesPage,
  docs:     DocumentsPage,
  payroll:  PayrollPage,
  tax:      TaxReportPage,
};

// ---- Hash router -----------------------------------------------------------

function getRoute() {
  const hash = (location.hash || '').replace(/^#\/?/, '');
  return PAGE_IDS.includes(hash) ? hash : DEFAULT_PAGE;
}

function useRoute() {
  const [route, setRoute] = useState(getRoute());
  useEffect(() => {
    const onHash = () => setRoute(getRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

function navigate(id) {
  location.hash = '#/' + id;
}

// ---- Login screen ----------------------------------------------------------

function LoginScreen() {
  const [id, setId] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!id.trim() || !pass) {
      setErr('IDとパスワードを入力してください');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await signIn(id, pass);
      // onAuthStateChanged in useAuth() will pick up the new user.
    } catch (e) {
      setBusy(false);
      const code = e?.code || '';
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        setErr('IDまたはパスワードが違います');
      } else if (code === 'auth/too-many-requests') {
        setErr('試行回数が多すぎます。しばらく時間をおいてください');
      } else if (code === 'auth/network-request-failed') {
        setErr('ネットワーク接続を確認してください');
      } else if (code === 'auth/configuration-not-found') {
        setErr('Firebase Auth 未有効化。Console で Email/Password を有効化してください');
      } else {
        setErr('ログインエラー: ' + (e.message || code));
      }
    }
  }

  return html`
    <div class="login-scrim">
      <form class="login-card" onSubmit=${submit}>
        <div class="login-logo">N</div>
        <div class="login-title">NOVA Core</div>
        <div class="login-subtitle">Business Suite にログイン</div>
        <div style="margin-top: 28px"></div>
        <div class="field">
          <label>ユーザーID</label>
          <input type="text" autocomplete="username" disabled=${busy}
                 value=${id} onInput=${e => setId(e.target.value)} autofocus />
        </div>
        <div class="field">
          <label>パスワード</label>
          <input type="password" autocomplete="current-password" disabled=${busy}
                 value=${pass} onInput=${e => setPass(e.target.value)} />
        </div>
        <button type="submit" class="login-btn" disabled=${busy}>
          ${busy ? 'ログイン中...' : 'ログイン'}
        </button>
        <div class="login-error">${err}</div>

        <div style=${{
          marginTop: 20, paddingTop: 16,
          borderTop: '1px dashed rgba(0,0,0,0.1)',
          textAlign: 'center',
        }}>
          <button type="button" onClick=${() => { enableDevBypass(); location.reload(); }}
                  style=${{
                    background: 'transparent', border: '1px solid var(--border)',
                    color: 'var(--text-3)', padding: '8px 16px', borderRadius: 8,
                    fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
            👁 デモモード（UI確認のみ・データ保存なし）
          </button>
          <div style=${{
            marginTop: 10, fontSize: 10, color: 'var(--text-4)',
            letterSpacing: '0.02em', lineHeight: 1.5,
          }}>
            Firebase 未設定でもUIを確認できます。<br/>
            本番利用は Firebase Console でユーザー作成後にログインしてください。
          </div>
        </div>
      </form>
    </div>
  `;
}

// ---- Sidebar ---------------------------------------------------------------

function Sidebar({ route, user, onNavigate, open }) {
  return html`
    <aside class=${'sidebar' + (open ? ' open' : '')}>
      <div class="sb-header">
        <div class="sb-logo">N</div>
        <div>
          <div class="sb-title">NOVA Core</div>
          <div class="sb-subtitle">Business Suite</div>
        </div>
      </div>
      <nav class="sb-nav">
        ${NAV.map(item => {
          if (item.group) {
            return html`<div class="sb-group" key=${'g-' + item.group}>${item.group}</div>`;
          }
          if (!hasAccess(user, item.id) && user?.level !== 'admin') return null;
          return html`
            <button
              key=${item.id}
              class=${'sb-item' + (route === item.id ? ' active' : '')}
              onClick=${() => onNavigate(item.id)}
            >
              <span class="sb-icon">${item.icon}</span>${item.label}
            </button>
          `;
        })}
      </nav>
      <div class="sb-footer">
        <div>v2 · 有限会社NOVA</div>
      </div>
    </aside>
  `;
}

// ---- Topbar ----------------------------------------------------------------

function Topbar({ route, user, onLogout, onMenu }) {
  const item = NAV.find(n => n.id === route);
  const title = item ? item.label : 'NOVA Core';
  const today = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  });
  return html`
    <header class="topbar">
      <div style=${{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button class="menu-btn" onClick=${onMenu} aria-label="メニュー">☰</button>
        <div>
          <div class="topbar-title">${title}</div>
          <div class="topbar-sub">有限会社NOVA · ${today}</div>
        </div>
      </div>
      <div class="topbar-actions">
        <div class="user-chip">
          <span class="user-avatar" style=${{ background: user.color || '#6366f1' }}>
            ${(user.name || '?').charAt(0)}
          </span>
          <span>${user.name}（${user.role || ''}）</span>
          <button class="btn btn-ghost" onClick=${onLogout}>ログアウト</button>
        </div>
        <div class="badge badge-sync"><span class="dot"></span>同期中</div>
      </div>
    </header>
  `;
}

// ---- Forced password change (first login) ----------------------------------

function ChangePasswordScreen({ user }) {
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (p1.length < 8) { setErr('パスワードは8文字以上にしてください'); return; }
    if (p1 !== p2) { setErr('確認用パスワードが一致しません'); return; }
    setBusy(true);
    setErr('');
    try {
      await changePassword(p1);
      location.reload();
    } catch (e2) {
      setBusy(false);
      setErr(e2?.code === 'auth/requires-recent-login'
        ? '一度ログアウトして再ログイン後にもう一度お試しください'
        : '変更に失敗しました: ' + (e2?.message || e2));
    }
  }

  return html`
    <div class="login-scrim">
      <form class="login-card" onSubmit=${submit}>
        <div class="login-logo">N</div>
        <div class="login-title">パスワードの変更</div>
        <div class="login-subtitle">
          ${user.name} さん、初回ログインのため新しいパスワードを設定してください
        </div>
        <div style="margin-top: 24px"></div>
        <div class="field">
          <label>新しいパスワード（8文字以上）</label>
          <input type="password" autocomplete="new-password" disabled=${busy}
                 value=${p1} onInput=${e => setP1(e.target.value)} autofocus />
        </div>
        <div class="field">
          <label>新しいパスワード（確認）</label>
          <input type="password" autocomplete="new-password" disabled=${busy}
                 value=${p2} onInput=${e => setP2(e.target.value)} />
        </div>
        <button type="submit" class="login-btn" disabled=${busy}>
          ${busy ? '変更中...' : '変更してはじめる'}
        </button>
        <div class="login-error">${err}</div>
      </form>
    </div>
  `;
}

// ---- Fatal-error screen ----------------------------------------------------

function ErrorScreen({ error }) {
  const code = error?.code || '';
  const isConfig = code.startsWith('auth/configuration') || code === 'permission-denied';
  return html`
    <div class="login-scrim">
      <div class="login-card">
        <div class="login-logo" style=${{ background: 'linear-gradient(135deg,#ef4444,#f87171)' }}>!</div>
        <div class="login-title">接続エラー</div>
        <div class="login-subtitle">
          ${isConfig
            ? 'Firebase のセットアップが未完了の可能性があります'
            : 'Firebase との接続に失敗しました'}
        </div>
        <div style="margin-top: 22px; padding: 12px 16px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; font-size: 12px; color: #991b1b; font-family: var(--font-mono); word-break: break-all">
          ${error?.message || String(error)}
        </div>
        <div style="margin-top: 16px; font-size: 12px; color: var(--text-3); line-height: 1.7">
          確認事項:<br/>
          ・Firebase Console で Authentication (Email/Password) を有効化<br/>
          ・Firestore Database を作成<br/>
          ・ルールを <code>auth != null</code> で貼付<br/>
          詳細は <code>firebase.js</code> のコメントを参照。
        </div>
      </div>
    </div>
  `;
}

// ---- App shell -------------------------------------------------------------

function App() {
  const { loading, user, error } = useAuth();

  // Wait for auth resolution (cached session loads instantly).
  if (loading) {
    return html`
      <div class="boot-loader">
        <div class="boot-logo">N</div>
        <div class="boot-text">認証状態を確認中...</div>
      </div>
    `;
  }

  if (error) return html`<${ErrorScreen} error=${error} />`;
  if (!user) return html`<${LoginScreen} />`;
  if (user.mustChangePassword && !user._devBypass) {
    return html`<${ChangePasswordScreen} user=${user} />`;
  }

  return html`<${AuthenticatedApp} user=${user} />`;
}

function AuthenticatedApp({ user }) {
  const route = useRoute();
  const [menuOpen, setMenuOpen] = useState(false);

  // 事業（部門）マスタの購読開始（デモモードでは静的フォールバックのまま）
  useEffect(() => {
    if (!user?._devBypass) initDepts();
  }, [user]);

  // Guard: if user lacks access to current route, bounce to home.
  const allowed = hasAccess(user, route) || user.level === 'admin';
  useEffect(() => {
    if (!allowed && route !== DEFAULT_PAGE) navigate(DEFAULT_PAGE);
  }, [route, user]);

  // 権限外ページはリダイレクト前の1レンダーでもマウントさせない
  // （購読開始・UIフラッシュ防止）。
  const PageComp = allowed ? (PAGES[route] || PAGES[DEFAULT_PAGE]) : PAGES[DEFAULT_PAGE];

  async function handleLogout() {
    try { await signOut(); } catch (e) { console.warn(e); }
  }

  return html`
    <div class="app-shell">
      <${Sidebar} route=${route} user=${user} open=${menuOpen}
                  onNavigate=${(id) => { setMenuOpen(false); navigate(id); }} />
      ${menuOpen && html`
        <div class="sidebar-backdrop" onClick=${() => setMenuOpen(false)}></div>
      `}
      <div class="main">
        <${Topbar} route=${route} user=${user} onLogout=${handleLogout}
                   onMenu=${() => setMenuOpen(o => !o)} />
        <main class="content">
          <${PageComp} user=${user} />
        </main>
      </div>
    </div>
  `;
}

// ---- Mount -----------------------------------------------------------------

const root = document.getElementById('app');
root.innerHTML = ''; // clear boot loader
render(html`<${App} />`, root);

if (!location.hash) navigate(DEFAULT_PAGE);
