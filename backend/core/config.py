"""
Configuration centralisée de l'application via variables d'environnement.
Utilise pydantic-settings pour valider et typer la config au démarrage.
"""
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # --- Redis ---
    REDIS_URL: str = "redis://localhost:6379"

    # --- Sécurité ---
    # Clé secrète pour le HMAC des tokens de session
    SECRET_KEY: str = "changez-moi-en-production"

    # --- CORS ---
    # Liste des origines autorisées, configurable par variable d'environnement
    CORS_ORIGINS: List[str] = ["http://localhost:5173"]

    # --- Application ---
    APP_ENV: str = "development"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        # Permet de passer CORS_ORIGINS=url1,url2 en variable d'env
        env_list_delimiter=",",
    )


# Instance singleton utilisée dans toute l'application
settings = Settings()
