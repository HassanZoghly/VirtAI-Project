import json
from functools import lru_cache
from pathlib import Path
from typing import Literal, Union

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Absolute path to the backend/ directory (parent of app/)
BASE_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    _DEFAULT_JWT_SECRET = "change-me-in-production-use-a-long-random-string"

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", case_sensitive=True, extra="ignore"
    )

    # App
    APP_NAME: str = "Avatar AI Backend"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    ENVIRONMENT: Literal["development", "production"] = "development"
    LOG_LEVEL: str = "INFO"
    LOG_JSON: bool = False

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # CORS
    ALLOWED_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:4173",
    ]
    PRODUCTION_ALLOWED_ORIGINS: list[str] = []

    @field_validator("ALLOWED_ORIGINS", "PRODUCTION_ALLOWED_ORIGINS", mode="before")
    @classmethod
    def parse_allowed_origins(cls, v: Union[str, list[str]]) -> list[str]:
        if isinstance(v, str):
            try:
                return json.loads(v)
            except json.JSONDecodeError:
                return [origin.strip() for origin in v.split(",")]
        return v

    @field_validator(
        "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", mode="before"
    )
    @classmethod
    def strip_oauth_values(cls, v: str) -> str:
        return v.strip() if isinstance(v, str) else v

    @field_validator(
        "RATE_LIMIT_REQUESTS",
        "RATE_LIMIT_WINDOW",
        "RATE_LIMIT_MESSAGES_PER_MINUTE",
        "RATE_LIMIT_CONNECTIONS_PER_IP",
        "ACCESS_TOKEN_EXPIRE_MINUTES",
        "REFRESH_TOKEN_EXPIRE_DAYS",
        "REDIS_AUTH_SESSION_TTL",
        "REDIS_TOKEN_VALIDATION_TTL",
    )
    @classmethod
    def ensure_positive_ints(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("must be greater than 0")
        return v

    # Groq API
    GROQ_API_KEY: str = Field(default="", description="Groq API Key (optional in dev mode)")

    # ASR (Whisper via Groq)
    ASR_MODEL: str = "whisper-large-v3"
    ASR_LANGUAGE: str = "en"
    ASR_RESPONSE_FORMAT: str = "verbose_json"  # for timestamps

    MAX_AUDIO_BUFFER_SIZE: int = 10485760  # 10MB in bytes
    AUDIO_CHUNK_TIMEOUT: int = 30  # seconds

    # LLM (via Groq)
    LLM_MODEL: str = "llama-3.3-70b-versatile"
    LLM_MAX_TOKENS: int = 512
    LLM_TEMPERATURE: float = 0.7
    LLM_SYSTEM_PROMPT: str = (
        "You are a smart and friendly educational assistant. "
        "You explain concepts in a simple and clear manner. "
        "Your answers are concise and helpful."
    )

    # TTS
    TTS_VOICE: str = "en-US-GuyNeural"
    TTS_RATE: str = "+0%"
    TTS_VOLUME: str = "+0%"
    TTS_PITCH: str = "+0Hz"
    TTS_VISEME_DEFAULT_DURATION_MS: float = 60.0
    TTS_TIMEOUT_SEC: float = 60.0

    # WebSocket
    WS_HEARTBEAT_INTERVAL: int = 30  # seconds
    WS_HEARTBEAT_TIMEOUT: int = 90  # seconds
    WS_MAX_MESSAGE_SIZE: int = 10 * 1024 * 1024  # 10 MB

    # Session Management
    SESSION_TIMEOUT_SEC: int = 300  # 5 minutes
    SESSION_CLEANUP_INTERVAL: int = 60  # seconds
    DEFAULT_AVATAR_ID: str = "avatar1"
    VALID_AVATAR_IDS: list[str] = ["avatar1", "avatar2", "avatar3"]

    # Rate Limiting
    RATE_LIMIT_REQUESTS: int = 60
    RATE_LIMIT_WINDOW: int = 60
    RATE_LIMIT_MESSAGES_PER_MINUTE: int = 60
    RATE_LIMIT_CONNECTIONS_PER_IP: int = 60
    TRUST_PROXY_HEADERS: bool = False

    # Storage
    AUDIO_STORAGE_PATH: str = str(BASE_DIR / ".data" / "sessions")
    AUDIO_FILE_TTL_HOURS: int = 24

    # Audio
    AUDIO_MAX_DURATION_SEC: int = 30
    AUDIO_SAMPLE_RATE: int = 16000

    # MongoDB
    MONGODB_URL: str = "mongodb://virtai-mongodb:27017"
    MONGODB_DB_NAME: str = "virtai"

    # Redis
    REDIS_URL: str = "redis://virtai-redis:6379/0"
    REDIS_CHAT_CONTEXT_TTL: int = 3600  # seconds — active chat context
    REDIS_TTS_CACHE_TTL: int = 86400  # seconds — synthesised audio
    REDIS_LLM_CACHE_TTL: int = 1800  # seconds — LLM completions
    REDIS_JWT_BLACKLIST_TTL: int = 604800  # seconds — matches refresh token lifetime
    REDIS_AUTH_SESSION_TTL: int = 900  # seconds — user profile cache for auth checks
    REDIS_TOKEN_VALIDATION_TTL: int = 120  # seconds — short-lived JTI validity cache

    # Auth / JWT
    JWT_SECRET_KEY: str = Field(
        default=_DEFAULT_JWT_SECRET,
        description="Secret key for JWT signing",
    )
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Google OAuth
    GOOGLE_CLIENT_ID: str = Field(default="", description="Google OAuth client ID")
    GOOGLE_CLIENT_SECRET: str = Field(default="", description="Google OAuth client secret")
    GOOGLE_REDIRECT_URI: str = "http://localhost:3000/auth/callback"

    @model_validator(mode="after")
    def validate_production_safety(self):
        if self.ENVIRONMENT != "production":
            return self

        if self.DEBUG:
            raise ValueError("DEBUG must be False when ENVIRONMENT=production")

        if self.JWT_SECRET_KEY == self._DEFAULT_JWT_SECRET:
            raise ValueError("JWT_SECRET_KEY must be changed for production")

        if not self.GOOGLE_CLIENT_ID or not self.GOOGLE_CLIENT_SECRET:
            raise ValueError("Google OAuth client credentials are required in production")

        redirect_uri = self.GOOGLE_REDIRECT_URI.lower()
        if "localhost" in redirect_uri or "127.0.0.1" in redirect_uri:
            raise ValueError("GOOGLE_REDIRECT_URI cannot target localhost in production")

        if not (self.PRODUCTION_ALLOWED_ORIGINS or self.ALLOWED_ORIGINS):
            raise ValueError("At least one CORS origin must be configured in production")

        return self

    @property
    def cors_origins(self) -> list[str]:
        if self.ENVIRONMENT == "development":
            return self.ALLOWED_ORIGINS
        if self.PRODUCTION_ALLOWED_ORIGINS:
            return self.PRODUCTION_ALLOWED_ORIGINS
        return [
            origin
            for origin in self.ALLOWED_ORIGINS
            if "localhost" not in origin and "127.0.0.1" not in origin
        ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
