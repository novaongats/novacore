/* ============================================================
   NOVA Core v2 — Firestore data layer
   Generic CRUD + reactive hook. Each collection has a repo.
   ============================================================ */

import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc,
  onSnapshot, query, serverTimestamp,
  where, orderBy, limit, startAt, endAt,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  ref as storageRef, uploadBytes, getDownloadURL, deleteObject,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import { useState, useEffect, useRef } from 'https://esm.sh/preact@10.22.0/hooks';
import { db, storage } from './firebase.js';

// デモモード判定。auth.js と同じキーを見るが、auth.js を import すると
// store → auth → depts → store の循環になるためここで直接読む。
function isDevBypass() {
  try { return localStorage.getItem('nova_v2_dev_bypass') === '1'; }
  catch { return false; }
}

// デモモード（UI確認のみ）では書込を全面ブロックする。
function guardWrite() {
  if (isDevBypass()) {
    throw new Error('デモモード中はデータを保存できません（UI確認のみ）');
  }
}

// Re-export query helpers so pages don't need to know the CDN path.
export { where, orderBy, limit, startAt, endAt };

// ---- Repo factory ----------------------------------------------------------

export function createRepo(name) {
  const ref = () => collection(db, name);

  return {
    name,
    ref,

    /** One-shot list. Pass query constraints (where/orderBy/limit) as args. */
    async list(...constraints) {
      const q = constraints.length ? query(ref(), ...constraints) : ref();
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    /** One-shot fetch by id. */
    async get(id) {
      const snap = await getDoc(doc(db, name, id));
      return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    },

    /**
     * Insert (no id) or update-merge (with id).
     * Returns the document id.
     */
    async upsert(data) {
      guardWrite();
      const payload = { ...data, updatedAt: serverTimestamp() };
      if (data.id) {
        const { id, ...rest } = payload;
        await setDoc(doc(db, name, id), rest, { merge: true });
        return id;
      }
      const res = await addDoc(ref(), { ...payload, createdAt: serverTimestamp() });
      return res.id;
    },

    /** Set a document with an explicit id (overwrite/merge). */
    async setId(id, data, { merge = true } = {}) {
      guardWrite();
      await setDoc(
        doc(db, name, id),
        { ...data, updatedAt: serverTimestamp() },
        { merge }
      );
    },

    async remove(id) {
      guardWrite();
      await deleteDoc(doc(db, name, id));
    },

    /**
     * Live subscription to the full collection (or a query).
     * callback(rows, snapshot) — snapshot はメタデータ（fromCache 等）の参照用。
     * onError は省略可（省略時は console.error のみ）。
     */
    subscribe(callback, onError, ...constraints) {
      const q = constraints.length ? query(ref(), ...constraints) : ref();
      return onSnapshot(q,
        (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() })), snap),
        (err) => {
          console.error(`[store] ${name} subscribe error:`, err);
          if (typeof onError === 'function') onError(err);
        }
      );
    },
  };
}

// ---- Collection registry ---------------------------------------------------
// Each page should import only what it needs.

export const repos = {
  // Users / profiles
  users: createRepo('users'),

  // Sales (merged: depts master + categories + daily entries + monthly cost sheets)
  salesDepts:      createRepo('salesDepts'),
  staffMembers:    createRepo('staffMembers'), // 担当者マスタ（v1 nova_members 由来）
  salesCategories: createRepo('salesCategories'),
  salesEntries:    createRepo('salesEntries'),
  salesCosts:      createRepo('salesCosts'),

  // Cashbook (merged: AI receipt sort + manual entries)
  cashbook:         createRepo('cashbook'),
  cashbookAccounts: createRepo('cashbookAccounts'),
  cashbookDepts:    createRepo('cashbookDepts'),

  // Invoices / quotes / receipts (as a document type)
  invoices:       createRepo('invoices'),
  invoiceClients: createRepo('invoiceClients'),
  invoiceBanks:   createRepo('invoiceBanks'),

  // Document storage (metadata; files go to Firebase Storage)
  documents: createRepo('documents'),

  // Payroll
  payrollEmployees:    createRepo('payrollEmployees'),
  payrollRecords:      createRepo('payrollRecords'),
  payrollBonus:        createRepo('payrollBonus'),
  payrollRates:        createRepo('payrollRates'),
  payrollBankAccounts: createRepo('payrollBankAccounts'),

  // System
  settings: createRepo('settings'),
};

// ---- Reactive hooks --------------------------------------------------------

/**
 * Subscribe to a collection. `deps` retriggers the subscription.
 * `buildQuery(repo)` returns an array of query constraints (where/orderBy/...).
 */
export function useCollection(repo, buildQuery = null, deps = []) {
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    // デモモード: Firebase に触れず空データを即返す（UI確認のみ）。
    if (isDevBypass()) { setData([]); setError(null); return; }
    // deps（月切替等）で再購読するとき、前クエリのデータを保持しない。
    // 保持すると loading=false のまま前月データが1フレーム以上見え、
    // それを useState 初期値に取り込むページ（給与計算等）が
    // 前月値で新しい月を上書きする事故になる。
    setData(null);
    setError(null);
    let alive = true;
    const constraints = buildQuery ? buildQuery(repo) : [];
    const unsub = repo.subscribe(
      (rows) => { if (alive) { setData(rows); setError(null); } },
      // 購読エラー（permission-denied 等）は error に表面化させ、
      // loading を解除して無限スケルトンを防ぐ。
      (err) => { if (alive) { setData([]); setError(err); } },
      ...constraints,
    );
    return () => { alive = false; unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, ...deps]);

  return { data: data ?? [], loading: data === null, error };
}

/** Single-doc subscription. */
export function useDoc(repo, id) {
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) { setData(null); setLoading(false); return; }
    if (isDevBypass()) { setData(null); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const unsub = onSnapshot(doc(db, repo.name, id), (snap) => {
      setData(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      setLoading(false);
    }, (err) => {
      console.error(`[store] ${repo.name}/${id} subscribe error:`, err);
      setError(err);
      setLoading(false);
    });
    return unsub;
  }, [repo, id]);

  return { data, loading, error };
}

// ---- Firebase Storage helpers ---------------------------------------------

/**
 * Upload a File or Blob. `pathParts` are joined with slashes.
 * Returns { url, storagePath, originalName, size, contentType }.
 */
export async function uploadFile(file, ...pathParts) {
  guardWrite();
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  const ext = (file.name || '').split('.').pop() || 'bin';
  const safeName = `${ts}_${rand}.${ext}`;
  const path = [...pathParts, safeName].filter(Boolean).join('/');
  const ref = storageRef(storage, path);
  const snap = await uploadBytes(ref, file, { contentType: file.type });
  const url = await getDownloadURL(snap.ref);
  return {
    url,
    storagePath: path,
    originalName: file.name,
    size: file.size,
    contentType: file.type,
  };
}

export async function deleteFile(storagePath) {
  if (!storagePath) return;
  try {
    await deleteObject(storageRef(storage, storagePath));
  } catch (e) {
    console.warn('[store] deleteFile failed', storagePath, e);
  }
}
