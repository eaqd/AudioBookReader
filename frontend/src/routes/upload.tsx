import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { api } from "../lib/api";
import { loadSettings } from "../lib/db";

export function UploadPage(): JSX.Element {
  const [voice, setVoice] = useState("af_bella");
  const [voices, setVoices] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; step: string; message?: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    void api.listVoices().then(setVoices).catch(() => {});
    void loadSettings().then((s) => setVoice(s.defaultVoice));
  }, []);

  async function start() {
    if (!file) {
      setError("Pick a PDF first.");
      return;
    }
    setError(null);
    setBusy(true);
    setProgress({ pct: 0, step: "uploading" });
    try {
      const { promise } = api.uploadBook(file, voice);
      const { book_id, job_id } = await promise;
      cancelRef.current = api.watchJob(
        job_id,
        (j) =>
          setProgress({
            pct: j.progress,
            step: j.current_step,
            message: j.message
          }),
        () => navigate({ to: "/book/$bookId", params: { bookId: book_id } }),
        (msg) => {
          setError(msg);
          setBusy(false);
        }
      );
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  useEffect(() => () => cancelRef.current?.(), []);

  return (
    <div className="flex flex-col h-screen">
      <header className="px-5 pt-6 pb-3 safe-top flex items-center justify-between">
        <Link to="/" className="text-sm opacity-70">
          ← Library
        </Link>
        <h1 className="text-lg font-semibold">Upload PDF</h1>
        <span className="w-12" />
      </header>

      <main className="flex-1 px-5 max-w-xl mx-auto w-full">
        <label className="block text-sm font-medium mb-1">PDF file</label>
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm mb-5"
          disabled={busy}
        />

        <label className="block text-sm font-medium mb-1">Voice</label>
        <select
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
          className="block w-full text-sm rounded-md border border-current/20 bg-transparent px-3 py-2 mb-6"
          disabled={busy}
        >
          {voices.length === 0 ? (
            <option value={voice}>{voice}</option>
          ) : (
            voices.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))
          )}
        </select>

        <button
          onClick={start}
          disabled={busy || !file}
          className="px-4 py-2 rounded-full bg-indigo-600 text-white disabled:opacity-50"
        >
          {busy ? "Processing…" : "Start"}
        </button>

        {progress && (
          <div className="mt-6">
            <div className="text-xs opacity-70 mb-1">
              {progress.step}
              {progress.message ? ` — ${progress.message}` : ""}
            </div>
            <div className="h-2 bg-current/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-600 transition-all"
                style={{ width: `${progress.pct}%` }}
              />
            </div>
            <p className="text-xs mt-1 opacity-60">{progress.pct}%</p>
          </div>
        )}

        {error && (
          <p className="mt-4 text-sm text-red-500 whitespace-pre-wrap">{error}</p>
        )}
      </main>
    </div>
  );
}
