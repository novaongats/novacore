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
      await setDoc(
        doc(db, name, id),
        { ...data, updatedAt: serverTimestamp() },
        { merge }
      );
    },

    async remove(id) {
      await deleteDoc(doc(db, name, id));
    },

    /** Live subscription to the full collection (or a query). */
    subscribe(callback, ...constraints) {
      const q = constraints.length ? query(ref(), ...constraints) : ref();
      return onSnapshot(q,
        (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
        (err) => console.error(`[store] ${name} subscribe error:`, err)
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
    // Note: When Firestore rules require auth but dev-bypass is on,
    // subscriptions will error out with permission-denied. That surfaces
    // in the error state so pages display a useful message instead of
    // hanging forever.
    let alive = true;
    const constraints = buildQuery ? buildQuery(repo) : [];
    const unsub = repo.subscribe(
      (rows) => { if (alive) { setData(rows); setError(null); } },
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

  useEffect(() => {
    if (!id) { setData(null); setLoading(false); return; }
    setLoading(true);
    const unsub = onSnapshot(doc(db, repo.name, id), (snap) => {
      setData(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      setLoading(false);
    }, (err) => {
      console.error(`[store] ${repo.name}/${id} subscribe error:`, err);
      setLoading(false);
    });
    return unsub;
  }, [repo, id]);

  return { data, loading };
}

// ---- Firebase Storage helpers ---------------------------------------------

/**
 * Upload a File or Blob. `pathParts` are joined with slashes.
 * Returns { url, storagePath, originalName, size, contentType }.
 */
export async function uploadFile(file, ...pathParts) {
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
