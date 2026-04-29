import { PdfUploader } from "@/components/PdfUploader";

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="px-6 pt-8 pb-2">
        <h1 className="text-2xl font-semibold">Audiobook Reader</h1>
        <p className="text-sm opacity-60">Step 1 — PDF text extraction.</p>
      </header>
      <section className="flex-1 flex items-start justify-center px-4 pt-8">
        <PdfUploader />
      </section>
    </main>
  );
}
