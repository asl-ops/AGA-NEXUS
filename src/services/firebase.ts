
import { initializeApp, getApps } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  signInWithPopup,
  setPersistence,
  signInWithRedirect,
  signOut,
  type Auth,
} from "firebase/auth";
import {
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
  type Firestore,
} from "firebase/firestore";
import {
  getStorage,
  connectStorageEmulator,
  type FirebaseStorage,
} from "firebase/storage";
import { connectAuthEmulator } from "firebase/auth";
import { firebaseConfig } from "../config/firebase.config";

const ALLOWED_EMAIL_DOMAIN = "gestoria-arcos.com";
const REDIRECT_ATTEMPT_COUNT_KEY = "aga_nexus_auth_redirect_attempt_count";

const app =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

const createFirestoreInstance = (): Firestore => {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch (error) {
    console.warn(
      "Firebase: IndexedDB persistence no disponible. Continuando con caché en memoria.",
      error
    );
    return initializeFirestore(app, {
      localCache: memoryLocalCache(),
    });
  }
};

export const db: Firestore = createFirestoreInstance();

export const auth: Auth = getAuth(app);
export const storage: FirebaseStorage = getStorage(app);

const shouldUseEmulators =
  import.meta.env.VITE_USE_FIREBASE_EMULATOR === "true" &&
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

if (shouldUseEmulators) {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  console.log("Firebase: Emuladores activados (Firestore/Auth/Storage).");
}

let authInitialized = false;

export const initializeAuth = async () => {
  if (authInitialized) return;

  if (shouldUseEmulators) {
    authInitialized = true;
    return;
  }

  try {
    await setPersistence(auth, browserLocalPersistence).catch(() => null);
    const redirectResult = await getRedirectResult(auth).catch(() => null);
    const currentUser = redirectResult?.user ?? auth.currentUser;

    if (!currentUser) {
      const loginRequiredError: any = new Error("Se requiere iniciar sesión.");
      loginRequiredError.code = "auth/login-required";
      throw loginRequiredError;
    }

    const email = (currentUser?.email || auth.currentUser?.email || "").toLowerCase().trim();
    const hasValidDomain = email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);

    if (!hasValidDomain) {
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(REDIRECT_ATTEMPT_COUNT_KEY);
      }
      await signOut(auth);
      const error = new Error(`Dominio no permitido. Usa tu cuenta @${ALLOWED_EMAIL_DOMAIN}.`);
      (error as any).code = "auth/invalid-domain";
      throw error;
    }

    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(REDIRECT_ATTEMPT_COUNT_KEY);
    }

    authInitialized = true;
    console.log(`Firebase: Auth OK (${email}).`);
  } catch (error) {
    if ((error as any)?.code !== "auth/login-required") {
      console.error("Firebase: Login failed.");
    }
    throw error;
  }
};

export const signInWithGoogleInteractive = async (): Promise<void> => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({
    hd: ALLOWED_EMAIL_DOMAIN,
    prompt: "select_account",
  });

  await setPersistence(auth, browserLocalPersistence).catch(() => null);
  let result;
  try {
    result = await signInWithPopup(auth, provider);
  } catch (popupError: any) {
    const code = popupError?.code || "";
    const shouldFallbackToRedirect =
      code.includes("popup-blocked") ||
      code.includes("popup-closed-by-user") ||
      code.includes("cancelled-popup-request");

    if (!shouldFallbackToRedirect) {
      throw popupError;
    }

    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(REDIRECT_ATTEMPT_COUNT_KEY, "1");
    }
    await signInWithRedirect(auth, provider);
    const redirectingError: any = new Error("Redirigiendo a Google...");
    redirectingError.code = "auth/redirecting";
    throw redirectingError;
  }

  const email = (result.user?.email || "").toLowerCase().trim();
  const hasValidDomain = email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);

  if (!hasValidDomain) {
    await signOut(auth);
    const error = new Error(`Dominio no permitido. Usa tu cuenta @${ALLOWED_EMAIL_DOMAIN}.`);
    (error as any).code = "auth/invalid-domain";
    throw error;
  }

  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(REDIRECT_ATTEMPT_COUNT_KEY);
  }

  authInitialized = true;
};
