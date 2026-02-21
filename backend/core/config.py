"""
Configuration centralisée de l'application via variables d'environnement.
Utilise pydantic-settings pour valider et typer la config au démarrage.
"""
import json
from typing import Any, List

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # --- Redis ---
    REDIS_URL: str = "redis://localhost:6379"

    # --- Sécurité ---
    # Clé secrète pour le HMAC des tokens de session
    SECRET_KEY: str = "changez-moi-en-production"

    # --- CORS ---
    # Liste des origines autorisées, configurable par variable d'environnement.
    # Accepte soit une liste JSON ["url1","url2"] soit des URLs séparées par des virgules.
    CORS_ORIGINS: List[str] = ["http://localhost:5173"]

    # --- Rate limiting WebSocket ---
    RATE_LIMIT_PER_MINUTE: int = 30

    # --- Application ---
    APP_ENV: str = "development"

    model_config = SettingsConfigDict(
        extra="ignore",
        env_file=".env",
        env_file_encoding="utf-8",
    )

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: Any) -> Any:
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("["):
                return json.loads(v)
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v


# Instance singleton utilisée dans toute l'application
settings = Settings()
