"""
Gestion de la connexion Redis partagée.
Utilise redis-py async pour toutes les opérations (commandes + pub/sub).
"""
import logging

import redis.asyncio as aioredis
from redis.asyncio import Redis

from core.config import settings

logger = logging.getLogger(__name__)

# Instance globale du client Redis
_redis_client: Redis | None = None


async def get_redis() -> Redis:
    """
    Retourne le client Redis partagé (singleton).
    Utilisé comme dépendance FastAPI via Depends(get_redis).
    """
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(
            settings.REDIS_URL,
            decode_responses=True,  # Retourne des str plutôt que des bytes
        )
    return _redis_client


async def init_redis() -> None:
    """Initialise la connexion Redis au démarrage de l'application."""
    redis = await get_redis()
    # Vérification que Redis est joignable
    await redis.ping()
    logger.info("Connexion Redis établie avec succès.")


async def close_redis() -> None:
    """Ferme proprement la connexion Redis à l'arrêt de l'application."""
    global _redis_client
    if _redis_client is not None:
        await _redis_client.aclose()
        _redis_client = None
        logger.info("Connexion Redis fermée.")
