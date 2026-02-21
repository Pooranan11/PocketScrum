"""
Tests unitaires et d'intégration pour la logique métier des rooms.

Couvre :
  - Création de room (code unique, TTL Redis, données initiales)
  - Adhésion à une room
  - Vote (cartes valides, état de la room)
  - Révélation des votes
  - Lancement d'un nouveau round
  - Suppression d'un joueur et transfert du rôle Scrum Master
"""
import pytest
import pytest_asyncio
from fakeredis.aioredis import FakeRedis

from services.room import (
    build_room_state,
    cast_vote,
    create_room,
    get_players,
    get_room,
    get_votes,
    join_room,
    remove_player,
    reveal_votes,
    room_exists,
    start_new_round,
)


# ---------------------------------------------------------------------------
# Fixtures locales
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def redis() -> FakeRedis:
    """Redis fictif isolé pour chaque test."""
    r = FakeRedis(decode_responses=True)
    await r.flushall()
    yield r
    await r.aclose()


@pytest_asyncio.fixture
async def room_with_sm(redis: FakeRedis):
    """Crée une room avec un Scrum Master et retourne (redis, code, sm_id)."""
    sm_id = "scrum-master-001"
    code = await create_room(redis, sm_id, "Alice")
    return redis, code, sm_id


# ---------------------------------------------------------------------------
# Tests : création de room
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_room_returns_4_letter_code(redis: FakeRedis):
    """Le code room est exactement 4 lettres majuscules."""
    code = await create_room(redis, "player-1", "Alice")
    assert len(code) == 4
    assert code.isupper()
    assert code.isalpha()


@pytest.mark.asyncio
async def test_create_room_exists_in_redis(redis: FakeRedis):
    """La room créée est bien présente dans Redis."""
    code = await create_room(redis, "player-1", "Alice")
    assert await room_exists(redis, code)


@pytest.mark.asyncio
async def test_create_room_has_ttl(redis: FakeRedis):
    """Toutes les clés Redis de la room ont un TTL > 0."""
    code = await create_room(redis, "player-1", "Alice")
    ttl_room = await redis.ttl(f"room:{code}")
    ttl_players = await redis.ttl(f"room:{code}:players")
    assert ttl_room > 0, "La clé room doit avoir un TTL"
    assert ttl_players > 0, "La clé players doit avoir un TTL"


@pytest.mark.asyncio
async def test_create_room_scrum_master_in_players(redis: FakeRedis):
    """Le Scrum Master est automatiquement ajouté à la liste des joueurs."""
    sm_id = "player-sm"
    code = await create_room(redis, sm_id, "Alice")
    players = await get_players(redis, code)
    assert sm_id in players
    assert players[sm_id] == "Alice"


@pytest.mark.asyncio
async def test_create_room_initial_state_is_voting(redis: FakeRedis):
    """L'état initial de la room est 'voting', round 1."""
    code = await create_room(redis, "player-1", "Alice")
    room = await get_room(redis, code)
    assert room["state"] == "voting"
    assert room["round"] == "1"


@pytest.mark.asyncio
async def test_create_room_codes_are_unique(redis: FakeRedis):
    """Deux rooms créées ont des codes différents (statistiquement)."""
    codes = {await create_room(redis, f"player-{i}", f"Joueur {i}") for i in range(5)}
    assert len(codes) == 5


# ---------------------------------------------------------------------------
# Tests : rejoindre une room
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_join_existing_room_succeeds(room_with_sm):
    """Un joueur peut rejoindre une room existante."""
    redis, code, _ = room_with_sm
    success = await join_room(redis, code, "player-2", "Bob")
    assert success is True


@pytest.mark.asyncio
async def test_join_room_player_in_list(room_with_sm):
    """Le joueur qui rejoint apparaît dans la liste des participants."""
    redis, code, _ = room_with_sm
    await join_room(redis, code, "player-2", "Bob")
    players = await get_players(redis, code)
    assert "player-2" in players
    assert players["player-2"] == "Bob"


@pytest.mark.asyncio
async def test_join_nonexistent_room_fails(redis: FakeRedis):
    """Rejoindre une room inexistante retourne False."""
    success = await join_room(redis, "XXXX", "player-1", "Alice")
    assert success is False


# ---------------------------------------------------------------------------
# Tests : vote
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_cast_vote_stores_vote(room_with_sm):
    """Le vote est correctement enregistré dans Redis."""
    redis, code, sm_id = room_with_sm
    success = await cast_vote(redis, code, sm_id, "5")
    assert success is True
    votes = await get_votes(redis, code)
    assert votes[sm_id] == "5"


@pytest.mark.asyncio
async def test_cast_vote_has_ttl(room_with_sm):
    """La clé des votes a un TTL défini."""
    redis, code, sm_id = room_with_sm
    await cast_vote(redis, code, sm_id, "8")
    ttl = await redis.ttl(f"room:{code}:votes")
    assert ttl > 0


@pytest.mark.asyncio
async def test_cast_vote_returns_false_when_revealed(room_with_sm):
    """On ne peut pas voter après la révélation (état 'revealed')."""
    redis, code, sm_id = room_with_sm
    await reveal_votes(redis, code, sm_id)
    success = await cast_vote(redis, code, sm_id, "3")
    assert success is False


@pytest.mark.asyncio
async def test_cast_vote_on_nonexistent_room(redis: FakeRedis):
    """Voter sur une room inexistante retourne False."""
    success = await cast_vote(redis, "NONE", "player-1", "5")
    assert success is False


# ---------------------------------------------------------------------------
# Tests : révélation des votes
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_reveal_votes_by_scrum_master(room_with_sm):
    """Le Scrum Master peut révéler les votes correctement."""
    redis, code, sm_id = room_with_sm
    await join_room(redis, code, "player-2", "Bob")
    await cast_vote(redis, code, sm_id, "5")
    await cast_vote(redis, code, "player-2", "8")

    results = await reveal_votes(redis, code, sm_id)
    assert results is not None
    assert len(results) == 2
    votes_by_id = {r["player_id"]: r["vote"] for r in results}
    assert votes_by_id[sm_id] == "5"
    assert votes_by_id["player-2"] == "8"


@pytest.mark.asyncio
async def test_reveal_votes_changes_state(room_with_sm):
    """La révélation des votes passe l'état de la room à 'revealed'."""
    redis, code, sm_id = room_with_sm
    await reveal_votes(redis, code, sm_id)
    room = await get_room(redis, code)
    assert room["state"] == "revealed"


@pytest.mark.asyncio
async def test_reveal_votes_non_voter_has_none(room_with_sm):
    """Un joueur qui n'a pas voté apparaît avec vote=None après révélation."""
    redis, code, sm_id = room_with_sm
    await join_room(redis, code, "player-2", "Bob")
    # Seul le SM vote
    await cast_vote(redis, code, sm_id, "13")

    results = await reveal_votes(redis, code, sm_id)
    votes_by_id = {r["player_id"]: r["vote"] for r in results}
    assert votes_by_id["player-2"] is None


# ---------------------------------------------------------------------------
# Tests : nouveau round
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_new_round_resets_votes(room_with_sm):
    """Un nouveau round efface tous les votes du round précédent."""
    redis, code, sm_id = room_with_sm
    await cast_vote(redis, code, sm_id, "5")
    await reveal_votes(redis, code, sm_id)
    await start_new_round(redis, code, sm_id)

    votes = await get_votes(redis, code)
    assert votes == {}


@pytest.mark.asyncio
async def test_new_round_increments_counter(room_with_sm):
    """Le numéro de round est incrémenté à chaque nouveau round."""
    redis, code, sm_id = room_with_sm
    new_round = await start_new_round(redis, code, sm_id)
    assert new_round == 2

    new_round = await start_new_round(redis, code, sm_id)
    assert new_round == 3


@pytest.mark.asyncio
async def test_new_round_resets_state_to_voting(room_with_sm):
    """L'état de la room repasse à 'voting' après un nouveau round."""
    redis, code, sm_id = room_with_sm
    await reveal_votes(redis, code, sm_id)
    await start_new_round(redis, code, sm_id)
    room = await get_room(redis, code)
    assert room["state"] == "voting"


# ---------------------------------------------------------------------------
# Tests : retrait d'un joueur
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_remove_player_removes_from_list(room_with_sm):
    """Retirer un joueur le supprime bien de la liste des participants."""
    redis, code, sm_id = room_with_sm
    await join_room(redis, code, "player-2", "Bob")
    await remove_player(redis, code, "player-2")

    players = await get_players(redis, code)
    assert "player-2" not in players


@pytest.mark.asyncio
async def test_remove_player_removes_their_vote(room_with_sm):
    """Le vote d'un joueur retiré est également supprimé."""
    redis, code, sm_id = room_with_sm
    await join_room(redis, code, "player-2", "Bob")
    await cast_vote(redis, code, "player-2", "3")
    await remove_player(redis, code, "player-2")

    votes = await get_votes(redis, code)
    assert "player-2" not in votes


@pytest.mark.asyncio
async def test_remove_scrum_master_transfers_role(room_with_sm):
    """Quand le SM quitte, le rôle est transféré au joueur suivant."""
    redis, code, sm_id = room_with_sm
    await join_room(redis, code, "player-2", "Bob")
    new_sm = await remove_player(redis, code, sm_id)

    # Le nouveau SM doit être player-2
    assert new_sm == "player-2"
    room = await get_room(redis, code)
    assert room["scrum_master_id"] == "player-2"


# ---------------------------------------------------------------------------
# Tests : snapshot d'état (build_room_state)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_build_room_state_voting(room_with_sm):
    """Le snapshot en état 'voting' ne contient pas les votes."""
    redis, code, sm_id = room_with_sm
    await cast_vote(redis, code, sm_id, "5")
    state = await build_room_state(redis, code)

    assert state["state"] == "voting"
    assert "votes" not in state
    # has_voted doit être True pour le SM
    player_states = {p["player_id"]: p for p in state["players"]}
    assert player_states[sm_id]["has_voted"] is True


@pytest.mark.asyncio
async def test_build_room_state_revealed(room_with_sm):
    """Le snapshot en état 'revealed' inclut les votes dévoilés."""
    redis, code, sm_id = room_with_sm
    await cast_vote(redis, code, sm_id, "8")
    await reveal_votes(redis, code, sm_id)
    state = await build_room_state(redis, code)

    assert state["state"] == "revealed"
    assert "votes" in state
    assert len(state["votes"]) == 1
    assert state["votes"][0]["vote"] == "8"


@pytest.mark.asyncio
async def test_build_room_state_returns_none_for_missing_room(redis: FakeRedis):
    """build_room_state retourne None pour une room inexistante."""
    result = await build_room_state(redis, "NONE")
    assert result is None
