import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { getAI, GoogleAIBackend } from "firebase/ai";

const env = import.meta.env;

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);

// App Check is enforced for Firebase AI Logic, so every cloud request needs a token.
// The debug token must be set on `self` BEFORE initializeAppCheck runs.
if (env.VITE_APPCHECK_DEBUG_TOKEN) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = env.VITE_APPCHECK_DEBUG_TOKEN;
} else if (env.DEV) {
  // Prints a fresh debug token to the console; register it in Firebase Console > App Check.
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

export let appCheck = null;
if (env.VITE_RECAPTCHA_SITE_KEY) {
  appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(env.VITE_RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
} else {
  console.warn(
    "[Lightout] VITE_RECAPTCHA_SITE_KEY is not set: App Check is off, so cloud requests will be rejected. On-device AI still works."
  );
}

// ALL AI calls (on-device and cloud) go through Firebase AI Logic.
export const ai = getAI(app, { backend: new GoogleAIBackend() });
