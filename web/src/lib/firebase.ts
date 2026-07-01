// Initialisation SDK Firebase (BUILD_KIT §12).
// La config web Firebase est publique par conception ; surchargeable via variables VITE_*.
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
} from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "AIzaSyBHxv2ThBh66hRc1Lp_boTlzeB8LA37FF8",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "propulse-business-87f7a.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "propulse-business-87f7a",
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "propulse-business-87f7a.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "952738555565",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "1:952738555565:web:f20523a77118a53267c824",
};

export const app = initializeApp(firebaseConfig);

// Persistance offline (§1 local-first, §12).
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const auth = getAuth(app);
export const functions = getFunctions(app);

// Branchement Emulator Suite en dev (VITE_USE_EMULATORS=true).
if (import.meta.env.VITE_USE_EMULATORS === "true") {
  connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "localhost", 8080);
  connectFunctionsEmulator(functions, "localhost", 5001);
}
