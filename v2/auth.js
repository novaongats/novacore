/* ============================================================
   NOVA Core v2 — Authentication layer
   Firebase Auth (Email/Password) + Firestore user profile.
   ============================================================ */

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  updatePassword,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  doc, getDoc, setDoc, collection, getDocs, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { useState, useEffect } from 'https://esm.sh/preact@10.22.0/hooks';
import { auth, db } from './firebase.js';

// Users log in with a short ID (e.g. "z"). We synthesize an email
// so Firebase Auth has something to work with.
const EMAIL_DOMAIN = '@novacore.local';

// Dev bypass: lets users tour the UI without Firebase setup.
// When active, useAuth() returns a fake admin user and store.js
// short-circuits useCollection to return empty arrays.
const DEV_BYPASS_KEY = 'nova_v2_dev_bypass';

export function isDevBypass() {
  try { return localStorage.getItem(DEV_BYPASS_KEY) === '1'; }
  catch { return false; }
}
export function enableDevBypass() {
  localStorage.setItem(DEV_BYPASS_KEY, '1');
}
export function disableDevBypass() {
  localStorage.removeItem(DEV_BYPASS_KEY);
}

const DEV_USER = {
  uid: 'dev_user',
  email: 'dev@novacore.local',
  userId: 'dev',
  name: 'Demo User',
  role: 'UIプレビュー',
  color: '#ef4444',
  level: 'admin',
  pages: ['*'],
  _devBypass: true,
};

export function idToEmail(id) {
  return String(id || '').trim().toLowerCase() + EMAIL_DOMAIN;
}

// ---- Profile (Firestore users/{uid}) ---------------------------------------

export async function loadProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? { uid, ...snap.data() } : null;
}

export async function saveProfile(uid, profile) {
  await setDoc(
    doc(db, 'users', uid),
    { ...profile, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function listUsers() {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

// ---- Sign in / out ---------------------------------------------------------

export async function signIn(id, password) {
  const email = idToEmail(id);
  const cred = await signInWithEmailAndPassword(auth, email, password);
  let profile = await loadProfile(cred.user.uid);

  // First-login seed: if profile is missing, create a minimal one.
  if (!profile) {
    const seed = {
      userId: String(id).trim().toLowerCase(),
      name: id,
      role: 'スタッフ',
      color: '#6366f1',
      level: 'staff',
      pages: ['home'],
      createdAt: serverTimestamp(),
    };
    await saveProfile(cred.user.uid, seed);
    profile = { uid: cred.user.uid, ...seed };
  }
  return profile;
}

export async function signOut() {
  if (isDevBypass()) {
    disableDevBypass();
    location.reload();
    return;
  }
  await fbSignOut(auth);
}

// ---- Admin: create user ----------------------------------------------------

/**
 * Create a new user. Only admins should call this.
 * Note: createUserWithEmailAndPassword signs in AS the new user.
 * After creation, the admin needs to sign back in.
 */
export async function createUser(id, password, profile) {
  const email = idToEmail(id);
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await saveProfile(cred.user.uid, {
    userId: String(id).trim().toLowerCase(),
    ...profile,
    createdAt: serverTimestamp(),
    mustChangePassword: true,
  });
  return { uid: cred.user.uid, email };
}

export async function changePassword(newPassword) {
  if (!auth.currentUser) throw new Error('ログインしていません');
  await updatePassword(auth.currentUser, newPassword);
  await saveProfile(auth.currentUser.uid, { mustChangePassword: false });
}

// ---- Reactive hook ---------------------------------------------------------

/**
 * Tracks auth state + loads Firestore profile.
 * Returns { loading, user, error }.
 */
export function useAuth() {
  const [state, setState] = useState({ loading: true, user: null, error: null });

  useEffect(() => {
    // Dev bypass short-circuit: instant fake admin without Firebase.
    if (isDevBypass()) {
      setState({ loading: false, user: DEV_USER, error: null });
      return;
    }

    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setState({ loading: false, user: null, error: null });
        return;
      }
      try {
        let profile = await loadProfile(fbUser.uid);
        if (!profile) {
          // Seed from the Firebase Auth email if profile doc is missing.
          const localPart = (fbUser.email || '').split('@')[0] || fbUser.uid;
          const seed = {
            userId: localPart,
            name: localPart,
            role: '管理者',
            color: '#6366f1',
            level: 'admin',
            pages: ['*'],
            createdAt: serverTimestamp(),
          };
          await saveProfile(fbUser.uid, seed);
          profile = { uid: fbUser.uid, ...seed };
        }
        setState({
          loading: false,
          user: { ...profile, uid: fbUser.uid, email: fbUser.email },
          error: null,
        });
      } catch (e) {
        console.error('[auth] loadProfile failed', e);
        setState({ loading: false, user: null, error: e });
      }
    });
    return unsub;
  }, []);

  return state;
}

// ---- Permission helpers ----------------------------------------------------

export function hasAccess(user, pageId) {
  if (!user) return false;
  if (user.level === 'admin') return true;
  if (!Array.isArray(user.pages)) return false;
  return user.pages.includes('*') || user.pages.includes(pageId);
}

export function isAdmin(user) {
  return !!user && user.level === 'admin';
}
