"""Forced alignment via WhisperX with a uniform-timing fallback.

Real path:
    1. Transcribe the synthesized audio with WhisperX to get word-level frames.
    2. Re-align using the *original* chunk text (forced alignment).
    3. Map each aligned word back to its char-range in the chunk text.

Fallback (no whisperx installed): distribute words uniformly across the
audio duration. The reader UI still works; quality suffers.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)

_WHISPERX_AVAILABLE: bool | None = None


@dataclass
class AlignedWord:
    w: str
    s: float
    e: float
    cs: int
    ce: int
    unstable: bool = False


def _have_whisperx() -> bool:
    global _WHISPERX_AVAILABLE
    if _WHISPERX_AVAILABLE is None:
        try:
            import whisperx  # noqa: F401
            _WHISPERX_AVAILABLE = True
        except Exception as e:  # noqa: BLE001
            log.info("whisperx not available, using uniform-timing alignment: %s", e)
            _WHISPERX_AVAILABLE = False
    return _WHISPERX_AVAILABLE


_WORD_RE = re.compile(r"\S+")


def _word_offsets(text: str) -> list[tuple[str, int, int]]:
    out: list[tuple[str, int, int]] = []
    for m in _WORD_RE.finditer(text):
        out.append((m.group(0), m.start(), m.end()))
    return out


def _normalize(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", s).lower()


def _uniform(text: str, duration_ms: int) -> list[AlignedWord]:
    words = _word_offsets(text)
    if not words:
        return []
    duration_s = max(0.001, duration_ms / 1000.0)
    per = duration_s / len(words)
    return [
        AlignedWord(w=w, s=i * per, e=(i + 1) * per, cs=cs, ce=ce, unstable=True)
        for i, (w, cs, ce) in enumerate(words)
    ]


def _whisperx_align(audio_path: Path, text: str, duration_ms: int) -> list[AlignedWord]:
    import whisperx  # type: ignore[import-not-found]
    import torch  # type: ignore[import-not-found]

    device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = "float16" if device == "cuda" else "int8"
    model = whisperx.load_model("tiny.en", device, compute_type=compute_type)
    audio = whisperx.load_audio(str(audio_path))
    transcription = model.transcribe(audio, batch_size=8, language="en")
    align_model, metadata = whisperx.load_align_model(language_code="en", device=device)
    # Replace the transcription text with our reference text for forced align.
    forced = {
        "segments": [{"text": text, "start": 0.0, "end": duration_ms / 1000.0}],
        "language": "en",
    }
    aligned = whisperx.align(
        forced["segments"], align_model, metadata, audio, device, return_char_alignments=False
    )

    # Map aligned words back to char offsets via greedy normalize-match.
    word_offsets = _word_offsets(text)
    norm_offsets = [(_normalize(w), cs, ce) for w, cs, ce in word_offsets]
    aligned_words: list[AlignedWord] = []
    j = 0
    for seg in aligned.get("segments", []):
        for w in seg.get("words", []):
            wtxt = w.get("word", "").strip()
            if not wtxt:
                continue
            n = _normalize(wtxt)
            cs, ce = -1, -1
            while j < len(norm_offsets):
                nw, c0, c1 = norm_offsets[j]
                j += 1
                if nw == n or nw.startswith(n) or n.startswith(nw):
                    cs, ce = c0, c1
                    break
            score = float(w.get("score", 1.0))
            aligned_words.append(
                AlignedWord(
                    w=wtxt,
                    s=float(w.get("start", 0.0)),
                    e=float(w.get("end", 0.0)),
                    cs=cs,
                    ce=ce,
                    unstable=score < 0.5,
                )
            )

    if not aligned_words:
        return _uniform(text, duration_ms)
    return aligned_words


def align(audio_path: Path, text: str, duration_ms: int) -> list[AlignedWord]:
    if not _have_whisperx() or duration_ms <= 0:
        return _uniform(text, duration_ms)
    try:
        return _whisperx_align(audio_path, text, duration_ms)
    except Exception as e:  # noqa: BLE001
        log.warning("WhisperX alignment failed (%s); falling back to uniform.", e)
        return _uniform(text, duration_ms)
