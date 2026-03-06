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

# Nombre maximum de joueurs par room
MAX_PLAYERS: int = 20

# Durée de vie des tickets WebSocket (usage unique, 30 secondes)
WS_TICKET_TTL: int = 30

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


def _roles_key(code: str) -> str:
    """Clé du hash {player_id -> role} des rôles des joueurs (dev|qa)."""
    return f"room:{code}:roles"


def room_channel(code: str) -> str:
    """Nom du canal Redis Pub/Sub pour la room (broadcast temps réel)."""
    return f"room:{code}:channel"


def _ws_ticket_key(ticket: str) -> str:
    """Clé Redis d'un ticket WebSocket à usage unique."""
    return f"ws_ticket:{ticket}"


# ---------------------------------------------------------------------------
# Génération du code room
# ---------------------------------------------------------------------------

def _generate_code() -> str:
    """Génère un code room de 4 lettres majuscules aléatoires."""
    return "".join(secrets.choice(string.ascii_uppercase) for _ in range(4))


# ---------------------------------------------------------------------------
# Opérations sur les rooms
# ---------------------------------------------------------------------------

async def create_room(redis: Redis, scrum_master_id: str, scrum_master_name: str, scrum_master_role: str = "dev") -> str:
    """
    Crée une nouvelle room avec un code unique de 4 lettres.

    Effectue jusqu'à 10 tentatives pour trouver un code libre.
    Retourne le code de la room créée.
    """
    # Réservation atomique du code via HSETNX :
    # HSETNX retourne 1 si le champ a été créé (code libre), 0 sinon (déjà pris).
    # Cela élimine la race condition check-then-set entre deux créations simultanées.
    code = ""
    for _ in range(10):
        candidate = _generate_code()
        reserved = await redis.hsetnx(_room_key(candidate), "scrum_master_id", scrum_master_id)
        if reserved:
            code = candidate
            break

    if not code:
        # Cas extrêmement improbable (26^4 = 456 976 combinaisons possibles)
        raise RuntimeError("Impossible de générer un code room unique après 10 tentatives.")

    # Complétion des données de la room (scrum_master_id déjà positionné par HSETNX)
    async with redis.pipeline() as pipe:
        pipe.hset(_room_key(code), mapping={"state": "voting", "round": "1", "task_name": ""})
        pipe.expire(_room_key(code), ROOM_TTL)
        pipe.hset(_players_key(code), scrum_master_id, scrum_master_name)
        pipe.expire(_players_key(code), ROOM_TTL)
        pipe.hset(_roles_key(code), scrum_master_id, scrum_master_role)
        pipe.expire(_roles_key(code), ROOM_TTL)
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


async def get_player_roles(redis: Redis, code: str) -> dict[str, str]:
    """Retourne le dict {player_id -> role} des joueurs actifs."""
    return await redis.hgetall(_roles_key(code))


async def get_votes(redis: Redis, code: str) -> dict[str, str]:
    """Retourne le dict {player_id -> vote} des votes en cours."""
    return await redis.hgetall(_votes_key(code))


async def join_room(redis: Redis, code: str, player_id: str, player_name: str, role: str = "dev") -> bool:
    """
    Ajoute un joueur à une room existante.

    Retourne True si réussi, False si la room n'existe pas.
    """
    if not await room_exists(redis, code):
        logger.warning("Tentative de rejoindre la room inexistante : %s", code)
        return False

    # Vérification de la limite de joueurs
    current_players = await get_players(redis, code)
    if len(current_players) >= MAX_PLAYERS:
        logger.warning("Limite de joueurs (%d) atteinte dans la room %s.", MAX_PLAYERS, code)
        return False

    # Ajout du joueur + prolongation du TTL de la room
    async with redis.pipeline() as pipe:
        pipe.hset(_players_key(code), player_id, player_name)
        pipe.expire(_players_key(code), ROOM_TTL)
        pipe.hset(_roles_key(code), player_id, role)
        pipe.expire(_roles_key(code), ROOM_TTL)
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
        pipe.hdel(_roles_key(code), player_id)
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
            # Plus personne dans la room : suppression de toutes les clés
            await redis.delete(
                _room_key(code),
                _players_key(code),
                _votes_key(code),
                _justifications_key(code),
                _roles_key(code),
            )
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
    roles = await redis.hgetall(_roles_key(code))

    results = [
        {
            "player_id": pid,
            "player_name": name,
            "vote": votes.get(pid),  # None si le joueur n'a pas voté
            "justification": justifications.get(pid, ""),
            "role": roles.get(pid, "dev"),
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


async def create_ws_ticket(redis: Redis, room_code: str, player_id: str) -> str:
    """
    Génère un ticket WebSocket à usage unique valable 30 secondes.

    Le ticket lie room_code + player_id et est stocké en Redis.
    Il doit être consommé une seule fois via consume_ws_ticket().
    """
    ticket = secrets.token_urlsafe(32)
    await redis.set(_ws_ticket_key(ticket), f"{room_code}:{player_id}", ex=WS_TICKET_TTL)
    logger.debug("Ticket WS créé pour player %s dans room %s.", player_id, room_code)
    return ticket


async def consume_ws_ticket(redis: Redis, ticket: str) -> Optional[tuple[str, str]]:
    """
    Consomme un ticket WebSocket de façon atomique (GETDEL).

    Retourne (room_code, player_id) si valide, None sinon.
    Le ticket est supprimé immédiatement — il ne peut être utilisé qu'une seule fois.
    """
    value = await redis.getdel(_ws_ticket_key(ticket))
    if not value:
        return None
    # room_code est [A-Z]{4} sans ':', player_id est token_urlsafe sans ':'
    parts = value.split(":", 1)
    if len(parts) != 2:
        return None
    return parts[0], parts[1]


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
    roles_dict = await redis.hgetall(_roles_key(code))
    state = room.get("state", "voting")

    players = [
        {
            "player_id": pid,
            "player_name": name,
            "has_voted": pid in votes_dict,
            "role": roles_dict.get(pid, "dev"),
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
                "role": roles_dict.get(pid, "dev"),
            }
            for pid, vote in votes_dict.items()
        ]

    return result
