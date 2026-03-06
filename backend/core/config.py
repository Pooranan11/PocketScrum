"""
Configuration centralisée de l'application via variables d'environnement.
Utilise pydantic-settings pour valider et typer la config au démarrage.
"""
import json
from typing import Any, List, Tuple, Type

from pydantic import field_validator, model_validator
from pydantic_settings import (
    BaseSettings,
    EnvSettingsSource,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
)


class _LenientEnvSource(EnvSettingsSource):
    """
    Source d'env qui retourne la valeur brute quand json.loads() échoue sur un
    champ complexe (List, Dict…), au lieu de lever une SettingsError.
    Les field_validators pydantic peuvent alors gérer des formats alternatifs
    (URL simple, CSV, …).
    """

    def decode_complex_value(self, field_name: str, field: Any, value: Any) -> Any:
        try:
            return super().decode_complex_value(field_name, field, value)
        except Exception:
            return value


class Settings(BaseSettings):
    # --- Redis ---
    REDIS_URL: str = "redis://localhost:6379"

    # --- Sécurité ---
    # Clé secrète pour le HMAC des tokens de session
    SECRET_KEY: str = "changez-moi-en-production"

    # --- CORS ---
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

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: Type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        **kwargs: PydanticBaseSettingsSource,
    ) -> Tuple[PydanticBaseSettingsSource, ...]:
        # Remplace la source env système par notre version tolérante au non-JSON.
        # **kwargs absorbe 'secrets_dir' (pydantic-settings <2.1) ou
        # 'file_secret_settings' (>=2.1) pour rester compatible avec les deux.
        return (
            init_settings,
            _LenientEnvSource(settings_cls),
            dotenv_settings,
            *kwargs.values(),
        )

    @model_validator(mode="after")
    def check_secret_key_in_production(self) -> "Settings":
        if (
            self.APP_ENV == "production"
            and self.SECRET_KEY == "changez-moi-en-production"
        ):
            raise ValueError(
                "SECRET_KEY doit être redéfini en production. "
                "Définissez la variable d'environnement SECRET_KEY dans votre .env."
            )
        return self

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
