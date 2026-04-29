import type { SectionOut } from "../types";

interface Props {
  open: boolean;
  sections: SectionOut[];
  currentSectionId: string | null;
  onClose: () => void;
  onSelect: (s: SectionOut) => void;
}

export function TocDrawer({ open, sections, currentSectionId, onClose, onSelect }: Props): JSX.Element | null {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-30 flex">
      <div
        onClick={onClose}
        className="flex-1 bg-black/40"
        aria-hidden
      />
      <aside className="w-[80%] max-w-md bg-paper dark:bg-ink h-full overflow-y-auto safe-top safe-bottom">
        <div className="px-5 pt-6 pb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Contents</h2>
          <button onClick={onClose} className="text-sm opacity-70">
            Close
          </button>
        </div>
        <ul className="px-2 pb-4">
          {sections.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => onSelect(s)}
                className={
                  "w-full text-left px-3 py-3 rounded-md flex justify-between items-center " +
                  (s.id === currentSectionId ? "bg-current/10" : "hover:bg-current/5")
                }
              >
                <span className="text-sm line-clamp-2">{s.title}</span>
                <span className="text-xs opacity-50 tabular-nums">
                  {fmtMin(s.duration_ms)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function fmtMin(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}
