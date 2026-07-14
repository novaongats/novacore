/* ============================================================
   NOVA Core v2 — Cashbook / Masters tab
   Manage account + department master lists.
   ============================================================ */

import { h } from 'https://esm.sh/preact@10.22.0';
import { useState, useMemo } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { repos, useCollection } from '../../store.js';
import { uid, asArray } from '../../shared.js';

const html = htm.bind(h);

// v2 defaults. Tuned for NOVA post-split (ancore/boat moved out).
const DEFAULT_ACCOUNTS = [
  '飲食代', '食材費', '消耗品費', '事務用品費', '事務備品費',
  '贈答品', '交通費', '車両費', '租税公課', '福利厚生費',
  '宿泊費', '通信費', '広告宣伝費', '修繕費', '水道光熱費',
  '保険料', '外注費', '支払手数料', '雑費',
];
const DEFAULT_DEPTS = [
  'SNSアフィリエイト', 'SNSコンサル', '制作コンテンツ', '本社管理', 'その他',
];

// ---- Main ------------------------------------------------------------------

export function MastersTab() {
  return html`
    <div>
      <${MasterSection}
        title="📂 勘定科目マスタ"
        repo=${repos.cashbookAccounts}
        defaults=${DEFAULT_ACCOUNTS}
        placeholder="例: 広告宣伝費"
      />
      <${MasterSection}
        title="🏢 部門マスタ"
        repo=${repos.cashbookDepts}
        defaults=${DEFAULT_DEPTS}
        placeholder="例: SNSアフィリエイト"
      />
    </div>
  `;
}

// ---- Generic section -------------------------------------------------------

function MasterSection({ title, repo, defaults, placeholder }) {
  const { data, loading, error } = useCollection(repo);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const sorted = useMemo(
    () => [...asArray(data)].sort((a, b) => (a.order ?? 999) - (b.order ?? 999)),
    [data],
  );

  async function add() {
    const name = newName.trim();
    if (!name) return;
    if (sorted.find(x => x.name === name)) {
      setErr('同じ名前が既に登録されています');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await repo.upsert({
        id: uid('m_'),
        name,
        order: sorted.length,
      });
      setNewName('');
    } catch (e) {
      console.error('[masters] add failed', e);
      setErr('追加に失敗: ' + (e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(item) {
    if (!confirm(`「${item.name}」を削除しますか？\n既存の経費データには影響しません。`)) return;
    setBusy(true);
    try {
      await repo.remove(item.id);
    } catch (e) {
      console.error('[masters] remove failed', e);
      setErr('削除に失敗: ' + (e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function seedDefaults() {
    if (sorted.length > 0) {
      if (!confirm('既存項目に追加する形でデフォルトを投入します。よろしいですか？\n(重複する名前はスキップされます)')) return;
    }
    const existing = new Set(sorted.map(x => x.name));
    const toAdd = defaults.filter(n => !existing.has(n));
    setBusy(true);
    setErr(null);
    try {
      for (let i = 0; i < toAdd.length; i++) {
        await repo.upsert({
          id: uid('m_'),
          name: toAdd[i],
          order: sorted.length + i,
        });
      }
    } catch (e) {
      console.error('[masters] seed failed', e);
      setErr('投入に失敗: ' + (e.message || e));
    } finally {
      setBusy(false);
    }
  }

  return html`
    <div class="card" style=${{ padding: 20, marginBottom: 16 }}>
      <div style=${{ display: 'flex', justifyContent: 'space-between',
                     alignItems: 'center', marginBottom: 14 }}>
        <div style=${{ fontSize: 14, fontWeight: 700 }}>${title}</div>
        <button class="btn btn-ghost" onClick=${seedDefaults} disabled=${busy}>
          📦 デフォルトをインポート
        </button>
      </div>

      ${err && html`<div class="note note-err">${err}</div>`}
      ${error && html`<div class="note note-err">読込エラー: ${error.message}</div>`}

      <div style=${{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input type="text" value=${newName}
               onInput=${e => setNewName(e.target.value)}
               onKeyDown=${e => e.key === 'Enter' && add()}
               disabled=${busy}
               placeholder=${placeholder}
               style=${{
                 flex: 1, padding: '10px 12px',
                 border: '1px solid var(--border)', borderRadius: 8,
                 background: '#f8f9fc', fontSize: 14,
               }} />
        <button class="btn" onClick=${add} disabled=${busy || !newName.trim()}>追加</button>
      </div>

      ${loading ? html`<div style=${{ color: 'var(--text-3)' }}>読込中...</div>` :
        sorted.length === 0 ? html`
          <div style=${{
            padding: 20, textAlign: 'center', color: 'var(--text-3)',
            border: '1px dashed var(--border)', borderRadius: 10,
          }}>
            まだ項目がありません。<br/>
            上の入力欄から追加するか、「📦 デフォルトをインポート」をクリックしてください。
          </div>
        ` : html`
          <div style=${{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            ${sorted.map(item => html`
              <div key=${item.id} style=${chip}>
                <span>${item.name}</span>
                <button onClick=${() => remove(item)} disabled=${busy}
                        style=${chipRemove} title="削除">×</button>
              </div>
            `)}
          </div>
        `}
    </div>
  `;
}

// ---- Styles ----------------------------------------------------------------

const chip = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '6px 8px 6px 14px',
  background: 'var(--bg-alt)', borderRadius: 999,
  fontSize: 13, fontWeight: 500,
};
const chipRemove = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 18, height: 18, borderRadius: '50%',
  background: 'rgba(239,68,68,0.1)', color: 'var(--danger)',
  border: 'none', cursor: 'pointer', fontSize: 13, lineHeight: 1,
};
