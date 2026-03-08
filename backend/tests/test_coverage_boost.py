"""
Tests ciblant les lignes non couvertes dans routers/ws.py et services/room.py.

Couvre :
  ws.py
    - Lignes 251-254 : code room invalide dans l'URL WebSocket
    - Lignes 271-277 : incohérence ticket / player_id dans l'URL
    - Lignes 281-286 : room supprimée entre création du ticket et connexion WS
    - Ligne   135    : vote ignoré silencieusement après révélation
    - Lignes 218-227 : non-SM tente new_round → message d'erreur
    - Lignes 388-394 : message WS valide JSON mais type inconnu → déconnexion

  services/room.py
    - Ligne   195    : remove_player sur room inexistante → None
    - Lignes 210-217 : SM dernier joueur → room supprimée
    - Ligne   324    : start_new_round sur room inexistante → None
    - Lignes 327-331 : start_new_round par non-SM → None
    - Ligne   374    : consume_ws_ticket avec valeur malformée → None
"""
import pytest
import pytest_asyncio
from fakeredis.aioredis import FakeRedis
from fastapi.testclient import TestClient

from services.room import (
    consume_ws_ticket,
    create_room,
    create_ws_ticket,
    join_room,
    remove_player,
    room_exists,
    start_new_round,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def redis() -> FakeRedis:
    r = FakeRedis(decode_responses=True)
    await r.flushall()
    yield r
    await r.aclose()


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """Remet à zéro le stockage slowapi avant chaque test."""
    try:
        from routers.rooms import limiter
        limiter._storage.reset()
    except Exception:
        pass
    yield


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_room(client: TestClient, name: str = "Alice", role: str = "dev") -> dict:
    resp = client.post("/api/rooms", json={"player_name": name, "role": role})
    assert resp.status_code == 201
    return resp.json()


def _get_ws_ticket(client: TestClient, room_code: str, player_id: str, token: str) -> str:
    resp = client.post(
        f"/api/rooms/{room_code}/ws-ticket",
        json={"player_id": player_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, f"ws-ticket failed: {resp.text}"
    return resp.json()["ticket"]


def _get_ws_url(client: TestClient, room_code: str, player_id: str, token: str) -> str:
    ticket = _get_ws_ticket(client, room_code, player_id, token)
    return f"/ws/{room_code}?player_id={player_id}&ticket={ticket}"


def _recv_until(ws, expected_type: str, max_msgs: int = 8) -> dict | None:
    for _ in range(max_msgs):
        msg = ws.receive_json()
        if msg["type"] == expected_type:
            return msg
    return None


# ---------------------------------------------------------------------------
# ws.py — Lignes 251-254 : code room invalide dans l'URL
# ---------------------------------------------------------------------------

def test_ws_invalid_room_code_format_rejected(test_client: TestClient):
    """
    Une connexion WS vers /ws/bad1 (minuscules / chiffre) est rejetée
    avant même l'acceptation (lines 251-254 de ws.py).
    """
    rejected = False
    try:
        with test_client.websocket_connect("/ws/bad1?player_id=x&ticket=fake"):
            pass
    except Exception:
        rejected = True
    assert rejected, "Un code room invalide doit fermer la connexion avant accept()."


def test_ws_numeric_room_code_rejected(test_client: TestClient):
    """Code numérique (1234) → rejeté avant accept."""
    rejected = False
    try:
        with test_client.websocket_connect("/ws/1234?player_id=x&ticket=fake"):
            pass
    except Exception:
        rejected = True
    assert rejected, "Un code numérique doit fermer la connexion avant accept()."


# ---------------------------------------------------------------------------
# ws.py — Lignes 271-277 : incohérence ticket / player_id URL
# ---------------------------------------------------------------------------

def test_ws_ticket_player_id_mismatch_rejected(test_client: TestClient):
    """
    Ticket valide créé pour player A, mais connexion avec player_id=B.
    → Incohérence détectée, connexion fermée (lines 271-277 de ws.py).
    """
    data = _create_room(test_client)
    ticket = _get_ws_ticket(
        test_client, data["room_code"], data["player_id"], data["token"]
    )

    # Connexion avec le bon room_code mais un player_id différent
    rejected = False
    try:
        with test_client.websocket_connect(
            f"/ws/{data['room_code']}?player_id=OTHER_PLAYER&ticket={ticket}"
        ):
            pass
    except Exception:
        rejected = True
    assert rejected, "Un ticket utilisé avec le mauvais player_id doit être rejeté."


# ---------------------------------------------------------------------------
# ws.py — Lignes 281-286 : room inexistante après ticket valide
# (couverture via test existant test_ws_nonexistent_room_rejected dans test_endpoints.py)
# Complément : service-level — room_exists retourne False après remove_player SM seul
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_room_not_exists_after_sm_leaves_alone(redis: FakeRedis):
    """
    Après que le SM seul se déconnecte, room_exists retourne False.
    Valide le chemin que ws.py lignes 281-286 empruntent côté service.
    """
    sm_id = "sm-999"
    code = await create_room(redis, sm_id, "Solo")
    assert await room_exists(redis, code)
    await remove_player(redis, code, sm_id)
    assert not await room_exists(redis, code)


# ---------------------------------------------------------------------------
# ws.py — Ligne 135 : vote ignoré silencieusement après révélation
# ---------------------------------------------------------------------------

def test_ws_vote_after_reveal_ignored(test_client: TestClient):
    """
    Vote envoyé après que le SM a révélé les votes → silencieusement ignoré,
    la connexion reste ouverte (line 135 de ws.py).
    """
    data = _create_room(test_client)
    ws_url = _get_ws_url(
        test_client, data["room_code"], data["player_id"], data["token"]
    )
    with test_client.websocket_connect(ws_url) as ws:
        ws.receive_json()  # room_state
        # Révélation des votes
        ws.send_json({"type": "votes_reveal"})
        ws.receive_json()  # votes_reveal
        # Vote envoyé après révélation → cast_vote retourne False → silencieux
        ws.send_json({"type": "vote_cast", "payload": {"vote": "5"}})
        # Aucune erreur ni déconnexion : on peut encore envoyer un ping
        ws.send_json({"type": "ping"})
        pong = _recv_until(ws, "pong")
        assert pong is not None, "La connexion doit rester active après un vote ignoré."


# ---------------------------------------------------------------------------
# ws.py — Lignes 218-227 : non-SM tente new_round → erreur
# ---------------------------------------------------------------------------

def test_ws_non_sm_new_round_receives_error(test_client: TestClient):
    """
    Un joueur non-SM envoie new_round → reçoit un message d'erreur,
    la connexion reste ouverte (lines 218-227 de ws.py).
    """
    code = _create_room(test_client)["room_code"]
    join = test_client.post(
        f"/api/rooms/{code}/join",
        json={"room_code": code, "player_name": "Bob", "role": "qa"},
    ).json()

    ws_url = _get_ws_url(test_client, code, join["player_id"], join["token"])
    with test_client.websocket_connect(ws_url) as ws:
        ws.receive_json()  # room_state
        ws.send_json({"type": "new_round"})
        msg = _recv_until(ws, "error")
        assert msg is not None
        assert msg["type"] == "error"
        assert "Scrum Master" in msg["payload"]["message"]


# ---------------------------------------------------------------------------
# ws.py — Lignes 388-394 : type WS inconnu → déconnexion immédiate
# ---------------------------------------------------------------------------

def test_ws_unknown_message_type_closes_connection(test_client: TestClient):
    """
    Message JSON valide mais avec un type inconnu de la whitelist
    → validation Pydantic échoue → connexion fermée (lines 388-394 de ws.py).
    """
    data = _create_room(test_client)
    ws_url = _get_ws_url(
        test_client, data["room_code"], data["player_id"], data["token"]
    )
    closed = False
    try:
        with test_client.websocket_connect(ws_url) as ws:
            ws.receive_json()  # room_state
            # Type inconnu → WSIncomingMessage.validate_type lève ValueError
            ws.send_json({"type": "hack_the_server", "payload": {}})
            ws.receive_json()  # doit lever une exception
    except Exception:
        closed = True
    assert closed, "Un type de message inconnu doit fermer la connexion."


# ---------------------------------------------------------------------------
# services/room.py — Ligne 195 : remove_player sur room inexistante → None
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_remove_player_on_nonexistent_room_returns_none(redis: FakeRedis):
    """
    remove_player appelé sur un code inexistant : les hdel ne font rien,
    get_room retourne None → la fonction retourne None (line 195 de room.py).
    """
    result = await remove_player(redis, "GONE", "player-1")
    assert result is None


# ---------------------------------------------------------------------------
# services/room.py — Lignes 210-217 : SM seul joueur → room supprimée
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_remove_player_sm_last_deletes_room(redis: FakeRedis):
    """
    Le SM quitte la room et c'était le seul joueur → toutes les clés Redis
    de la room sont supprimées (lines 210-217 de room.py).
    """
    sm_id = "sm-001"
    code = await create_room(redis, sm_id, "Alice")
    assert await room_exists(redis, code)

    result = await remove_player(redis, code, sm_id)
    # Aucun transfert possible (plus personne)
    assert result is None
    # La room doit avoir été supprimée
    assert not await room_exists(redis, code)
    # Les clés players doivent aussi être vides
    players = await redis.hgetall(f"room:{code}:players")
    assert players == {}


# ---------------------------------------------------------------------------
# services/room.py — Ligne 324 : start_new_round sur room inexistante
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_start_new_round_nonexistent_room_returns_none(redis: FakeRedis):
    """
    start_new_round sur un code de room inexistant → retourne None
    (line 324 de room.py).
    """
    result = await start_new_round(redis, "GONE", "player-1")
    assert result is None


# ---------------------------------------------------------------------------
# services/room.py — Lignes 327-331 : start_new_round par non-SM
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_start_new_round_by_non_sm_returns_none(redis: FakeRedis):
    """
    Un joueur non-SM appelle start_new_round → retourne None
    (lines 327-331 de room.py).
    """
    sm_id = "sm-001"
    code = await create_room(redis, sm_id, "Alice")
    await join_room(redis, code, "player-2", "Bob")

    result = await start_new_round(redis, code, "player-2")
    assert result is None


# ---------------------------------------------------------------------------
# services/room.py — Ligne 374 : consume_ws_ticket avec valeur malformée
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_consume_ws_ticket_malformed_value_returns_none(redis: FakeRedis):
    """
    Ticket Redis contenant une valeur sans séparateur ':' (malformée)
    → consume_ws_ticket retourne None (line 374 de room.py).
    """
    # Injection directe d'une valeur malformée (pas de ':')
    await redis.set("ws_ticket:malformed-ticket", "nocoherentvalue", ex=30)
    result = await consume_ws_ticket(redis, "malformed-ticket")
    assert result is None


@pytest.mark.asyncio
async def test_consume_ws_ticket_expired_returns_none(redis: FakeRedis):
    """Un ticket inexistant ou expiré retourne None."""
    result = await consume_ws_ticket(redis, "nonexistent-ticket")
    assert result is None


@pytest.mark.asyncio
async def test_consume_ws_ticket_valid_then_gone(redis: FakeRedis):
    """Un ticket valide est consommé une seule fois, puis GETDEL le supprime."""
    sm_id = "sm-001"
    code = await create_room(redis, sm_id, "Alice")
    ticket = await create_ws_ticket(redis, code, sm_id)

    # Première consommation → succès
    result = await consume_ws_ticket(redis, ticket)
    assert result == (code, sm_id)

    # Deuxième consommation → le ticket est supprimé, retourne None
    result2 = await consume_ws_ticket(redis, ticket)
    assert result2 is None
