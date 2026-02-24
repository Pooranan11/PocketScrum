"""
Service de gestion des rooms de planning poker.

Toutes les clés Redis sont construites via des fonctions template dédiées.
Aucun input utilisateur n'est jamais injecté directement dans une clé Redis,
ce qui prévient toute forme d'injection de clé.

TTL de 24h appliqué sur chaque opération d'écriture sans exception.
"""
import logging
import secrets
import string
from typing import Optional

from redis.asyncio import Redis

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

# Durée de vie des rooms : 24 heures (en secondes)
ROOM_TTL: int = 86_400

# ---------------------------------------------------------------------------
# Fonctions de construction des clés Redis (templates stricts)
# Les codes room sont validés en amont par Pydantic avant d'arriver ici.
# ---------------------------------------------------------------------------

def _room_key(code: str) -> str:
    """Clé du hash contenant les métadonnées de la room."""
    return f"room:{code}"


def _players_key(code: str) -> str:
    """Clé du hash {player_id -> player_name} des participants."""
    return f"room:{code}:players"


def _votes_key(code: str) -> str:
    """Clé du hash {player_id -> vote} des votes en cours."""
    return f"room:{code}:votes"


def _justifications_key(code: str) -> str:
    """Clé du hash {player_id -> justification} des justifications en cours."""
    return f"room:{code}:justifications"


def room_channel(code: str) -> str:
    """Nom du canal Redis Pub/Sub pour la room (broadcast temps réel)."""
    return f"room:{code}:channel"


# ---------------------------------------------------------------------------
# Génération du code room
# ---------------------------------------------------------------------------

def _generate_code() -> str:
    """Génère un code room de 4 lettres majuscules aléatoires."""
    return "".join(secrets.choice(string.ascii_uppercase) for _ in range(4))


# ---------------------------------------------------------------------------
# Opérations sur les rooms
# ---------------------------------------------------------------------------

async def create_room(redis: Redis, scrum_master_id: str, scrum_master_name: str) -> str:
    """
    Crée une nouvelle room avec un code unique de 4 lettres.

    Effectue jusqu'à 10 tentatives pour trouver un code libre.
    Retourne le code de la room créée.
    """
    code = ""
    for _ in range(10):
        candidate = _generate_code()
        if not await redis.exists(_room_key(candidate)):
            code = candidate
            break

    if not code:
        # Cas extrêmement improbable (26^4 = 456 976 combinaisons possibles)
        raise RuntimeError("Impossible de générer un code room unique après 10 tentatives.")

    # Données de la room
    room_data = {
        "scrum_master_id": scrum_master_id,
        "state": "voting",
        "round": "1",
        "task_name": "",
    }

    # Écriture atomique via pipeline — TTL appliqué sur chaque clé
    async with redis.pipeline() as pipe:
        pipe.hset(_room_key(code), mapping=room_data)
        pipe.expire(_room_key(code), ROOM_TTL)
        pipe.hset(_players_key(code), scrum_master_id, scrum_master_name)
        pipe.expire(_players_key(code), ROOM_TTL)
        await pipe.execute()

    logger.info("Room %s créée par le Scrum Master %s.", code, scrum_master_id)
    return code


async def room_exists(redis: Redis, code: str) -> bool:
    """Vérifie qu'une room est active dans Redis."""
    return bool(await redis.exists(_room_key(code)))


async def get_room(redis: Redis, code: str) -> Optional[dict]:
    """
    Retourne les métadonnées d'une room ou None si elle n'existe pas.
    """
    data = await redis.hgetall(_room_key(code))
    return data if data else None


async def get_players(redis: Redis, code: str) -> dict[str, str]:
    """Retourne le dict {player_id -> player_name} des joueurs actifs."""
    return await redis.hgetall(_players_key(code))


async def get_votes(redis: Redis, code: str) -> dict[str, str]:
    """Retourne le dict {player_id -> vote} des votes en cours."""
    return await redis.hgetall(_votes_key(code))


async def join_room(redis: Redis, code: str, player_id: str, player_name: str) -> bool:
    """
    Ajoute un joueur à une room existante.

    Retourne True si réussi, False si la room n'existe pas.
    """
    if not await room_exists(redis, code):
        logger.warning("Tentative de rejoindre la room inexistante : %s", code)
        return False

    # Ajout du joueur + prolongation du TTL de la room
    async with redis.pipeline() as pipe:
        pipe.hset(_players_key(code), player_id, player_name)
        pipe.expire(_players_key(code), ROOM_TTL)
        pipe.expire(_room_key(code), ROOM_TTL)
        await pipe.execute()

    logger.info("Joueur %s (%s) a rejoint la room %s.", player_id, player_name, code)
    return True


async def remove_player(redis: Redis, code: str, player_id: str) -> Optional[str]:
    """
    Retire un joueur de la room (liste + vote).

    Si le joueur était Scrum Master, transfère le rôle au premier joueur restant.
    Retourne le nouveau scrum_master_id si un transfert a eu lieu, None sinon.
    """
    async with redis.pipeline() as pipe:
        pipe.hdel(_players_key(code), player_id)
        pipe.hdel(_votes_key(code), player_id)
        pipe.hdel(_justifications_key(code), player_id)
        await pipe.execute()

    # Vérification du transfert Scrum Master
    room = await get_room(redis, code)
    if not room:
        return None

    if room.get("scrum_master_id") == player_id:
        remaining = await get_players(redis, code)
        if remaining:
            new_sm = next(iter(remaining))
            await redis.hset(_room_key(code), "scrum_master_id", new_sm)
            await redis.expire(_room_key(code), ROOM_TTL)
            logger.info(
                "Scrum Master de la room %s transféré de %s à %s.",
                code, player_id, new_sm,
            )
            return new_sm
        else:
            # Plus personne dans la room : suppression anticipée
            await redis.delete(_room_key(code), _players_key(code), _votes_key(code))
            logger.info("Room %s supprimée (aucun joueur restant).", code)

    return None


async def cast_vote(redis: Redis, code: str, player_id: str, vote: str, justification: str = "") -> bool:
    """
    Enregistre le vote d'un joueur.

    Retourne False si la room n'existe pas ou si les votes sont déjà révélés.
    """
    room = await get_room(redis, code)
    if not room:
        return False

    if room.get("state") != "voting":
        # Ignore silencieusement : peut arriver en cas de race condition client
        return False

    async with redis.pipeline() as pipe:
        pipe.hset(_votes_key(code), player_id, vote)
        pipe.expire(_votes_key(code), ROOM_TTL)
        if justification:
            pipe.hset(_justifications_key(code), player_id, justification)
            pipe.expire(_justifications_key(code), ROOM_TTL)
        await pipe.execute()

    return True


async def reveal_votes(
    redis: Redis, code: str, player_id: str
) -> Optional[list[dict]]:
    """
    Révèle les votes de tous les joueurs (Scrum Master uniquement).

    Retourne la liste des votes ou None si non autorisé / room inexistante.
    """
    room = await get_room(redis, code)
    if not room:
        return None

    # Vérification que le demandeur est bien le Scrum Master
    if room.get("scrum_master_id") != player_id:
        logger.warning(
            "Tentative de révélation non autorisée dans la room %s par le joueur %s.",
            code, player_id,
        )
        return None

    # Passage de la room en état "revealed"
    await redis.hset(_room_key(code), "state", "revealed")
    await redis.expire(_room_key(code), ROOM_TTL)

    # Construction de la liste des résultats
    players = await get_players(redis, code)
    votes = await get_votes(redis, code)
    justifications = await redis.hgetall(_justifications_key(code))

    results = [
        {
            "player_id": pid,
            "player_name": name,
            "vote": votes.get(pid),  # None si le joueur n'a pas voté
            "justification": justifications.get(pid, ""),
        }
        for pid, name in players.items()
    ]

    logger.info("Votes révélés dans la room %s.", code)
    return results


async def set_task_name(redis: Redis, code: str, player_id: str, task_name: str) -> bool:
    """
    Met à jour le nom de la tâche en cours (Scrum Master uniquement).

    Retourne True si réussi, False si non autorisé ou room inexistante.
    """
    room = await get_room(redis, code)
    if not room:
        return False

    if room.get("scrum_master_id") != player_id:
        logger.warning(
            "Tentative de mise à jour du nom de tâche non autorisée dans la room %s par %s.",
            code, player_id,
        )
        return False

    await redis.hset(_room_key(code), "task_name", task_name)
    await redis.expire(_room_key(code), ROOM_TTL)
    logger.info("Nom de tâche mis à jour dans la room %s : %r.", code, task_name)
    return True


async def start_new_round(redis: Redis, code: str, player_id: str, task_name: str = "") -> Optional[int]:
    """
    Démarre un nouveau round : réinitialise les votes et repasse en état "voting".
    Scrum Master uniquement.

    Retourne le numéro du nouveau round ou None si non autorisé.
    """
    room = await get_room(redis, code)
    if not room:
        return None

    if room.get("scrum_master_id") != player_id:
        logger.warning(
            "Tentative de nouveau round non autorisée dans la room %s par %s.",
            code, player_id,
        )
        return None

    new_round = int(room.get("round", "1")) + 1

    async with redis.pipeline() as pipe:
        # Suppression des votes et justifications du round précédent
        pipe.delete(_votes_key(code))
        pipe.delete(_justifications_key(code))
        # Mise à jour de l'état, du numéro de round et du nom de tâche
        pipe.hset(_room_key(code), mapping={"state": "voting", "round": str(new_round), "task_name": task_name})
        pipe.expire(_room_key(code), ROOM_TTL)
        await pipe.execute()

    logger.info("Nouveau round %d démarré dans la room %s.", new_round, code)
    return new_round


async def build_room_state(redis: Redis, code: str) -> Optional[dict]:
    """
    Construit un snapshot complet de l'état de la room pour l'envoi initial
    à un joueur qui vient de se connecter via WebSocket.
    """
    room = await get_room(redis, code)
    if not room:
        return None

    players_dict = await get_players(redis, code)
    votes_dict = await get_votes(redis, code)
    state = room.get("state", "voting")

    players = [
        {
            "player_id": pid,
            "player_name": name,
            "has_voted": pid in votes_dict,
        }
        for pid, name in players_dict.items()
    ]

    result: dict = {
        "room_code": code,
        "state": state,
        "round": int(room.get("round", "1")),
        "players": players,
        "scrum_master_id": room.get("scrum_master_id"),
        "task_name": room.get("task_name", ""),
    }

    # Les votes ne sont visibles que si l'état est "revealed"
    if state == "revealed":
        justifications = await redis.hgetall(_justifications_key(code))
        result["votes"] = [
            {
                "player_id": pid,
                "player_name": players_dict.get(pid, "Inconnu"),
                "vote": vote,
                "justification": justifications.get(pid, ""),
            }
            for pid, vote in votes_dict.items()
        ]

    return result
