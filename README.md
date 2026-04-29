# PDF Audiobook Reader

Fully client-side PWA: uploads a PDF, generates a Spotify-style audiobook with
synchronized text using browser-native TTS (Kokoro-82M via `kokoro-js`),
deployable to Vercel free tier and installable on iPhone via Add to Home Screen.

**No backend. No paid APIs. No server-side TTS.**

## Stack

| Layer        | Choice                                                         |
| ------------ | -------------------------------------------------------------- |
| Framework    | Next.js 14 App Router + TypeScript                             |
| Styling      | Tailwind CSS                                                   |
| PDF parsing  | `pdfjs-dist` (worker hosted from `public/`)                    |
| TTS          | `kokoro-js` (browser ONNX, WebGPU → WASM fallback) — Step 3    |
| Storage      | IndexedDB via `idb` — Step 4                                   |
| Audio        | `HTMLAudioElement` + Media Session API — Step 7                |
| PWA          | manifest + service worker — Step 9                             |

## Build phases (gated on user verification)

The full build is split into 9 incremental steps. Each step ends with a
verifiable demo and gets its own commit. Don't proceed past a step until
it works.

1. **Skeleton + PDF upload + text extraction** — *current step*. Drop a PDF,
   see structured chapter+sentence JSON in the browser console.
2. Sectioning + sentence splitting validated on three PDFs (TOC, no-TOC, scanned-error).
3. `kokoro-js` integration: load model with progress UI, generate one sentence, play via `<audio>`.
4. IndexedDB cache via `idb`: store/retrieve audio Blob URLs keyed `bookId:chapterId:sentenceIndex`.
5. Sentence-ahead buffer queue (3–5 ahead, `requestIdleCallback` with `setTimeout(0)` fallback).
6. Reader UI: two-pane, sentence highlighting, follow-mode autoscroll, tap-to-seek.
7. PlayerBar: ±15s, prev/next sentence, prev/next chapter, speed picker, sleep timer, MediaSession.
8. Library + progress: home screen with cover thumbnails, "Continue listening" card.
9. PWA polish: manifest, service worker (next-pwa) caching app shell + Kokoro ONNX, iOS meta. Deploy to Vercel.

## Run locally (Step 1)

```bash
npm install            # postinstall copies pdfjs worker into public/
npm run dev            # http://localhost:3000
```

Drop any PDF on the upload zone. Open DevTools → Console. You should see:

```
[PdfUploader] extracted book: { title, pageCount, chapters: [...] }
[PdfUploader] JSON: <pretty-printed full structure>
```

The page shows a summary card with chapter count, sentence count, detection
mode (`outline` | `heading` | `wordSplit`), and the first 12 chapter titles.

### Verify the three sectioning tiers

- **TOC tier** — drop a PDF that has bookmarks. Detection mode should be `outline`.
- **Heading tier** — drop a PDF without bookmarks but with visually large
  headings. Detection mode should be `heading`.
- **Scanned PDF** — drop a scanned/image-only PDF. The UI shows a friendly
  error: "This PDF appears to be scanned images. OCR is not supported in v1."

Type-check:

```bash
npx tsc --noEmit
```

## Layout

```
app/
  layout.tsx             PWA meta + iOS Add-to-Home-Screen tags
  page.tsx               Step 1 home — PDF uploader
  globals.css            Tailwind base
components/
  PdfUploader.tsx        Drag-and-drop + extract → sectioning → console.log
lib/
  pdf/
    extract.ts           pdfjs-dist text extraction with outline + scanned detect
    sentences.ts         Intl.Segmenter with regex + abbreviation-aware fallback
    sectioning.ts        Three-tier chapter detection
public/
  pdf.worker.min.mjs     Copied at postinstall by scripts/copy-pdf-worker.mjs
scripts/
  copy-pdf-worker.mjs    Postinstall hook
```

## Vercel deploy (later)

When Step 9 lands:

```bash
vercel --prod   # no env vars needed
```
