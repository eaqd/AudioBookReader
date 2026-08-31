# PDF Audiobook Reader

Fully client-side PWA: upload a PDF, get a Spotify-style audiobook with
synchronized text, tap-to-seek, and resumable progress. Deploys to Vercel
free tier and installs on iPhone via Add to Home Screen.

**No backend. No paid APIs. No model downloads.**

## Stack

| Layer       | Choice                                              |
| ----------- | --------------------------------------------------- |
| Framework   | Next.js 14 App Router + TypeScript                  |
| Styling     | Tailwind CSS                                        |
| PDF parsing | `pdfjs-dist` (worker served from `public/`)         |
| Speech      | **Web Speech API** — the device's own voices        |
| Storage     | IndexedDB via `idb`                                 |
| PWA         | `@serwist/next` service worker                      |

## Why the device voice, not Kokoro

The first implementation ran Kokoro-82M in-browser via ONNX. It worked,
but was far too slow to be usable. Measured in desktop Chrome (WASM):

```
3.73 s of audio generated in 17.2 s  →  4.6x slower than realtime
```

Playback can never keep up with generation at that rate, and a phone is
several times slower again — which is why the reader used to sit on
"generating…" indefinitely. It was never a crash; the synthesizer was
working, just impossibly slowly.

The device's built-in voices speak instantly, cost nothing, need no
80 MB download, and modern iOS/Android neural voices sound good.

**Known tradeoff:** Web Speech is bound to the page, so audio stops when
an iOS screen locks. Lock-screen playback is not achievable with this
API. If background listening becomes a requirement, it needs
pre-rendered audio files (and therefore a server).

## Run locally

```bash
npm install          # postinstall copies the pdf.js worker + builds icons
npm run dev          # http://localhost:3000
npm run typecheck
npm run build
```

## Tests

```bash
npx tsx tests/word-integrity.mts    # PDF text-extraction regression suite
node tests/make-test-pdf.mjs out.pdf # generate a fixture PDF
```

`word-integrity.mts` guards the text pipeline against the ways PDF text
extraction breaks words apart. It covers:

- hyphenated words rejoining across a line wrap
- sentences surviving a font-size shift mid-sentence (bold / italic runs)
- adjacent style runs keeping their word spacing
- the sentence-length cap only ever cutting at whitespace
- no spurious period inserted mid-title

## Text pipeline notes

`lib/pdf/` turns a PDF into chapters of sentences. Three subtleties that
previously produced visibly broken words:

1. **pdf.js emits a new text run at every style change**, and the space
   between two words is often a coordinate jump rather than a space
   glyph. `joinRuns` restores those spaces using each run's advance
   width.
2. **A single bold word must not redefine a line's font size.**
   `dominantFontSize` weights by character count so one emphasised word
   cannot make the next normal line look like a new paragraph.
3. **Book text hyphenates at the right margin.** `joinWrappedLines`
   rejoins `hyphen-` + `ated` into `hyphenated` instead of gluing them
   with a space.

Chapter detection is three-tier: PDF outline (>= 3 entries), else a
heading heuristic on font size, else a 3000-word split.

## Layout

```
app/            routes, PWA manifest, service worker
components/     Library, Reader, TextPane, PlayerBar, SectionNav
lib/pdf/        extract -> sectioning -> sentences
lib/tts/        speech.ts  (Web Speech wrapper: voices, speak, prime)
lib/player/     engine.ts  (sentence sequencing, position estimation)
lib/storage/    idb schema, books, progress
tests/          extraction regression suite + PDF fixture generator
```
