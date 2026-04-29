export interface WordTime {
  w: string;
  s: number;       // start seconds (within chunk)
  e: number;       // end seconds
  cs: number;      // char start in chunk text
  ce: number;      // char end in chunk text
  unstable?: boolean;
}

export interface ChunkOut {
  id: string;
  book_id: string;
  section_id: string;
  idx: number;
  section_idx: number;
  text: string;
  audio_url: string;
  duration_ms: number;
  words: WordTime[];
}

export interface ChunkIndexEntry {
  id: string;
  section_id: string;
  idx: number;
  section_idx: number;
  duration_ms: number;
  char_count: number;
}

export interface SectionOut {
  id: string;
  idx: number;
  title: string;
  duration_ms: number;
  start_chunk_id: string | null;
}

export interface BookSummary {
  id: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  voice: string;
  total_duration_ms: number;
  total_chars: number;
  status: "processing" | "ready" | "failed";
  created_at: string;
}

export interface BookDetail extends BookSummary {
  sections: SectionOut[];
  chunks: ChunkIndexEntry[];
  error?: string | null;
}

export interface ProgressDTO {
  book_id: string;
  chunk_id: string;
  offset_ms: number;
  word_idx: number;
  updated_at: string;
}

export interface JobStatus {
  id: string;
  book_id: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  current_step: string;
  message?: string | null;
}

export interface ManifestEntry {
  chunk_id: string;
  audio_url: string;
  duration_ms: number;
}

export interface BookManifest {
  book_id: string;
  voice: string;
  total_duration_ms: number;
  chunks: ManifestEntry[];
}
