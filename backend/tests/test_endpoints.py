"""
Tests d'intégration pour les endpoints REST et WebSocket.

Couvre :
  1. POST /api/rooms              — création (201, structure, validation)
  2. POST /api/rooms/{code}/join  — rejoindre (200, 404, 422 code invalide,
                                    422 mismatch, 422 nom invalide)
  3. WebSocket /ws/{code}         — connexion, ping/pong, vote, reveal,
                                    new_round, rejet token invalide,
                                    erreur non-SM
"""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """Remet à zéro le stockage slowapi avant chaque test."""
    from routers.rooms import limiter
    limiter._storage.reset()
    yield


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _create_room(client: TestClient, name: str = "Alice", role: str = "dev") -> dict:
    """Crée une room et retourne le JSON de réponse."""
    resp = client.post("/api/rooms", json={"player_name": name, "role": role})
    assert resp.status_code == 201
    return resp.json()


def _get_ws_url(client: TestClient, room_code: str, player_id: str, token: str) -> str:
    """Échange un token contre un ticket WS et retourne l'URL de connexion."""
    resp = client.post(
        f"/api/rooms/{room_code}/ws-ticket",
        json={"player_id": player_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, f"ws-ticket failed: {resp.text}"
    ticket = resp.json()["ticket"]
    return f"/ws/{room_code}?player_id={player_id}&ticket={ticket}"


def _recv_until(ws, expected_type: str, max_msgs: int = 5) -> dict | None:
    """Consomme des messages WS jusqu'à trouver le type attendu."""
    for _ in range(max_msgs):
        msg = ws.receive_json()
        if msg["type"] == expected_type:
            return msg
    return None


# ---------------------------------------------------------------------------
# 1. POST /api/rooms
# ---------------------------------------------------------------------------

def test_create_room_returns_201_and_structure(test_client: TestClient):
    """POST /api/rooms retourne 201 avec les 5 champs attendus."""
    resp = test_client.post("/api/rooms", json={"player_name": "Alice", "role": "dev"})
    assert resp.status_code == 201
    data = resp.json()
    assert set(data.keys()) == {"room_code", "player_id", "token", "is_scrum_master", "role"}
    assert len(data["room_code"]) == 4
    assert data["room_code"].isupper()
    assert data["is_scrum_master"] is True
    assert data["role"] == "dev"
    assert data["token"]
    assert data["player_id"]


def test_create_room_generates_unique_codes(test_client: TestClient):
    """Deux créations successives produisent des codes différents."""
    code1 = _create_room(test_client)["room_code"]
    code2 = _create_room(test_client)["room_code"]
    assert code1 != code2


@pytest.mark.parametrize("bad_name", [
    "<script>alert(1)</script>",
    "'; DROP TABLE--",
    "",
    "A" * 31,
])
def test_create_room_invalid_name_returns_422(test_client: TestClient, bad_name: str):
    """POST /api/rooms rejette les noms invalides avec 422."""
    resp = test_client.post("/api/rooms", json={"player_name": bad_name, "role": "dev"})
    assert resp.status_code == 422


def test_create_room_missing_body_returns_422(test_client: TestClient):
    """POST /api/rooms sans body retourne 422."""
    resp = test_client.post("/api/rooms")
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# 2. POST /api/rooms/{code}/join
# ---------------------------------------------------------------------------

def test_join_room_returns_200_and_structure(test_client: TestClient):
    """POST /api/rooms/{code}/join retourne 200 avec la structure attendue."""
    code = _create_room(test_client)["room_code"]
    resp = test_client.post(
        f"/api/rooms/{code}/join",
        json={"room_code": code, "player_name": "Bob", "role": "qa"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["room_code"] == code
    assert data["is_scrum_master"] is False
    assert data["role"] == "qa"
    assert data["player_id"]
    assert data["token"]


def test_join_room_not_found_returns_404(test_client: TestClient):
    """POST /api/rooms/{code}/join retourne 404 si la room n'existe pas."""
    resp = test_client.post(
        "/api/rooms/ZZZZ/join",
        json={"room_code": "ZZZZ", "player_name": "Bob", "role": "dev"},
    )
    assert resp.status_code == 404


def test_join_room_invalid_url_code_returns_422(test_client: TestClient):
    """Un code room invalide dans l'URL retourne 422."""
    resp = test_client.post(
        "/api/rooms/BAD1/join",
        json={"room_code": "ABCD", "player_name": "Bob"},
    )
    assert resp.status_code == 422


def test_join_room_code_mismatch_returns_422(test_client: TestClient):
    """Incohérence entre code URL et code body retourne 422."""
    code = _create_room(test_client)["room_code"]
    other = "ZZZZ" if code != "ZZZZ" else "AAAA"
    resp = test_client.post(
        f"/api/rooms/{code}/join",
        json={"room_code": other, "player_name": "Bob", "role": "dev"},
    )
    assert resp.status_code == 422


def test_join_room_invalid_player_name_returns_422(test_client: TestClient):
    """POST /api/rooms/{code}/join rejette les noms invalides avec 422."""
    code = _create_room(test_client)["room_code"]
    resp = test_client.post(
        f"/api/rooms/{code}/join",
        json={"room_code": code, "player_name": "'; DROP TABLE--", "role": "dev"},
    )
    assert resp.status_code == 422


def test_join_room_token_is_valid_for_ws(test_client: TestClient):
    """Le token renvoyé par join permet bien de se connecter en WS via ticket."""
    code = _create_room(test_client)["room_code"]
    join = test_client.post(
        f"/api/rooms/{code}/join",
        json={"room_code": code, "player_name": "Bob", "role": "qa"},
    ).json()

    ws_url = _get_ws_url(test_client, code, join["player_id"], join["token"])
    with test_client.websocket_connect(ws_url) as ws:
        msg = ws.receive_json()
        assert msg["type"] == "room_state"


# ---------------------------------------------------------------------------
# 3. WebSocket /ws/{room_code}
# ---------------------------------------------------------------------------

def test_ws_invalid_ticket_rejected(test_client: TestClient):
    """Une connexion WS avec ticket forgé est rejetée."""
    data = _create_room(test_client)
    rejected = False
    try:
        with test_client.websocket_connect(
            f"/ws/{data['room_code']}?player_id={data['player_id']}&ticket=forged_ticket"
        ):
            pass
    except Exception:
        rejected = True
    assert rejected, "Un ticket invalide doit fermer la connexion."


def test_ws_ticket_is_single_use(test_client: TestClient):
    """Un ticket WS ne peut être utilisé qu'une seule fois."""
    data = _create_room(test_client)
    ws_url = _get_ws_url(test_client, data["room_code"], data["player_id"], data["token"])

    # Première connexion : OK
    with test_client.websocket_connect(ws_url) as ws:
        ws.receive_json()  # room_state

    # Deuxième connexion avec le même ticket : rejetée
    rejected = False
    try:
        with test_client.websocket_connect(ws_url):
            pass
    except Exception:
        rejected = True
    assert rejected, "Un ticket déjà consommé doit être rejeté."


def test_ws_ticket_endpoint_invalid_token(test_client: TestClient):
    """ws-ticket retourne 403 si le token HMAC est invalide."""
    data = _create_room(test_client)
    resp = test_client.post(
        f"/api/rooms/{data['room_code']}/ws-ticket",
        json={"player_id": data["player_id"]},
        headers={"Authorization": "Bearer fake_token"},
    )
    assert resp.status_code == 403


def test_ws_ticket_endpoint_nonexistent_room(test_client: TestClient):
    """ws-ticket retourne 404 si la room n'existe pas."""
    from core.security import generate_player_id, generate_session_token
    pid = generate_player_id()
    tok = generate_session_token("ZZZZ", pid)
    resp = test_client.post(
        "/api/rooms/ZZZZ/ws-ticket",
        json={"player_id": pid},
        headers={"Authorization": f"Bearer {tok}"},
    )
    assert resp.status_code == 404


def test_ws_nonexistent_room_rejected(test_client: TestClient):
    """Une connexion WS vers une room inexistante est rejetée (ticket forgé)."""
    rejected = False
    try:
        with test_client.websocket_connect("/ws/ZZZZ?player_id=x&ticket=fake"):
            pass
    except Exception:
        rejected = True
    assert rejected, "Une room inexistante doit fermer la connexion."


def test_ws_first_message_is_room_state(test_client: TestClient):
    """Le premier message reçu après connexion est room_state."""
    data = _create_room(test_client)
    ws_url = _get_ws_url(test_client, data["room_code"], data["player_id"], data["token"])
    with test_client.websocket_connect(ws_url) as ws:
        msg = ws.receive_json()
        assert msg["type"] == "room_state"
        state = msg["payload"]
        assert state["state"] in ("voting", "revealed")
        assert isinstance(state["players"], list)
        assert "round" in state
        assert "room_code" in state


def test_ws_ping_returns_pong(test_client: TestClient):
    """Le serveur répond pong à un ping."""
    data = _create_room(test_client)
    ws_url = _get_ws_url(test_client, data["room_code"], data["player_id"], data["token"])
    with test_client.websocket_connect(ws_url) as ws:
        ws.receive_json()  # room_state
        ws.send_json({"type": "ping"})
        msg = ws.receive_json()
        assert msg["type"] == "pong"


def test_ws_vote_cast_broadcast(test_client: TestClient):
    """Un vote valide déclenche un broadcast vote_cast."""
    data = _create_room(test_client)
    ws_url = _get_ws_url(test_client, data["room_code"], data["player_id"], data["token"])
    with test_client.websocket_connect(ws_url) as ws:
        ws.receive_json()  # room_state
        ws.send_json({"type": "vote_cast", "payload": {"vote": "5"}})
        msg = ws.receive_json()
        assert msg["type"] == "vote_cast"
        assert msg["payload"]["player_id"] == data["player_id"]
        assert msg["payload"]["has_voted"] is True


def test_ws_sm_reveal_votes(test_client: TestClient):
    """Le Scrum Master peut révéler les votes."""
    data = _create_room(test_client)
    ws_url = _get_ws_url(test_client, data["room_code"], data["player_id"], data["token"])
    with test_client.websocket_connect(ws_url) as ws:
        ws.receive_json()  # room_state
        ws.send_json({"type": "votes_reveal"})
        msg = ws.receive_json()
        assert msg["type"] == "votes_reveal"
        assert "votes" in msg["payload"]


def test_ws_sm_start_new_round(test_client: TestClient):
    """Le Scrum Master peut lancer un nouveau round après révélation."""
    data = _create_room(test_client)
    ws_url = _get_ws_url(test_client, data["room_code"], data["player_id"], data["token"])
    with test_client.websocket_connect(ws_url) as ws:
        ws.receive_json()  # room_state
        ws.send_json({"type": "votes_reveal"})
        ws.receive_json()  # votes_reveal
        ws.send_json({"type": "new_round"})
        msg = ws.receive_json()
        assert msg["type"] == "new_round"
        assert "round" in msg["payload"]


def test_ws_non_sm_reveal_receives_error(test_client: TestClient):
    """Un non-SM qui tente de révéler reçoit un message d'erreur."""
    code = _create_room(test_client)["room_code"]
    join = test_client.post(
        f"/api/rooms/{code}/join",
        json={"room_code": code, "player_name": "Bob", "role": "qa"},
    ).json()

    ws_url = _get_ws_url(test_client, code, join["player_id"], join["token"])
    with test_client.websocket_connect(ws_url) as ws:
        ws.receive_json()  # room_state
        ws.send_json({"type": "votes_reveal"})
        msg = _recv_until(ws, "error")
        assert msg is not None
        assert msg["type"] == "error"


def test_ws_invalid_json_closes_connection(test_client: TestClient):
    """Un payload non-JSON ferme la connexion WebSocket."""
    data = _create_room(test_client)
    ws_url = _get_ws_url(test_client, data["room_code"], data["player_id"], data["token"])
    closed = False
    try:
        with test_client.websocket_connect(ws_url) as ws:
            ws.receive_json()  # room_state
            ws.send_text("not valid json {{{")
            ws.receive_json()  # devrait lever une exception
    except Exception:
        closed = True
    assert closed, "Un payload JSON invalide doit fermer la connexion."


def test_ws_invalid_vote_card_closes_connection(test_client: TestClient):
    """Un vote avec une carte non-Fibonacci ferme la connexion."""
    data = _create_room(test_client)
    ws_url = _get_ws_url(test_client, data["room_code"], data["player_id"], data["token"])
    closed = False
    try:
        with test_client.websocket_connect(ws_url) as ws:
            ws.receive_json()  # room_state
            ws.send_json({"type": "vote_cast", "payload": {"vote": "4"}})
            ws.receive_json()
    except Exception:
        closed = True
    assert closed, "Un vote invalide doit fermer la connexion."
