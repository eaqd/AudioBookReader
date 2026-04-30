"use client";

import { useState } from "react";
import { resetEverything } from "@/lib/util/reset";

export function ResetButton() {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (busy) {
    return (
      <span className="text-xs text-muted">resetting…</span>
    );
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-xs text-muted hover:text-text px-2 py-1 rounded-md hover:bg-cardHover"
        title="Wipe books, audio cache, model cache; reload"
      >
        Reset
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted hidden sm:inline">Wipe everything?</span>
      <button
        onClick={async () => {
          setBusy(true);
          try {
            await resetEverything();
          } finally {
            setBusy(false);
          }
        }}
        className="text-red-300 px-2 py-1 rounded-md bg-red-500/10 hover:bg-red-500/20"
      >
        Yes
      </button>
      <button
        onClick={() => setConfirming(false)}
        className="text-muted px-2 py-1 rounded-md hover:bg-cardHover"
      >
        Cancel
      </button>
    </div>
  );
}
