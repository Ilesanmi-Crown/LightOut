// Single Firebase app + App Check instance for the whole app.
// Order matters: App Check must be initialized BEFORE getAI (and the other
// services), on the SAME app instance, exactly once.
import { initializeApp, getApp, getApps } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAI, GoogleAIBackend } from "firebase/ai";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getRemoteConfig } from "firebase/remote-config";

const env = import.meta.env;

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

// 1. One app. getApps() guards against a second initializeApp (e.g. Vite HMR re-running this module).
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// 2. App Check, once, before any other service is created.
// The app is registered in App Check with Fraud Defense (reCAPTCHA Enterprise).
export const RECAPTCHA_ENTERPRISE_SITE_KEY = env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY || "";
export const APP_CHECK_PROVIDER = "ReCaptchaEnterpriseProvider";

// The debug token must be set on `self` BEFORE initializeAppCheck runs.
// Production builds never get a debug token (the deploy workflow doesn't pass one).
if (env.VITE_APPCHECK_DEBUG_TOKEN) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = env.VITE_APPCHECK_DEBUG_TOKEN;
} else if (env.DEV) {
  // Prints a fresh debug token to the console; register it in Firebase Console > App Check.
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

const g = globalThis;
if (!g.__lightoutAppCheck && RECAPTCHA_ENTERPRISE_SITE_KEY) {
  g.__lightoutAppCheck = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_ENTERPRISE_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
}
export const appCheck = g.__lightoutAppCheck || null;
export const appCheckDebugMode = Boolean(self.FIREBASE_APPCHECK_DEBUG_TOKEN);

if (!appCheck) {
  console.warn(
    "[Lightout] VITE_RECAPTCHA_ENTERPRISE_SITE_KEY is not set in this build: App Check is OFF, so cloud requests will be rejected. On-device AI still works."
  );
}

// 3. Services, all on the same app (and therefore the same App Check instance).
// ALL AI calls (on-device and cloud) go through Firebase AI Logic.
export const ai = getAI(app, { backend: new GoogleAIBackend() });
export const auth = getAuth(app);
export const db = getFirestore(app);
export const remoteConfig = getRemoteConfig(app);
