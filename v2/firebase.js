/* ============================================================
   NOVA Core v2 — Firebase initialization
   Uses Firebase v10 modular SDK via Google's gstatic CDN.
   gstatic URLs share the same module graph, ensuring component
   registration works correctly (esm.sh re-bundling breaks this).
   ============================================================ */

import { initializeApp }  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth }        from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore }   from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getStorage }     from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

// Existing NOVACore Firebase project. Reused to keep Storage files accessible.
// Auth + Firestore must be enabled in Firebase Console (see SETUP notes below).
const config = {
  apiKey: 'AIzaSyCA4bkG1VV1ad-7FldSxXEd3reG7vnYnTQ',
  authDomain: 'novacore-65fb5.firebaseapp.com',
  databaseURL: 'https://novacore-65fb5-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'novacore-65fb5',
  storageBucket: 'novacore-65fb5.firebasestorage.app',
  messagingSenderId: '1031615296415',
  appId: '1:1031615296415:web:eb9fb2a4186798022983aa',
};

export const app = initializeApp(config);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

/* ==============================================================
   SETUP (Firebase Console 側で1回だけ実施):

   1. Authentication → Sign-in method → Email/Password を有効化
   2. Firestore Database → データベース作成（asia-northeast1 推奨）
   3. Firestore → ルール に以下を貼付:

      rules_version = '2';
      service cloud.firestore {
        match /databases/{database}/documents {
          match /{document=**} {
            allow read, write: if request.auth != null;
          }
        }
      }

   4. Storage → ルールに以下を貼付:

      rules_version = '2';
      service firebase.storage {
        match /b/{bucket}/o {
          match /{allPaths=**} {
            allow read, write: if request.auth != null;
          }
        }
      }

   5. Authentication → Users → 管理者を1人追加
      (メール: z@novacore.local / パスワード: 任意の強固なもの)
   ============================================================== */
