"""Kokoro TTS wrapper with a silent-MP3 fallback for environments without `kokoro`.

Real path:
    pipeline = KPipeline(lang_code='a')   # 'a' = American English, 'b' = British
    audio_chunks = pipeline(text, voice=voice)
    # iterate, collect 24kHz numpy float32 audio
    write mp3 (libmp3lame, 64kbps mono)

Stub path (no kokoro installed):
    Emits a silent MP3 sized to (#chars / 14 chars-per-second) so the rest of
    the app remains testable end-to-end.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

log = logging.getLogger(__name__)


_KOKORO_AVAILABLE: bool | None = None
_pipeline_cache: dict[str, object] = {}


def _have_kokoro() -> bool:
    global _KOKORO_AVAILABLE
    if _KOKORO_AVAILABLE is None:
        try:
            import kokoro  # noqa: F401
            _KOKORO_AVAILABLE = True
        except Exception as e:  # noqa: BLE001
            log.info("kokoro not available, using silent-stub TTS: %s", e)
            _KOKORO_AVAILABLE = False
    return _KOKORO_AVAILABLE


def _have_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def _kokoro_pipeline(voice: str):
    # Voice prefix encodes language: a=US English, b=UK English
    lang = voice[:1] if voice else "a"
    if lang in _pipeline_cache:
        return _pipeline_cache[lang]
    from kokoro import KPipeline  # type: ignore[import-not-found]
    pipe = KPipeline(lang_code=lang)
    _pipeline_cache[lang] = pipe
    return pipe


def _save_mp3(samples: np.ndarray, sr: int, out_path: Path, bitrate_kbps: int) -> int:
    """Save float32 mono samples to MP3 via ffmpeg. Returns duration in ms."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    duration_ms = int(round(len(samples) * 1000 / sr))
    if not _have_ffmpeg():
        raise RuntimeError(
            "ffmpeg not found on PATH. Install ffmpeg (with libmp3lame) to encode audio."
        )
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        wav_path = tmp.name
    try:
        sf.write(wav_path, samples, sr, subtype="PCM_16")
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", wav_path,
            "-codec:a", "libmp3lame",
            "-b:a", f"{bitrate_kbps}k",
            "-ac", "1",
            str(out_path),
        ]
        subprocess.run(cmd, check=True)
    finally:
        try:
            os.unlink(wav_path)
        except OSError:
            pass
    return duration_ms


def _stub_silent_audio(text: str, out_path: Path, bitrate_kbps: int) -> int:
    chars_per_second = 14.0
    seconds = max(1.0, len(text) / chars_per_second)
    sr = 24000
    samples = np.zeros(int(seconds * sr), dtype=np.float32)
    return _save_mp3(samples, sr, out_path, bitrate_kbps)


def synthesize(text: str, voice: str, out_path: Path, *, bitrate_kbps: int = 64) -> int:
    """Synthesize `text` to MP3 at `out_path`. Returns duration in ms."""
    if not _have_kokoro():
        return _stub_silent_audio(text, out_path, bitrate_kbps)

    pipe = _kokoro_pipeline(voice)
    sr = 24000
    audio_pieces: list[np.ndarray] = []
    # Kokoro's KPipeline is a generator yielding (graphemes, phonemes, audio)
    for _gs, _ps, audio in pipe(text, voice=voice):  # type: ignore[misc]
        if audio is None:
            continue
        arr = np.asarray(audio, dtype=np.float32)
        if arr.ndim > 1:
            arr = arr.mean(axis=-1)
        audio_pieces.append(arr)

    if not audio_pieces:
        return _stub_silent_audio(text, out_path, bitrate_kbps)
    samples = np.concatenate(audio_pieces)
    return _save_mp3(samples, sr, out_path, bitrate_kbps)


def list_voices() -> list[str]:
    return [
        "af_bella", "af_heart", "am_michael", "bf_emma", "bm_george",
    ]
