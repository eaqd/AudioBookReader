import { audioId, getDB, type AudioChunkRow } from "./db";

export async function getAudio(
  bookId: string,
  chapterId: string,
  sentenceIdx: number
): Promise<AudioChunkRow | null> {
  const db = await getDB();
  return (await db.get("audio", audioId(bookId, chapterId, sentenceIdx))) ?? null;
}

export async function putAudio(row: AudioChunkRow): Promise<void> {
  const db = await getDB();
  await db.put("audio", row);
}

export async function countAudioForBook(bookId: string): Promise<number> {
  const db = await getDB();
  return await db.countFromIndex("audio", "bookId", IDBKeyRange.only(bookId));
}

export async function clearAudioForBook(bookId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("audio", "readwrite");
  let cursor = await tx.store.index("bookId").openCursor(IDBKeyRange.only(bookId));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}
