import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { api } from "../lib/api";
import { loadSettings, saveSettings, type LocalSettings } from "../lib/db";
import { estimateQuota } from "../lib/offline";

export function SettingsPage(): JSX.Element {
  const [settings, setSettings] = useState<LocalSettings | null>(null);
  const [voices, setVoices] = useState<string[]>([]);
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => {
    void loadSettings().then(setSettings);
    void api.listVoices().then(setVoices).catch(() => {});
    void estimateQuota().then(setQuota);
  }, []);

  function update<K extends keyof LocalSettings>(k: K, v: LocalSettings[K]) {
    if (!settings) return;
    const next = { ...settings, [k]: v };
    setSettings(next);
    void saveSettings({ [k]: v });
  }

  if (!settings) return <div className="p-6 opacity-70">Loading…</div>;

  return (
    <div className="flex flex-col h-screen">
      <header className="px-5 pt-6 pb-3 safe-top flex items-center justify-between">
        <Link to="/" className="text-sm opacity-70">
          ← Library
        </Link>
        <h1 className="text-lg font-semibold">Settings</h1>
        <span className="w-12" />
      </header>
      <main className="flex-1 px-5 max-w-xl mx-auto w-full space-y-6">
        <Field label="Default voice">
          <select
            className="rounded-md bg-transparent border border-current/20 px-3 py-2 text-sm"
            value={settings.defaultVoice}
            onChange={(e) => update("defaultVoice", e.target.value)}
          >
            {voices.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Default playback speed">
          <select
            className="rounded-md bg-transparent border border-current/20 px-3 py-2 text-sm"
            value={settings.defaultRate}
            onChange={(e) => update("defaultRate", parseFloat(e.target.value))}
          >
            {[0.75, 1.0, 1.25, 1.5, 1.75, 2.0].map((r) => (
              <option key={r} value={r}>
                {r}x
              </option>
            ))}
          </select>
        </Field>

        <Field label="Auto-scroll to current sentence">
          <input
            type="checkbox"
            checked={settings.followMode}
            onChange={(e) => update("followMode", e.target.checked)}
          />
        </Field>

        {quota && (
          <div className="text-sm opacity-70">
            Storage: {(quota.usage / 1e6).toFixed(1)} MB used /{" "}
            {(quota.quota / 1e6).toFixed(0)} MB quota
          </div>
        )}
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="flex items-center justify-between">
      <span className="text-sm">{label}</span>
      {children}
    </label>
  );
}
