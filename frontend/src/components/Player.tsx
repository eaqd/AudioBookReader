import { useState, type ReactNode } from "react";

interface Props {
  playing: boolean;
  rate: number;
  positionSec: number;        // within current chunk
  durationSec: number;        // current chunk duration
  totalElapsedMs: number;
  totalDurationMs: number;
  onPlayPause: () => void;
  onBack15: () => void;
  onFwd15: () => void;
  onSeekChunk: (sec: number) => void;
  onChangeRate: (r: number) => void;
  onOpenToc: () => void;
  onSleepTimer: (minutes: number) => void;
  sleepRemainingMs: number | null;
}

const RATES = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

export function Player(props: Props): JSX.Element {
  const {
    playing, rate, positionSec, durationSec,
    totalElapsedMs, totalDurationMs,
    onPlayPause, onBack15, onFwd15, onSeekChunk, onChangeRate,
    onOpenToc, onSleepTimer, sleepRemainingMs
  } = props;

  return (
    <div className="border-t border-current/10 bg-paper dark:bg-ink/95 backdrop-blur safe-bottom px-4 pt-3 pb-3">
      <ScrubberRow
        positionSec={positionSec}
        durationSec={durationSec}
        totalElapsedMs={totalElapsedMs}
        totalDurationMs={totalDurationMs}
        onSeek={onSeekChunk}
      />
      <div className="flex items-center justify-between mt-2">
        <RateButton rate={rate} onChange={onChangeRate} />
        <div className="flex items-center gap-3">
          <IconBtn label="-15" onClick={onBack15}>⏪ 15</IconBtn>
          <button
            onClick={onPlayPause}
            className="w-12 h-12 rounded-full bg-indigo-600 text-white text-xl flex items-center justify-center"
          >
            {playing ? "❚❚" : "▶"}
          </button>
          <IconBtn label="+15" onClick={onFwd15}>15 ⏩</IconBtn>
        </div>
        <div className="flex items-center gap-2">
          <SleepBtn onSelect={onSleepTimer} remaining={sleepRemainingMs} />
          <IconBtn label="TOC" onClick={onOpenToc}>📑</IconBtn>
        </div>
      </div>
    </div>
  );
}

function ScrubberRow(props: {
  positionSec: number;
  durationSec: number;
  totalElapsedMs: number;
  totalDurationMs: number;
  onSeek: (sec: number) => void;
}): JSX.Element {
  return (
    <div>
      <input
        type="range"
        className="scrubber"
        min={0}
        max={Math.max(1, Math.round(props.durationSec * 100))}
        value={Math.min(Math.round(props.positionSec * 100), Math.round(props.durationSec * 100))}
        onChange={(e) => props.onSeek(parseInt(e.target.value, 10) / 100)}
      />
      <div className="flex justify-between text-[10px] opacity-60 mt-0.5 tabular-nums">
        <span>{fmt(props.totalElapsedMs)}</span>
        <span>{fmt(props.totalDurationMs)}</span>
      </div>
    </div>
  );
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function IconBtn({ children, onClick, label }: {
  children: ReactNode; onClick: () => void; label: string;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="text-sm px-2 py-1 rounded-md hover:bg-current/10"
    >
      {children}
    </button>
  );
}

function RateButton({ rate, onChange }: { rate: number; onChange: (r: number) => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="text-sm tabular-nums opacity-80 px-2 py-1 rounded-md hover:bg-current/10"
      >
        {rate.toFixed(2)}x
      </button>
      {open && (
        <div className="absolute bottom-9 left-0 z-10 rounded-lg shadow-lg bg-paper dark:bg-ink border border-current/10 py-1 min-w-[80px]">
          {RATES.map((r) => (
            <button
              key={r}
              onClick={() => {
                onChange(r);
                setOpen(false);
              }}
              className={`block w-full text-left px-3 py-1 text-sm ${rate === r ? "bg-current/10" : ""}`}
            >
              {r}x
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SleepBtn(props: { onSelect: (m: number) => void; remaining: number | null }): JSX.Element {
  const [open, setOpen] = useState(false);
  const remainingLabel = props.remaining
    ? `${Math.ceil(props.remaining / 60000)}m`
    : null;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs opacity-80 px-2 py-1 rounded-md hover:bg-current/10"
        aria-label="Sleep timer"
      >
        💤 {remainingLabel ?? ""}
      </button>
      {open && (
        <div className="absolute bottom-9 right-0 z-10 rounded-lg shadow-lg bg-paper dark:bg-ink border border-current/10 py-1 min-w-[100px]">
          {[0, 5, 15, 30, 60].map((m) => (
            <button
              key={m}
              onClick={() => {
                props.onSelect(m);
                setOpen(false);
              }}
              className="block w-full text-left px-3 py-1 text-sm"
            >
              {m === 0 ? "Off" : `${m} min`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

