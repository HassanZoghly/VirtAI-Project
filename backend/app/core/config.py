from pydantic_settings import BaseSettings
from pydantic import Field, field_validator
import json
from functools import lru_cache
from typing import Literal, List, Union


class Settings(BaseSettings):
    # App
    APP_NAME: str = "Avatar AI Backend"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    ENVIRONMENT: Literal["development", "production"] = "development"

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # CORS
    ALLOWED_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:4173",
    ]

    @field_validator("ALLOWED_ORIGINS", mode="before")
    @classmethod
    def parse_allowed_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str):
            try:
                return json.loads(v)
            except json.JSONDecodeError:
                return [origin.strip() for origin in v.split(",")]
        return v

    # Groq API
    GROQ_API_KEY: str = Field(..., description="Groq API Key")

    # ASR (Whisper via Groq)
    ASR_MODEL: str = "whisper-large-v3-turbo"
    ASR_LANGUAGE: str = "en"
    ASR_RESPONSE_FORMAT: str = "verbose_json"  # for timestamps

    # LLM (via Groq)
    LLM_MODEL: str = "llama-3.3-70b-versatile"
    LLM_MAX_TOKENS: int = 512
    LLM_TEMPERATURE: float = 0.7
    LLM_SYSTEM_PROMPT: str = (
        "You are a smart and friendly educational assistant. "
        "You explain concepts in a simple and clear manner. "
        "Your answers are concise and helpful."
    )

    # TTS (Edge TTS)
    TTS_VOICE: str = "en-US-AriaNeural"
    TTS_RATE: str = "+0%"
    TTS_VOLUME: str = "+0%"
    TTS_PITCH: str = "+0Hz"

    # WebSocket
    WS_HEARTBEAT_INTERVAL: int = 30
    WS_MAX_MESSAGE_SIZE: int = 10 * 1024 * 1024  # 10 MB

    # Rate Limiting
    RATE_LIMIT_REQUESTS: int = 60
    RATE_LIMIT_WINDOW: int = 60

    # Audio
    AUDIO_MAX_DURATION_SEC: int = 30
    AUDIO_SAMPLE_RATE: int = 16000

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True

    @property
    def cors_origins(self) -> List[str]:
        if self.ENVIRONMENT == "development":
            return self.ALLOWED_ORIGINS
        return self.ALLOWED_ORIGINS


@lru_cache()
def get_settings() -> Settings:
    return Settings()