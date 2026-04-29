from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="ABR_", extra="ignore")

    storage_dir: Path = Path(__file__).resolve().parent.parent / "storage"
    db_url: str = ""  # filled below if blank

    redis_url: str = "redis://localhost:6379"
    use_arq: bool = False  # if False, ingest runs in-process via BackgroundTasks

    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    default_voice: str = "af_bella"
    available_voices: list[str] = [
        "af_bella", "af_heart", "am_michael", "bf_emma", "bm_george",
    ]

    # Chunking
    chunk_max_chars: int = 400
    chunk_min_sentences: int = 1
    chunk_max_sentences: int = 3

    # Audio
    audio_bitrate_kbps: int = 64

    def ensure_dirs(self) -> None:
        for sub in ("audio", "covers", "uploads"):
            (self.storage_dir / sub).mkdir(parents=True, exist_ok=True)

    @property
    def resolved_db_url(self) -> str:
        if self.db_url:
            return self.db_url
        return f"sqlite+aiosqlite:///{self.storage_dir / 'abr.db'}"


settings = Settings()
settings.ensure_dirs()
