import { Library } from "@/components/Library";
import { PdfUploader } from "@/components/PdfUploader";

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col safe-top">
      <header className="px-5 sm:px-8 pt-6 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Audiobook Reader</h1>
            <p className="text-xs text-muted">Your PDFs, narrated.</p>
          </div>
        </div>
      </header>

      <section className="flex-1 px-4 sm:px-8 pb-12 max-w-5xl w-full mx-auto pt-2 space-y-10">
        <div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-2 mb-1">
            Add a book
          </h2>
          <p className="text-sm text-muted mb-5">
            Drop in any text-based PDF. We&rsquo;ll detect chapters and split sentences,
            then read it aloud in a natural voice.
          </p>
          <PdfUploader />
        </div>

        <Library />
      </section>
    </main>
  );
}

function Logo() {
  return (
    <div className="h-9 w-9 rounded-full grid place-items-center bg-accent text-black shadow-card">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 12a9 9 0 0 1 18 0v6" />
        <rect x="3" y="13" width="5" height="7" rx="1.5" />
        <rect x="16" y="13" width="5" height="7" rx="1.5" />
      </svg>
    </div>
  );
}
