import Dexie, { type Table } from "dexie";

export interface LocalProgress {
  bookId: string;
  chunkId: string;
  offsetMs: number;
  wordIdx: number;
  updatedAt: number;
}

export interface LocalSettings {
  key: "settings";
  defaultVoice: string;
  defaultRate: number;
  followMode: boolean;
  theme: "system" | "light" | "dark";
}

class ABRDB extends Dexie {
  progress!: Table<LocalProgress, string>;
  settings!: Table<LocalSettings, string>;

  constructor() {
    super("audiobookreader");
    this.version(1).stores({
      progress: "bookId",
      settings: "key"
    });
  }
}

export const db = new ABRDB();

export async function loadSettings(): Promise<LocalSettings> {
  const existing = await db.settings.get("settings");
  if (existing) return existing;
  const def: LocalSettings = {
    key: "settings",
    defaultVoice: "af_bella",
    defaultRate: 1.0,
    followMode: true,
    theme: "system"
  };
  await db.settings.put(def);
  return def;
}

export async function saveSettings(patch: Partial<LocalSettings>): Promise<void> {
  const cur = await loadSettings();
  await db.settings.put({ ...cur, ...patch, key: "settings" });
}
