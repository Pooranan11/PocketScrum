"""
Tests couvrant les fonctionnalités non testées dans la suite existante.

Couvre :
  1. service set_task_name (SM uniquement, room inexistante)
  2. Rôles stockés à la création et à l'adhésion
  3. Justification dans cast_vote (stockage, TTL, visibilité après révélation)
  4. remove_player supprime la justification
  5. WSNewRoundPayload.task_name (validation)
  6. Validation de rôle invalide (CreateRoomRequest, JoinRoomRequest)
  7. WSVotePayload — nettoyage de la justification (strip, troncature)
  8. WS set_task_name par SM et non-SM
  9. WS vote avec justification visible après révélation
 10. WS new_round avec task_name
"""
import pytest
import pytest_asyncio
from fakeredis.aioredis import FakeRedis
from pydantic import ValidationError

from models.schemas import (
    CreateRoomRequest,
    JoinRoomRequest,
    WSNewRoundPayload,
    WSVotePayload,
)
from services.room import (
    build_room_state,
    cast_vote,
    create_room,
    get_player_roles,
    get_room,
    join_room,
    remove_player,
    reveal_votes,
    set_task_name,
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


@pytest_asyncio.fixture
async def room_with_sm(redis: FakeRedis):
    sm_id = "scrum-master-001"
    code = await create_room(redis, sm_id, "Alice", scrum_master_role="dev")
    return redis, code, sm_id


# ---------------------------------------------------------------------------
# 1. set_task_name — service
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_set_task_name_by_sm_succeeds(room_with_sm):
    """Le Scrum Master peut mettre à jour le nom de la tâche."""
    redis, code, sm_id = room_with_sm
    result = await set_task_name(redis, code, sm_id, "US-42")
    assert result is True
    room = await get_room(redis, code)
    assert room["task_name"] == "US-42"


@pytest.mark.asyncio
async def test_set_task_name_by_non_sm_fails(room_with_sm):
    """Un non-SM ne peut pas modifier le nom de la tâche."""
    redis, code, sm_id = room_with_sm
    await join_room(redis, code, "player-2", "Bob")
    result = await set_task_name(redis, code, "player-2", "Hack")
    assert result is False
    # Le nom ne doit pas avoir changé
    room = await get_room(redis, code)
    assert room["task_name"] == ""


@pytest.mark.asyncio
async def test_set_task_name_on_nonexistent_room(redis: FakeRedis):
    """set_task_name retourne False si la room n'existe pas."""
    result = await set_task_name(redis, "NONE", "player-1", "Tâche")
    assert result is False


@pytest.mark.asyncio
async def test_set_task_name_has_ttl(room_with_sm):
    """La clé room conserve un TTL après mise à jour du nom de tâche."""
    redis, code, sm_id = room_with_sm
    await set_task_name(redis, code, sm_id, "US-1")
    ttl = await redis.ttl(f"room:{code}")
    assert ttl > 0


# ---------------------------------------------------------------------------
# 2. Rôles stockés correctement
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_room_stores_sm_role(redis: FakeRedis):
    """Le rôle du SM est bien stocké dans Redis à la création."""
    sm_id = "sm-001"
    code = await create_room(redis, sm_id, "Alice", scrum_master_role="qa")
    roles = await get_player_roles(redis, code)
    assert roles[sm_id] == "qa"


@pytest.mark.asyncio
async def test_join_room_stores_player_role(room_with_sm):
    """Le rôle d'un joueur qui rejoint est bien stocké dans Redis."""
    redis, code, _ = room_with_sm
    await join_room(redis, code, "player-2", "Bob", role="qa")
    roles = await get_player_roles(redis, code)
    assert roles["player-2"] == "qa"


@pytest.mark.asyncio
async def test_build_room_state_includes_role(room_with_sm):
    """Le snapshot de room inclut le rôle de chaque joueur."""
    redis, code, sm_id = room_with_sm
    state = await build_room_state(redis, code)
    players = {p["player_id"]: p for p in state["players"]}
    assert "role" in players[sm_id]
    assert players[sm_id]["role"] == "dev"


# ---------------------------------------------------------------------------
# 3. Justification dans cast_vote
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_cast_vote_stores_justification(room_with_sm):
    """Une justification optionnelle est bien enregistrée dans Redis."""
    redis, code, sm_id = room_with_sm
    result = await cast_vote(redis, code, sm_id, "5", justification="Tâche simple")
    assert result is True
    justif = await redis.hget(f"room:{code}:justifications", sm_id)
    assert justif == "Tâche simple"


@pytest.mark.asyncio
async def test_cast_vote_justification_has_ttl(room_with_sm):
    """La clé des justifications a un TTL défini."""
    redis, code, sm_id = room_with_sm
    await cast_vote(redis, code, sm_id, "8", justification="Complexe")
    ttl = await redis.ttl(f"room:{code}:justifications")
    assert ttl > 0


@pytest.mark.asyncio
async def test_cast_vote_without_justification_no_key(room_with_sm):
    """Sans justification, la clé de justification n'est pas écrite."""
    redis, code, sm_id = room_with_sm
    await cast_vote(redis, code, sm_id, "3", justification="")
    justif = await redis.hget(f"room:{code}:justifications", sm_id)
    assert justif is None


@pytest.mark.asyncio
async def test_reveal_votes_includes_justification(room_with_sm):
    """La justification est visible dans les résultats de révélation."""
    redis, code, sm_id = room_with_sm
    await cast_vote(redis, code, sm_id, "13", justification="Grosse US")
    results = await reveal_votes(redis, code, sm_id)
    sm_result = next(r for r in results if r["player_id"] == sm_id)
    assert sm_result["justification"] == "Grosse US"


# ---------------------------------------------------------------------------
# 4. remove_player supprime la justification
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_remove_player_clears_justification(room_with_sm):
    """Le retrait d'un joueur supprime également sa justification."""
    redis, code, sm_id = room_with_sm
    await join_room(redis, code, "player-2", "Bob")
    await cast_vote(redis, code, "player-2", "5", justification="Mon avis")
    await remove_player(redis, code, "player-2")
    justif = await redis.hget(f"room:{code}:justifications", "player-2")
    assert justif is None


# ---------------------------------------------------------------------------
# 5. WSNewRoundPayload — validation task_name
# ---------------------------------------------------------------------------

def test_new_round_payload_empty_task_name_ok():
    """Un nom de tâche vide est autorisé."""
    payload = WSNewRoundPayload(task_name="")
    assert payload.task_name == ""


def test_new_round_payload_valid_task_name():
    """Un nom de tâche avec caractères autorisés est accepté."""
    payload = WSNewRoundPayload(task_name="US-42: Gestion des droits")
    assert payload.task_name == "US-42: Gestion des droits"


def test_new_round_payload_strips_whitespace():
    """Les espaces en début/fin de nom de tâche sont supprimés."""
    payload = WSNewRoundPayload(task_name="  US-42  ")
    assert payload.task_name == "US-42"


def test_new_round_payload_rejects_too_long():
    """Un nom de tâche > 60 caractères est rejeté."""
    with pytest.raises(ValidationError):
        WSNewRoundPayload(task_name="A" * 61)


@pytest.mark.parametrize("bad_name", [
    "<script>alert(1)</script>",
    "'; DROP--",
    "tâche\x00null",
    "tâche\nnewline",
    "name@domain",
    "tâche=valeur",
])
def test_new_round_payload_rejects_invalid_chars(bad_name: str):
    """Les caractères spéciaux non autorisés dans task_name lèvent ValidationError."""
    with pytest.raises(ValidationError):
        WSNewRoundPayload(task_name=bad_name)


# ---------------------------------------------------------------------------
# 6. Validation de rôle invalide
# ---------------------------------------------------------------------------

def test_create_room_rejects_invalid_role():
    """CreateRoomRequest rejette les rôles qui ne sont pas 'dev' ou 'qa'."""
    with pytest.raises(ValidationError):
        CreateRoomRequest(player_name="Alice", role="admin")


def test_create_room_rejects_empty_role():
    """CreateRoomRequest rejette un rôle vide."""
    with pytest.raises(ValidationError):
        CreateRoomRequest(player_name="Alice", role="")


def test_join_room_rejects_invalid_role():
    """JoinRoomRequest rejette les rôles invalides."""
    with pytest.raises(ValidationError):
        JoinRoomRequest(room_code="ABCD", player_name="Bob", role="scrum_master")


@pytest.mark.parametrize("valid_role", ["dev", "qa"])
def test_create_room_accepts_valid_roles(valid_role: str):
    """Seuls 'dev' et 'qa' sont acceptés comme rôles."""
    req = CreateRoomRequest(player_name="Alice", role=valid_role)
    assert req.role == valid_role


# ---------------------------------------------------------------------------
# 7. WSVotePayload — nettoyage de la justification
# ---------------------------------------------------------------------------

def test_vote_payload_strips_justification_whitespace():
    """Les espaces en début/fin de justification sont supprimés."""
    payload = WSVotePayload(vote="5", justification="  mon avis  ")
    assert payload.justification == "mon avis"


def test_vote_payload_rejects_justification_over_200():
    """Une justification > 200 chars est rejetée par Pydantic (max_length=200)."""
    with pytest.raises(ValidationError):
        WSVotePayload(vote="8", justification="A" * 201)


def test_vote_payload_empty_justification_ok():
    """Une justification vide est valide."""
    payload = WSVotePayload(vote="3", justification="")
    assert payload.justification == ""


# ---------------------------------------------------------------------------
# 8 & 9. Intégration WS — set_task_name, new_round avec task, justification
# ---------------------------------------------------------------------------

@pytest.fixture
def client():
    """Client de test synchrone avec FakeRedis."""
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

    main_module.init_redis = _noop_init
    main_module.close_redis = _noop_close
    redis_module._redis_client = None

    app.dependency_overrides[get_redis] = override_redis
    from fastapi.testclient import TestClient
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
    app.dependency_overrides.clear()
    main_module.init_redis = original_init
    main_module.close_redis = original_close
    redis_module._redis_client = None


def _create_room(client, name: str = "Alice", role: str = "dev") -> dict:
    resp = client.post("/api/rooms", json={"player_name": name, "role": role})
    assert resp.status_code == 201
    return resp.json()


def _recv_until(ws, expected_type: str, max_msgs: int = 5) -> dict | None:
    for _ in range(max_msgs):
        msg = ws.receive_json()
        if msg["type"] == expected_type:
            return msg
    return None


def test_ws_sm_set_task_name(client):
    """Le SM peut mettre à jour le nom de la tâche via WS."""
    data = _create_room(client)
    with client.websocket_connect(
        f"/ws/{data['room_code']}?player_id={data['player_id']}&token={data['token']}"
    ) as ws:
        ws.receive_json()  # room_state
        ws.send_json({"type": "set_task_name", "payload": {"task_name": "US-99"}})
        msg = _recv_until(ws, "task_name_updated")
        assert msg is not None
        assert msg["payload"]["task_name"] == "US-99"


def test_ws_non_sm_set_task_name_receives_error(client):
    """Un non-SM qui tente set_task_name reçoit un message d'erreur."""
    code = _create_room(client)["room_code"]
    join = client.post(
        f"/api/rooms/{code}/join",
        json={"room_code": code, "player_name": "Bob", "role": "qa"},
    ).json()

    with client.websocket_connect(
        f"/ws/{code}?player_id={join['player_id']}&token={join['token']}"
    ) as ws:
        ws.receive_json()  # room_state
        ws.send_json({"type": "set_task_name", "payload": {"task_name": "Hack"}})
        msg = _recv_until(ws, "error")
        assert msg is not None
        assert msg["type"] == "error"


def test_ws_new_round_with_task_name(client):
    """new_round avec task_name stocke bien le nouveau nom."""
    data = _create_room(client)
    with client.websocket_connect(
        f"/ws/{data['room_code']}?player_id={data['player_id']}&token={data['token']}"
    ) as ws:
        ws.receive_json()  # room_state
        ws.send_json({"type": "votes_reveal"})
        ws.receive_json()  # votes_reveal
        ws.send_json({"type": "new_round", "payload": {"task_name": "US-Next"}})
        msg = _recv_until(ws, "new_round")
        assert msg is not None
        assert msg["payload"].get("task_name") == "US-Next"


def test_ws_vote_with_justification_visible_after_reveal(client):
    """La justification d'un vote est retournée lors de la révélation."""
    data = _create_room(client)
    with client.websocket_connect(
        f"/ws/{data['room_code']}?player_id={data['player_id']}&token={data['token']}"
    ) as ws:
        ws.receive_json()  # room_state
        ws.send_json({"type": "vote_cast", "payload": {"vote": "5", "justification": "Facile"}})
        ws.receive_json()  # vote_cast broadcast
        ws.send_json({"type": "votes_reveal"})
        msg = _recv_until(ws, "votes_reveal")
        assert msg is not None
        votes = msg["payload"]["votes"]
        sm_vote = next((v for v in votes if v["player_id"] == data["player_id"]), None)
        assert sm_vote is not None
        assert sm_vote["justification"] == "Facile"


def test_create_room_invalid_role_returns_422(client):
    """POST /api/rooms rejette un rôle invalide avec 422."""
    resp = client.post("/api/rooms", json={"player_name": "Alice", "role": "superuser"})
    assert resp.status_code == 422


def test_join_room_invalid_role_returns_422(client):
    """POST /api/rooms/{code}/join rejette un rôle invalide avec 422."""
    code = _create_room(client)["room_code"]
    resp = client.post(
        f"/api/rooms/{code}/join",
        json={"room_code": code, "player_name": "Bob", "role": "hacker"},
    )
    assert resp.status_code == 422
