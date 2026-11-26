# ⚡ NEPA-Proof Notes

**A study assistant that keeps working when the light and data don't.**
Built for the **Firebase AI Logic hybrid inference hackathon**. It runs Gemini Nano **on your device** in Chrome when it can, and falls back to Gemini **in the cloud** when it must, all through one Firebase AI Logic SDK.

---

## The problem

In Lagos (and much of Nigeria), "NEPA has taken light" is a daily sentence. Students study through:

- **Power cuts** that kill the Wi-Fi router mid-revision.
- **Expensive, patchy mobile data**: every AI request costs money, and it fails when the network drops.
- **Exam pressure** that doesn't pause for outages.

Most AI study tools are cloud-only, so they're useless at exactly the moment a student is revising by torchlight on a laptop battery. NEPA-Proof Notes keeps summaries, explanations, flashcards and quizzes working **with zero data** once the offline model is downloaded.

## What it does

| Feature | Output | On-device | Cloud |
|---|---|---|---|
| **Summarize** | Bullet-point summary | ✅ | ✅ |
| **Explain simply** | Plain-language explanation | ✅ | ✅ |
| **Flashcards** | Structured JSON, tap to flip | ✅ (`responseConstraint`) | ✅ (`responseSchema`) |
| **Quiz me** | 5 MCQs, click to answer, live score | ✅ (`responseConstraint`) | ✅ (`responseSchema`) |
| **Photo of notes** | JPEG/PNG sent as `inlineData` | ✅ | ✅ |

Every result carries a badge, **📱 Ran on your device** or **☁️ Ran in the cloud**, read from `result.response.inferenceSource`.
Status pills show **Online/Offline** (live `online`/`offline` events) and the **offline brain** status (`LanguageModel.availability()`).
Notes autosave to `localStorage`, and the app shell is a **PWA** that loads with no network.

## How hybrid routing works

The SDK's `PREFER_ON_DEVICE` mode does **not** fall back to the cloud when a prompt is too long for Gemini Nano (about 9,216 tokens), and `countTokens()` isn't available in hybrid mode. So the app does its own routing, using character count as a safe proxy (20,000 chars ≈ 5k tokens, leaving headroom for instructions, an image and the output):

| Notes length | Network | Mode | Why |
|---|---|---|---|
| ≤ 20,000 chars | Online | `PREFER_ON_DEVICE` | Free and private when Nano is ready, cloud otherwise |
| ≤ 20,000 chars | Offline | `ONLY_ON_DEVICE` | The cloud is unreachable anyway |
| > 20,000 chars | Online | `ONLY_IN_CLOUD` | Too long for Nano's context window |
| > 20,000 chars | Offline | *(blocked)* | Shows "too long offline, try a smaller chunk" |

When offline, the app also checks `LanguageModel.availability()` **before** calling the SDK. Otherwise `ONLY_ON_DEVICE` would try to download the model with no connection. If the model isn't ready, the student gets a clear "reconnect and download the offline brain" message instead of a hang.

Model instances are cached per *task + mode* (`src/ai.js`), so each mode/schema combination is created once.

### Why on-device?
- **Privacy**: notes never leave the laptop.
- **Free**: no data bundle burnt, no API cost.
- **Offline**: works during outages, which is the whole point.

### Why cloud?
- **Long notes**: full lecture transcripts beyond Nano's context window.
- **Unsupported browsers/devices**: phones, Safari, Firefox and low-spec laptops still get every feature.

## Tech stack

- **Vite + React** (JavaScript), plain CSS, mobile-first dark UI
- **firebase ^12.5.0**: `firebase/ai` (`getGenerativeModel`, `InferenceMode`, `Schema`, `inferenceSource`), with **App Check** (reCAPTCHA v3)
- **vite-plugin-pwa**: service worker + manifest for an offline app shell
- **Firebase Hosting**, auto-deployed by GitHub Actions

```
src/
  firebase.js        initializeApp, App Check, getAI(GoogleAIBackend)
  ai.js              schemas, task prompts, model cache, routing, availability, errors
  App.jsx            UI, status pills, onboarding/download, results
  components/        Flashcards, Quiz, PhotoPicker
```

## Setup

### 1. Firebase project
1. Create a Firebase project and add a **Web app**.
2. **AI Logic**: Firebase Console → AI Logic → *Get started* → choose the **Gemini Developer API**.
3. **App Check**: register the web app with **reCAPTCHA v3** (create a site key at the reCAPTCHA admin console), then **enforce** App Check for Firebase AI Logic.
4. **Hosting**: run `firebase init hosting` or just use the included `firebase.json`.

### 2. Environment variables
```bash
cp .env.example .env.local
```
Fill in the `VITE_FIREBASE_*` values from *Project settings → Your apps*, plus `VITE_RECAPTCHA_SITE_KEY`. `.env.local` is git-ignored; never commit it.

### 3. App Check debug token (local dev)
`localhost` can't pass reCAPTCHA, so:
1. Run `npm run dev` and open the browser console. With no `VITE_APPCHECK_DEBUG_TOKEN` set, dev mode prints `App Check debug token: xxxx`.
2. Firebase Console → App Check → *Apps* → ⋮ → **Manage debug tokens** → add that token.
3. Optionally put it in `.env.local` as `VITE_APPCHECK_DEBUG_TOKEN` so it stays the same between runs.

### 4. Enable on-device AI in Chrome
1. Use **Chrome desktop 139 or newer** (Windows, macOS or Linux) on a machine that meets [Gemini Nano's requirements](https://developer.chrome.com/docs/ai/prompt-api) (about 22 GB free disk, a GPU with more than 4 GB VRAM or a capable CPU).
2. Open `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` → **Enabled** (needed for photo input).
3. If needed, also enable `chrome://flags/#optimization-guide-on-device-model`.
4. Relaunch Chrome.

### 5. Run
```bash
npm install
npm run dev
```
Click **Download the offline brain** once (it must be a user click; the download is a few GB, so use Wi-Fi). The pill turns green when it's ready.

### 6. Deploy
Manual:
```bash
npm run build
firebase deploy --only hosting --project <your-project-id>
```
Automatic: every push to `main` runs `.github/workflows/deploy.yml`. Add these **GitHub repository secrets**:

| Secret | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Service-account JSON (`firebase init hosting:github` creates it) |
| `FIREBASE_PROJECT_ID` | Your project ID |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` | Web app config |
| `VITE_RECAPTCHA_SITE_KEY` | reCAPTCHA v3 site key |
| `VITE_CLOUD_MODEL` *(optional)* | Override the cloud model |

Add your Hosting domain (`<project>.web.app`) to the reCAPTCHA key's allowed domains.

## How to test offline (for judges)

1. Open the deployed app in **Chrome desktop 139+** with the flag above enabled.
2. Click **Download the offline brain** and wait for **Offline brain: ready**.
3. Paste some notes, click **Summarize**. The badge should read **📱 Ran on your device**.
4. **Simulate a NEPA outage**: DevTools → *Network* → **Offline**, or turn off Wi-Fi. The pill flips to **Offline**.
5. **Reload the page**. The PWA shell still loads, and your notes are still there (`localStorage`).
6. Try **Flashcards** and **Quiz me**. Both still work, and the badge stays **📱 Ran on your device**.
7. Paste more than 20,000 characters while offline. You get *"too long to process offline, try a smaller chunk"*.
8. Go back online with the long notes and click **Summarize**. It routes to **☁️ Ran in the cloud**.
9. Open the app in Firefox, Safari or a phone. You see the "Offline mode needs Chrome desktop v139+" note, and everything works via the cloud.

## Limitations (by design)

On-device Gemini Nano supports **single-turn text + image** only: no chat history, audio, PDFs or tool calling. That's why every feature here is a single-turn prompt.

## License

[MIT](LICENSE) © 2026 Ilesanmi Crown
