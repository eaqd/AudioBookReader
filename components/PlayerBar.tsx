"use client";

import { useState } from "react";
import { fmtTime } from "@/lib/util/format";

export interface PlayerBarProps {
  playing: boolean;
  rate: number;
  positionSec: number;
  durationSec: number;
  chapterTitle: string;
  /** Computed: position in current chapter (sec), and chapter total (sec). */
  chapterPositionSec: number;
  chapterDurationSec: number;
  onPlayPause: () => void;
  onBack15: () => void;
  onFwd15: () => void;
  onPrevSentence: () => void;
  onNextSentence: () => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  onSeekWithinSentence: (sec: number) => void;
  onChangeRate: (rate: number) => void;
  onOpenToc: () => void;
  onSleep: (minutes: number, endOfChapter: boolean) => void;
  sleepRemainingMs: number | null;
  generating: boolean;
  synthProgress: { piece: number; total: number } | null;
  lastError: string | null;
  onClearError: () => void;
  voices: { id: string; name: string; lang: string }[];
  voiceId: string | null;
  onChangeVoice: (id: string) => void;
}

const RATES = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

export function PlayerBar(p: PlayerBarProps) {
  return (
    <div className="border-t border-line bg-surface/95 backdrop-blur safe-bottom">
      <div className="px-4 sm:px-6 pt-3 pb-3 max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-[11px] uppercase tracking-[0.18em] text-subtle">
            Now playing
          </span>
          <span className="text-xs text-muted truncate flex-1">{p.chapterTitle}</span>
          {p.generating && (
            <span className="ml-auto text-[10px] text-accent animate-pulse tabular-nums">
              generating
              {p.synthProgress
                ? ` ${p.synthProgress.piece}/${p.synthProgress.total}`
                : "…"}
            </span>
          )}
        </div>
        {p.lastError && (
          <div className="mb-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200 flex items-center gap-2">
            <span className="flex-1">{p.lastError}</span>
            <button onClick={p.onClearError} className="text-red-100 underline">
              dismiss
            </button>
          </div>
        )}

        <Scrubber
          positionSec={p.positionSec}
          durationSec={p.durationSec}
          chapterPositionSec={p.chapterPositionSec}
          chapterDurationSec={p.chapterDurationSec}
          onSeek={p.onSeekWithinSentence}
        />

        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-2">
            <RateButton rate={p.rate} onChange={p.onChangeRate} />
            <VoiceButton voices={p.voices} voiceId={p.voiceId} onChange={p.onChangeVoice} />
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <Btn label="Previous chapter" onClick={p.onPrevChapter}><IconChapPrev /></Btn>
            <Btn label="Previous sentence" onClick={p.onPrevSentence} mute><IconStepBack /></Btn>
            <Btn label="Back 15s" onClick={p.onBack15}><Tag>15</Tag><IconBack15 /></Btn>
            <button
              aria-label={p.playing ? "Pause" : "Play"}
              onClick={p.onPlayPause}
              className="h-12 w-12 rounded-full grid place-items-center bg-text text-black hover:scale-105 transition"
            >
              {p.playing ? <IconPause /> : <IconPlay />}
            </button>
            <Btn label="Forward 15s" onClick={p.onFwd15}><IconFwd15 /><Tag>15</Tag></Btn>
            <Btn label="Next sentence" onClick={p.onNextSentence} mute><IconStepFwd /></Btn>
            <Btn label="Next chapter" onClick={p.onNextChapter}><IconChapNext /></Btn>
          </div>
          <div className="flex items-center gap-2">
            <SleepBtn onSelect={p.onSleep} remaining={p.sleepRemainingMs} />
            <Btn label="Chapters" onClick={p.onOpenToc}><IconToc /></Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- bits ---------- */

function Scrubber(props: {
  positionSec: number;
  durationSec: number;
  chapterPositionSec: number;
  chapterDurationSec: number;
  onSeek: (sec: number) => void;
}) {
  const dur = Math.max(1, props.durationSec || 0);
  const pos = Math.min(props.positionSec, dur);
  return (
    <div>
      <input
        type="range"
        className="scrubber w-full"
        min={0}
        max={Math.round(dur * 1000)}
        value={Math.round(pos * 1000)}
        onChange={(e) => props.onSeek(parseInt(e.target.value, 10) / 1000)}
        aria-label="Seek within sentence"
      />
      <div className="flex justify-between text-[10px] text-subtle mt-0.5 tabular-nums">
        <span>{fmtTime(props.chapterPositionSec)}</span>
        <span>-{fmtTime(Math.max(0, props.chapterDurationSec - props.chapterPositionSec))}</span>
      </div>
    </div>
  );
}

function Btn({
  children, onClick, label, mute = false
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  mute?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={
        "inline-flex items-center gap-1 px-2 py-1.5 rounded-md transition " +
        (mute ? "text-muted hover:text-text" : "text-text hover:text-accent")
      }
    >
      {children}
    </button>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] tabular-nums opacity-70">{children}</span>;
}

function RateButton({ rate, onChange }: { rate: number; onChange: (r: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-sm tabular-nums text-muted hover:text-text px-2 py-1 rounded-md hover:bg-cardHover"
      >
        {rate.toFixed(2)}x
      </button>
      {open && (
        <div className="absolute bottom-9 left-0 z-10 rounded-lg shadow-card bg-elev py-1 min-w-[88px]">
          {RATES.map((r) => (
            <button
              key={r}
              onClick={() => {
                onChange(r);
                setOpen(false);
              }}
              className={
                "block w-full text-left px-3 py-1.5 text-sm " +
                (r === rate ? "text-accent" : "text-text hover:text-accent")
              }
            >
              {r}x
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function VoiceButton({
  voices, voiceId, onChange
}: {
  voices: { id: string; name: string; lang: string }[];
  voiceId: string | null;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!voices.length) return null;
  const current = voices.find((v) => v.id === voiceId);
  const label = (current?.name ?? "Voice").replace(/^Microsoft |^Google /, "").split(" - ")[0];
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-muted hover:text-text px-2 py-1 rounded-md hover:bg-cardHover max-w-[7rem] truncate"
        aria-label="Voice"
        title={current?.name ?? "Choose a voice"}
      >
        {label}
      </button>
      {open && (
        <div className="absolute bottom-9 left-0 z-10 rounded-lg shadow-card bg-elev py-1 min-w-[200px] max-h-64 overflow-y-auto">
          {voices.map((v) => (
            <button
              key={v.id}
              onClick={() => {
                onChange(v.id);
                setOpen(false);
              }}
              className={
                "block w-full text-left px-3 py-1.5 text-sm truncate " +
                (v.id === voiceId ? "text-accent" : "text-text hover:text-accent")
              }
            >
              {v.name}
              <span className="ml-1 text-[10px] text-subtle">{v.lang}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SleepBtn(props: {
  onSelect: (m: number, endOfChapter: boolean) => void;
  remaining: number | null;
}) {
  const [open, setOpen] = useState(false);
  const label = props.remaining ? `${Math.ceil(props.remaining / 60000)}m` : null;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Sleep timer"
        className="text-xs text-muted hover:text-text px-2 py-1.5 rounded-md hover:bg-cardHover"
      >
        💤 {label ?? ""}
      </button>
      {open && (
        <div className="absolute bottom-9 right-0 z-10 rounded-lg shadow-card bg-elev py-1 min-w-[140px]">
          {[0, 5, 15, 30, 60].map((m) => (
            <button
              key={m}
              onClick={() => {
                props.onSelect(m, false);
                setOpen(false);
              }}
              className="block w-full text-left px-3 py-1.5 text-sm hover:text-accent"
            >
              {m === 0 ? "Off" : `${m} min`}
            </button>
          ))}
          <button
            onClick={() => {
              props.onSelect(0, true);
              setOpen(false);
            }}
            className="block w-full text-left px-3 py-1.5 text-sm hover:text-accent border-t border-line mt-1"
          >
            End of chapter
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- icons ---------- */

function IconPlay() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M8 5v14l11-7z" />
    </svg>
  );
}
function IconPause() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  );
}
function IconBack15() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 9" />
      <path d="M3 4v5h5" />
    </svg>
  );
}
function IconFwd15() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a9 9 0 1 1-3-6.7L21 9" />
      <path d="M21 4v5h-5" />
    </svg>
  );
}
function IconStepBack() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M6 6h2v12H6zM10 12l8-6v12z" />
    </svg>
  );
}
function IconStepFwd() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M16 6h2v12h-2zM6 6v12l8-6z" />
    </svg>
  );
}
function IconChapPrev() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M5 6h2v12H5zM10 12l8-6v12z" />
    </svg>
  );
}
function IconChapNext() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M17 6h2v12h-2zM6 6v12l8-6z" />
    </svg>
  );
}
function IconToc() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}
