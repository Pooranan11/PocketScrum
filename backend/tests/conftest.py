"""
Fixtures partagées pour tous les tests PocketScrum.

Utilise fakeredis pour simuler Redis sans serveur réel.
Chaque test reçoit une instance fraîche et isolée.
"""
import pytest
import pytest_asyncio
from fakeredis.aioredis import FakeRedis
from fastapi.testclient import TestClient

# Configuration de pytest-asyncio en mode "auto" pour tous les tests async
pytest_plugins = ("pytest_asyncio",)


@pytest_asyncio.fixture
async def fake_redis() -> FakeRedis:
    """
    Instance Redis fictive isolée par test.
    Flush automatique avant et après pour garantir l'isolation.
    """
    redis = FakeRedis(decode_responses=True)
    await redis.flushall()
    yield redis
    await redis.flushall()
    await redis.aclose()


@pytest.fixture
def test_client() -> TestClient:
    """
    Client HTTP de test avec Redis fictif injecté via dependency_overrides.
    La FakeRedis est créée dans l'event loop du TestClient pour éviter
    tout conflit d'event loop avec pytest-asyncio.
    Le lifespan Redis est neutralisé (pas de Redis réel nécessaire).
    """
    import core.redis as redis_module
    from core.redis import get_redis
    from main import app
    from fakeredis.aioredis import FakeRedis as AsyncFakeRedis

    _shared: list[AsyncFakeRedis] = []

    async def override_redis():
        if not _shared:
            _shared.append(AsyncFakeRedis(decode_responses=True))
        return _shared[0]

    import main as main_module
    original_init = main_module.init_redis
    original_close = main_module.close_redis

    async def _noop_init():
        pass

    async def _noop_close():
        pass

    # Patche les références locales dans main.py (from core.redis import ...)
    main_module.init_redis = _noop_init
    main_module.close_redis = _noop_close
    redis_module._redis_client = None

    app.dependency_overrides[get_redis] = override_redis
    with TestClient(app, raise_server_exceptions=True) as client:
        yield client
    app.dependency_overrides.clear()
    main_module.init_redis = original_init
    main_module.close_redis = original_close
    redis_module._redis_client = None


