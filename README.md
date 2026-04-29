# PDF Audiobook Reader

Turn any PDF into a Spotify-style audiobook with synchronized text, click-to-seek,
persistent progress, and offline support on iPhone (PWA).

```
PDF ──► PyMuPDF ──► chunker ──► Kokoro TTS ──► WhisperX align ──► {audio, words[], offsets}
                                                                          │
                                                                          ▼
                                                          React PWA reader (synced)
```

## Stack

| Layer        | Choice                                        |
| ------------ | --------------------------------------------- |
| TTS          | Kokoro-82M (`kokoro` pip package)             |
| Alignment    | WhisperX (aeneas as fallback)                 |
| PDF          | PyMuPDF (fitz)                                |
| Backend      | FastAPI + uvicorn                             |
| Job queue    | Arq (Redis)                                   |
| Storage      | SQLite metadata + filesystem audio            |
| Frontend     | Vite + React 18 + TypeScript + TanStack Router|
| Local DB     | Dexie.js (IndexedDB)                          |
| Audio        | HTMLAudioElement (chunked MP3, sequential)    |
| PWA          | vite-plugin-pwa, Workbox runtime cache        |

## Layout

```
backend/   FastAPI app, ingest pipeline, Arq worker
frontend/  Vite React PWA
```

## Backend — quick start

```bash
# system: ffmpeg (with libmp3lame) is required for audio encoding.
# macOS:   brew install ffmpeg
# Debian:  sudo apt install -y ffmpeg

cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e .
# Optional ML stack — heavy. Install only when you want real TTS+align:
pip install -e ".[ml]"

# 1) Run Redis somewhere (localhost:6379 by default).
# 2) Run the API:
uvicorn app.main:app --reload --port 8000
# 3) Run the worker (separate terminal, only when ABR_USE_ARQ=true):
arq app.workers.arq_worker.WorkerSettings
```

If `kokoro` / `whisperx` are not installed, ingestion falls back to a synthetic
silent-audio + word-by-uniform-time stub so the rest of the app remains
exercisable end-to-end. Wire real models for production use.

## Frontend — quick start

```bash
cd frontend
npm install
npm run dev
# Build:
npm run build && npm run preview
```

Set `VITE_API_BASE` in `frontend/.env` to point at the backend (defaults to
`http://localhost:8000`).

## Install on iPhone

Open the deployed site in Safari → Share → **Add to Home Screen**. The app icon
appears, opens full-screen, no browser chrome. Lock-screen audio controls work
through the Media Session API. HTTPS is required for both PWA install and
Media Session.

## Endpoints

```
POST   /books/upload              multipart PDF, returns {book_id, job_id}
GET    /jobs/{job_id}/stream      SSE: {progress, status, current_step}
GET    /books                     list books
GET    /books/{id}                metadata + sections + chunk index
GET    /books/{id}/chunks/{cid}   chunk text + words[] + audio_url
GET    /books/{id}/manifest       full chunk list (offline download)
GET    /audio/{book_id}/{cid}.mp3 audio (Range supported)
PUT    /books/{id}/progress       save current position
GET    /books/{id}/progress       load saved position
DELETE /books/{id}                delete book + audio
```

## Decisions / deviations from spec

- **Synchronous fallback for ingest.** When Redis/Arq aren't running, the
  upload endpoint runs the ingest pipeline in a `BackgroundTasks` task. Arq is
  the recommended path for real workloads; the fallback exists so the scaffold
  is runnable on a laptop without infra.
- **Stub TTS+align when models absent.** `pipeline/tts.py` and
  `pipeline/alignment.py` detect missing imports and emit a silent MP3 + a
  uniform word-time table so the reader UI works for testing. Install
  `kokoro` and `whisperx` to use the real models.
- **No auth.** Single-user, as per spec section 8.

## Definition of done

See `BUILD.md` § 9 in the original spec — every box must check.
