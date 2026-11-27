# ⚡ Lightout

**Prep with light. Study in the dark.**
Lightout turns a student's lecture notes, PDFs and photos into **Study Packs** while they have power and data, then lets them read, quiz themselves, get answers marked and ask questions **on their own laptop** when the power and data are gone.

Built for the **Firebase AI Logic hybrid inference hackathon**. Every AI call, cloud or on-device, goes through one Firebase AI Logic SDK: Gemini in the cloud for the heavy one-time work, Gemini Nano in Chrome for the frequent, private, offline studying.

---

## The problem

In Lagos (and much of Nigeria), "NEPA has taken light" is a daily sentence. Students study through:

- **Power cuts** that kill the Wi-Fi router mid-revision.
- **Expensive, patchy mobile data**: every AI request costs money, and it fails when the network drops.
- **Exam pressure** that doesn't pause for outages.

Most AI study tools are cloud-only, so they're useless at exactly the moment a student is revising by torchlight on a laptop battery.

## The Study Packs flow

```
 WITH LIGHT + DATA (cloud)                     IN THE DARK (on-device)
 ─────────────────────────                     ───────────────────────
 1. Upload notes, PDFs, DOCX, photos     ┐
 2. Gemini builds a Study Pack (JSON)    ├──►  4. Read sections, key terms, worked examples   (no AI)
    5–10 sections + 30+ questions        │     5. Adaptive quiz from the question bank          (no AI)
 3. Saved to IndexedDB, synced to        ┘     6. Short answers marked by Gemini Nano           (on-device)
    Firestore                                  7. "Ask about this pack", grounded in the pack   (on-device)
                                               8. Share the pack as a file, no data needed       (no AI)
```

1. **New pack:** add a title and course code (e.g. *ECO 201: Elasticity*), then paste text and/or add files: **PDF, DOCX, TXT, JPEG, PNG**, and phone photos (**HEIC/WebP**). DOCX text is extracted in the browser with `mammoth`. Photos are re-encoded to JPEG via canvas (max 1600 px, quality 0.8). A pack is capped at 15 MB with a friendly message.
2. **Build pack (cloud):** one `ONLY_IN_CLOUD` call with a JSON `responseSchema` returns `{ title, courseCode, summary, sections[{ id, title, explanation, keyTerms, workedExample }], questions[{ id, sectionId, type: "mcq" | "short", question, options, answerIndex, modelAnswer, explanation }] }`. It asks for simple language and Nigerian examples. The button is disabled offline: *"Building a pack needs internet. Do it while you have light and data."*
3. **Store & sync:** packs are saved in **IndexedDB** (Dexie), which is the source of truth offline. The app signs in with **anonymous Auth** silently and syncs pack JSON (never the uploaded files) to **Firestore** at `users/{uid}/packs/{packId}`, merging by `updatedAt` on load and on reconnect.
4. **Blackout Study Mode:**
   - **Read:** sections, key terms and worked examples. No AI needed.
   - **Quiz:** rounds of 10 drawn from the stored bank. Questions you got wrong come first, then unseen ones, then the oldest correct ones; per-question stats live in IndexedDB. MCQs need no AI.
   - **Short-answer marking:** sends the question, model answer and your answer to the model, which returns `{ score: 0–10, verdict: "correct" | "partly" | "wrong", feedback }`. This runs **on-device**. If AI isn't available, you can compare with the model answer and self-mark.
   - **Ask about this pack:** picks the 2–3 most relevant sections by keyword overlap, caps the context at ~12,000 characters (Nano's limit is 9,216 tokens for prompt + answer), and streams an answer grounded only in that context. If the pack doesn't cover it, it says so.
5. **Savings counter:** every on-device call adds its request + response bytes to a running total in IndexedDB, alongside questions answered offline and on-device calls. The Packs screen shows *"Saved X MB of data (≈ ₦Y)"*, using `naira_per_mb` from **Remote Config**.
6. **Share offline:** export a pack as `*.lightout.json` and import it on another device. The shape is validated before saving, so classmates can pass packs over Bluetooth or a flash drive with no data.

### Why each step runs where it does

| Step | Runs | Why |
|---|---|---|
| Build pack | ☁️ Cloud (`ONLY_IN_CLOUD`) | Heavy and one-time: many pages of input, PDFs (which on-device can't read), a long structured output with 30+ questions. Worth one data hit while there's light. |
| Read, MCQ quiz, sharing | 📦 Local (no AI) | The pack already holds the explanations, answers and explanations. Zero data and zero battery spent on inference. |
| Mark short answers | 🔒 On-device (`ONLY_ON_DEVICE` offline, `PREFER_ON_DEVICE` online) | Frequent and personal: dozens of small calls per study session. Free, private, works in a blackout. |
| Ask about this pack | 🔒 On-device first | Same reasons; the retrieved context is capped to fit Nano's window. |
| Quick tools on long notes (>20k chars) | ☁️ Cloud | Too long for Nano's context window. |

### Why on-device?
- **Privacy:** answers and questions never leave the laptop.
- **Free:** no data bundle burnt, no API cost. The savings card shows how much.
- **Offline:** works during outages, which is the whole point.

### Why cloud?
- **Heavy, one-time work:** building packs from PDFs and photos.
- **Long notes:** beyond Nano's context window.
- **Unsupported browsers/devices:** phones, Safari, Firefox and low-spec laptops still get every feature while online.

## Firebase services used

| Service | Used for |
|---|---|
| **Firebase AI Logic** (Gemini Developer API backend) | Every AI call: hybrid on-device/cloud inference, structured JSON output, streaming |
| **App Check** (reCAPTCHA v3) | Protects AI Logic (and the other services) from abuse; required by the rules |
| **Authentication** (Anonymous) | A silent per-device uid so packs can sync without a sign-up form |
| **Cloud Firestore** | Synced copy of each pack's JSON at `users/{uid}/packs/{packId}` |
| **Remote Config** | `cloud_model_name`, `naira_per_mb`, `pack_question_count`, with in-app defaults and cached values offline |
| **Hosting** | Serves the PWA; auto-deployed from GitHub Actions |

## Quick tools

The original one-off tools are still there under **Quick tools**: **Summarize**, **Explain simply**, **Flashcards** and **Quiz me** on any pasted notes or photo.

- **Try with sample notes:** one tap loads ECO 101 lecture notes (`src/sampleNotes.js`).
- **Streaming:** Summarize and Explain simply stream with `generateContentStream`; Flashcards and Quiz use `generateContent` with a JSON schema.
- **Visible hybrid stats:** every result has a timed badge, **🔒 On device · 1.2s** or **☁️ Cloud · 2.8s**, read from `inferenceSource` (falling back to what the routing mode guarantees), plus a running "X on-device · Y cloud" counter with a reset link.

## Features shared across the app

- **Offline banner:** "⚡ No light, no data? Lightout is still working." while offline; "Back online — cloud available again" for 3 seconds on reconnect.
- **How it works strip** under the header. On browsers without the on-device model, a note explains that offline mode needs Chrome desktop v139+ and that the cloud still works.
- **Privacy line** under every on-device result: "🔒 Your notes never left this device."
- **PWA:** the app shell, fonts and sample pack are precached, so the app opens with no network.

## How hybrid routing works

The SDK's `PREFER_ON_DEVICE` mode does **not** fall back to the cloud when a prompt is too long for Gemini Nano (about 9,216 tokens), and `countTokens()` isn't available in hybrid mode. So the app does its own routing, using character count as a safe proxy:

| Prompt length | Network | Mode | Why |
|---|---|---|---|
| ≤ 20,000 chars | Online | `PREFER_ON_DEVICE` | Free and private when Nano is ready, cloud otherwise |
| ≤ 20,000 chars | Offline | `ONLY_ON_DEVICE` | The cloud is unreachable anyway |
| > 20,000 chars | Online | `ONLY_IN_CLOUD` | Too long for Nano's context window |
| > 20,000 chars | Offline | *(blocked)* | Shows "too long offline, try a smaller chunk" |

Pack building always uses `ONLY_IN_CLOUD`. When offline, the app checks `LanguageModel.availability()` **before** calling the SDK; otherwise `ONLY_ON_DEVICE` would try to download the model with no connection. Model instances are cached per task, mode and cloud model name (`src/ai.js`).

## Design: "lights out"

The interface shows the grid's state. While online it's lit in volt-lime with a warm glow. When the network drops, it switches to **generator mode**: the glow dims, the accent turns amber and the flickering word in the headline goes dark.

- **Type:** Bricolage Grotesque, Instrument Sans and JetBrains Mono, self-hosted and precached (Latin subsets only, about 150 KB).
- **Colour:** an `oklch()` palette on a warm near-black, with four WCAG-AA text levels.
- **Motion:** masked headline reveal, staggered tiles, scroll-driven reveals, and full `prefers-reduced-motion` support.
- **Mobile:** Quick tools dock to the bottom of the screen; hover effects only apply on devices with a real pointer.

## Project structure

```
src/
  firebase.js            initializeApp, App Check, AI Logic, Auth, Firestore, Remote Config
  ai.js                  task schemas (incl. pack + marking), model cache, routing, runPrompt (stream/JSON), savings bytes
  App.jsx                shell: banner, status, navigation (#/packs, #/new, #/tools, #/pack/:id), sync on load
  lib/
    config.js            Remote Config defaults + fetchAndActivate
    db.js                Dexie: packs, per-question stats, meta
    sync.js              anonymous sign-in + Firestore two-way merge
    ingest.js            PDF/DOCX/TXT/photo -> AI Logic parts, 15 MB limit
    packs.js             build (cloud), validatePack, export/import
    study.js             adaptive quiz order, marking prompt, ask retrieval (12k-char cap)
    savings.js           on-device data savings totals
  screens/               PackLibrary, NewPack, PackView (Read), PackStudy (Quiz, Ask), QuickTools
  samplePack.json        bundled ECO 201 Elasticity pack (5 sections, 31 questions)
firestore.rules          users can only read/write users/{uid}/**
```

## Setup

### 1. Firebase console
1. Create a Firebase project and add a **Web app**. Copy its config into `.env.local` (below).
2. **AI Logic:** Firebase Console → *AI Logic* → *Get started* → choose the **Gemini Developer API**.
3. **App Check:** create a **reCAPTCHA v3** site key at the reCAPTCHA admin console (add `localhost` and `<project>.web.app` as domains). Register the web app under *App Check* with it, then **Enforce** App Check for **Firebase AI Logic** and **Cloud Firestore** once your debug token is registered (step 3 below).
4. **Authentication:** *Build → Authentication → Sign-in method* → enable **Anonymous**.
5. **Firestore:** *Build → Firestore Database* → *Create database* (production mode, a region near your users, e.g. `europe-west1`). Deploy the rules:
   ```bash
   firebase deploy --only firestore:rules --project <your-project-id>
   ```
6. **Remote Config:** *Run → Remote Config* → add these parameters and **Publish** (the app has the same defaults built in, so this is optional but lets you change them without a redeploy):

   | Key | Type | Default |
   |---|---|---|
   | `cloud_model_name` | String | `gemini-3.8-flash` |
   | `naira_per_mb` | Number | `1` (≈ ₦1,000 per GB) |
   | `pack_question_count` | Number | `30` |

7. **Hosting:** the included `firebase.json` serves `dist/` with an SPA rewrite and no-cache on `/sw.js`.

### 2. Environment variables
```bash
cp .env.example .env.local
```
Fill in the `VITE_FIREBASE_*` values and `VITE_RECAPTCHA_SITE_KEY`. `.env.local` is git-ignored; never commit it.

### 3. App Check debug token (local dev)
`localhost` can't pass reCAPTCHA, so:
1. Run `npm run dev` and open the browser console. With no `VITE_APPCHECK_DEBUG_TOKEN` set, dev mode prints `App Check debug token: xxxx`.
2. Firebase Console → App Check → *Apps* → ⋮ → **Manage debug tokens** → add that token.
3. Optionally put it in `.env.local` as `VITE_APPCHECK_DEBUG_TOKEN` so it stays the same between runs.

### 4. Enable on-device AI in Chrome
1. Use **Chrome desktop 139 or newer** on a machine that meets [Gemini Nano's requirements](https://developer.chrome.com/docs/ai/prompt-api) (about 22 GB free disk, a GPU with more than 4 GB VRAM or a capable CPU).
2. Open `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` → **Enabled** (needed for photo input).
3. If needed, also enable `chrome://flags/#optimization-guide-on-device-model`.
4. Relaunch Chrome.

### 5. Run
```bash
npm install
npm run dev
```
Click **Download the offline brain** once (it must be a user click; the download is a few GB, so use Wi-Fi).

### 6. Deploy
Manual:
```bash
npm run build
firebase deploy --only hosting,firestore:rules --project <your-project-id>
```
Automatic: every push to `main` runs `.github/workflows/deploy.yml` (Hosting only; deploy Firestore rules with the command above). It uses these **GitHub repository secrets**:

| Secret | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Service-account JSON (`firebase init hosting:github` creates it) |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` | Web app config (`VITE_FIREBASE_PROJECT_ID` is also the deploy target) |
| `VITE_RECAPTCHA_SITE_KEY` | reCAPTCHA v3 site key |
| `VITE_CLOUD_MODEL` *(optional)* | Build-time fallback for the cloud model; Remote Config's `cloud_model_name` takes precedence |

`VITE_APPCHECK_DEBUG_TOKEN` may exist as a secret but is **intentionally not passed to the production build**. A debug token baked into the public bundle would let anyone bypass App Check.

## How to test (for judges)

**Blackout Study Mode in 60 seconds (no upload needed):**
1. Open the deployed app in **Chrome desktop 139+** with the flag above enabled, click **Download the offline brain** and wait for **Ready**.
2. On **Packs**, tap **✦ Try a sample pack**. The ECO 201 Elasticity pack opens.
3. **Simulate a NEPA outage:** DevTools → *Network* → **Offline**, or turn off Wi-Fi. The amber banner appears and the UI dims to generator mode.
4. **Read** works instantly. Open **Quiz**: answer MCQs, then a short-answer question → **Mark my answer**. You get a score, a verdict and feedback with **🔒 On device · 1.2s** and "Your notes never left this device."
5. Finish the round and start the next one: the questions you missed come first ("Missed last time").
6. Open **Ask** and type *"Why do governments tax fuel?"*. The answer streams on-device from the "Elasticity and total revenue" section.
7. Back on **Packs**, the savings card shows MB saved, ≈ naira, and questions answered offline.
8. **Export to share**, then on another browser profile use **Import pack** with the file, still offline.

**Build your own pack (needs data):**
1. Go back online ("Back online — cloud available again"). Open **New pack**, add a title and course code, and add a PDF, a DOCX and a photo of handwritten notes.
2. Tap **Build pack**. It runs in the cloud with staged progress, then opens the new pack, saved locally and synced to Firestore.
3. Go offline and repeat steps 4–6 above on your own pack.

**Quick tools:** tap **Try with sample notes**, then **Summarize** (it streams on-device), then **Flashcards** and **Quiz me**. Paste more than 20,000 characters while offline to see the "too long offline" message; online, the same notes route to **☁️ Cloud**.

## Limitations

- On-device Gemini Nano supports **single-turn text + image** only: no chat history, audio, PDFs or tool calling. That's why pack building is cloud-only and every on-device feature is a single-turn prompt.
- **HEIC** photos are converted with the browser's own decoder (canvas). Safari can decode them; Chrome on Windows and Android usually can't, and Lightout then asks for a JPEG ("Most Compatible" camera setting).
- PDFs and photos are sent inline (base64), and a pack is capped at 15 MB of material.
- Packs larger than ~1 MB of JSON stay on the device and aren't synced (Firestore's document limit).
- The data-savings figure is an estimate: the bytes of the prompt and response that would have gone over the network, excluding HTTP overhead.

## License

[MIT](LICENSE) © 2026 Ilesanmi Crown
