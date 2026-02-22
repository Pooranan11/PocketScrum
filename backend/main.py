"""
Point d'entrée de l'application FastAPI PocketScrum.

Responsabilités :
  - Configuration du cycle de vie (lifespan) : init/close Redis
  - Middleware CORS (whitelist stricte configurable par .env)
  - Middleware des headers de sécurité HTTP
  - Rate limiting global via slowapi
  - Inclusion des routers REST et WebSocket
"""
import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from core.config import settings
from core.redis import close_redis, init_redis
from routers import rooms as rooms_router
from routers import ws as ws_router

# ---------------------------------------------------------------------------
# Configuration du logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Rate limiter global (partagé avec les routers)
# ---------------------------------------------------------------------------

limiter = Limiter(key_func=get_remote_address)


# ---------------------------------------------------------------------------
# Middleware des headers de sécurité HTTP
# ---------------------------------------------------------------------------

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Ajoute les headers de sécurité HTTP recommandés sur chaque réponse.
    Protège contre le clickjacking, le sniffing MIME et les injections XSS.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        if settings.APP_ENV == "production":
            csp = "default-src 'none'; connect-src 'self'; frame-ancestors 'none'"
        else:
            csp = (
                "default-src 'none'; "
                "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
                "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
                "img-src 'self' data: https://cdn.jsdelivr.net; "
                "connect-src 'self'; "
                "frame-ancestors 'none'"
            )
        response.headers["Content-Security-Policy"] = csp
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        if settings.APP_ENV == "production":
            response.headers["Strict-Transport-Security"] = (
                "max-age=63072000; includeSubDomains; preload"
            )
        return response


# ---------------------------------------------------------------------------
# Cycle de vie de l'application (lifespan)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialise les ressources au démarrage et les libère à l'arrêt."""
    logger.info("Démarrage de PocketScrum — environnement : %s", settings.APP_ENV)
    await init_redis()
    yield
    await close_redis()
    logger.info("PocketScrum arrêté proprement.")


# ---------------------------------------------------------------------------
# Création de l'application FastAPI
# ---------------------------------------------------------------------------

app = FastAPI(
    title="PocketScrum API",
    description="API de planning poker en temps réel pour équipes agiles.",
    version="0.1.0",
    lifespan=lifespan,
    # Désactivation des docs en production si souhaité
    docs_url="/docs" if settings.APP_ENV != "production" else None,
    redoc_url="/redoc" if settings.APP_ENV != "production" else None,
)

# ---------------------------------------------------------------------------
# Middleware CORS — whitelist explicite configurable par variable d'env
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)

# ---------------------------------------------------------------------------
# Middleware sécurité
# ---------------------------------------------------------------------------

app.add_middleware(SecurityHeadersMiddleware)

# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ---------------------------------------------------------------------------
# Inclusion des routers
# ---------------------------------------------------------------------------

app.include_router(rooms_router.router)
app.include_router(ws_router.router)


# ---------------------------------------------------------------------------
# Route de santé
# ---------------------------------------------------------------------------

@app.get("/health", tags=["monitoring"], summary="Vérification de l'état du service")
async def health_check() -> dict:
    """Retourne 200 OK si le service est opérationnel."""
    return {"status": "ok", "service": "pocketscrum"}
