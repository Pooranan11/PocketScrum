"""
Router WebSocket pour la communication temps réel via Redis Pub/Sub.

Architecture par connexion :
  1. Validation du token de session (HMAC)
  2. Vérification de l'existence de la room
  3. Acceptation de la connexion WebSocket
  4. Envoi de l'état courant de la room au nouveau joueur
  5. Publication de l'événement player_join sur le canal Redis
  6. Deux tâches asyncio concurrentes :
       - pubsub_to_ws  : Redis Pub/Sub → WebSocket client
       - ws_to_handler : WebSocket client → traitement + Redis Pub/Sub
  7. À la déconnexion : cleanup (désabonnement, retrait joueur, player_leave)

Sécurité :
  - Déconnexion immédiate sur payload invalide, type inconnu ou vote non Fibonacci
  - Rate limiting par fenêtre glissante (5 messages / 10 s par connexion)
  - Timeout d'inactivité de 30 minutes
"""
import asyncio
import json
import logging
import time
from collections import deque

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from redis.asyncio import Redis

from core.redis import get_redis
from core.security import verify_session_token
from models.schemas import (
    ROOM_CODE_REGEX,
    WSIncomingMessage,
    WSNewRoundPayload,
    WSVotePayload,
)
from services.room import (
    build_room_state,
    cast_vote,
    get_player_roles,
    get_players,
    remove_player,
    reveal_votes,
    room_channel,
    room_exists,
    set_task_name,
    start_new_round,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

# Timeout d'inactivité : 30 minutes (en secondes)
INACTIVITY_TIMEOUT: int = 1_800

# Rate limiting WebSocket : 15 messages par fenêtre de 10 secondes
# (le SM envoie légitimement plus de messages : set_task_name, vote, reveal, new_round)
WS_RATE_LIMIT_MAX: int = 15
WS_RATE_LIMIT_WINDOW: float = 10.0


# ---------------------------------------------------------------------------
# Rate limiter par fenêtre glissante (in-process, par connexion)
# ---------------------------------------------------------------------------

class _SlidingWindowRateLimiter:
    """
    Limiteur de débit basé sur une fenêtre glissante.
    Thread-safe dans un contexte asyncio (single-threaded event loop).
    """

    def __init__(self, max_calls: int, window: float) -> None:
        self._max_calls = max_calls
        self._window = window
        self._timestamps: deque[float] = deque()

    def is_allowed(self) -> bool:
        """
        Retourne True si le message est autorisé, False si le quota est dépassé.
        Les appels hors fenêtre sont automatiquement purgés.
        """
        now = time.monotonic()
        # Purge des timestamps expirés
        while self._timestamps and self._timestamps[0] < now - self._window:
            self._timestamps.popleft()

        if len(self._timestamps) >= self._max_calls:
            return False

        self._timestamps.append(now)
        return True


# ---------------------------------------------------------------------------
# Fonctions d'envoi d'événements sur le canal Redis Pub/Sub
# ---------------------------------------------------------------------------

async def _publish(redis: Redis, code: str, event_type: str, payload: dict) -> None:
    """Publie un événement JSON sur le canal Redis de la room."""
    message = json.dumps({"type": event_type, "payload": payload})
    await redis.publish(room_channel(code), message)


# ---------------------------------------------------------------------------
# Gestionnaires d'événements WebSocket entrants
# ---------------------------------------------------------------------------

async def _handle_vote_cast(
    redis: Redis,
    room_code: str,
    player_id: str,
    payload: dict,
    websocket: WebSocket,
) -> None:
    """Traite un vote émis par un joueur."""
    # Validation de la carte Fibonacci via Pydantic
    try:
        validated = WSVotePayload(**payload)
    except Exception:
        logger.warning(
            "Vote invalide reçu de %s dans la room %s : %s",
            player_id, room_code, payload,
        )
        await websocket.close(code=4002, reason="Carte de vote invalide.")
        return

    success = await cast_vote(redis, room_code, player_id, validated.vote, validated.justification)
    if not success:
        # La room est en état "revealed" ou n'existe plus : on ignore silencieusement
        return

    # Récupération du nom du joueur pour l'événement broadcast
    players = await get_players(redis, room_code)
    player_name = players.get(player_id, "Inconnu")

    # Broadcast du vote (vote masqué, seul has_voted=True est diffusé)
    await _publish(
        redis,
        room_code,
        "vote_cast",
        {"player_id": player_id, "player_name": player_name, "has_voted": True},
    )


async def _handle_votes_reveal(
    redis: Redis,
    room_code: str,
    player_id: str,
    websocket: WebSocket,
) -> None:
    """Révèle les votes (Scrum Master uniquement)."""
    results = await reveal_votes(redis, room_code, player_id)

    if results is None:
        # Non autorisé ou room inexistante
        logger.warning(
            "Tentative de révélation non autorisée : joueur %s dans room %s.",
            player_id, room_code,
        )
        # On informe le client sans le déconnecter (peut être une erreur UI)
        error_msg = json.dumps({
            "type": "error",
            "payload": {"message": "Seul le Scrum Master peut révéler les votes."},
        })
        await websocket.send_text(error_msg)
        return

    await _publish(redis, room_code, "votes_reveal", {"votes": results})


async def _handle_set_task_name(
    redis: Redis,
    room_code: str,
    player_id: str,
    payload: dict,
    websocket: WebSocket,
) -> None:
    """Met à jour le nom de la tâche en cours (Scrum Master uniquement)."""
    try:
        validated = WSNewRoundPayload(**payload)
    except Exception:
        validated = WSNewRoundPayload()

    success = await set_task_name(redis, room_code, player_id, validated.task_name)

    if not success:
        error_msg = json.dumps({
            "type": "error",
            "payload": {"message": "Seul le Scrum Master peut nommer la tâche."},
        })
        await websocket.send_text(error_msg)
        return

    await _publish(redis, room_code, "task_name_updated", {"task_name": validated.task_name})


async def _handle_new_round(
    redis: Redis,
    room_code: str,
    player_id: str,
    payload: dict,
    websocket: WebSocket,
) -> None:
    """Lance un nouveau round (Scrum Master uniquement)."""
    try:
        validated = WSNewRoundPayload(**payload)
    except Exception:
        validated = WSNewRoundPayload()  # task_name vide par défaut

    new_round = await start_new_round(redis, room_code, player_id, validated.task_name)

    if new_round is None:
        logger.warning(
            "Tentative de nouveau round non autorisée : joueur %s dans room %s.",
            player_id, room_code,
        )
        error_msg = json.dumps({
            "type": "error",
            "payload": {"message": "Seul le Scrum Master peut lancer un nouveau round."},
        })
        await websocket.send_text(error_msg)
        return

    await _publish(redis, room_code, "new_round", {"round": new_round, "task_name": validated.task_name})


# ---------------------------------------------------------------------------
# Endpoint WebSocket principal
# ---------------------------------------------------------------------------

@router.websocket("/ws/{room_code}")
async def websocket_endpoint(
    websocket: WebSocket,
    room_code: str,
    player_id: str = Query(..., description="Identifiant unique du joueur"),
    token: str = Query(..., description="Token de session HMAC"),
    redis: Redis = Depends(get_redis),
) -> None:
    """
    Point d'entrée WebSocket principal.

    Authentification par token HMAC avant acceptation de la connexion.
    """
    # --- Validation du format du code room (avant toute logique) ---
    if not ROOM_CODE_REGEX.match(room_code.upper()):
        logger.warning("Code room invalide dans l'URL WebSocket : %s", room_code)
        await websocket.close(code=4000, reason="Code room invalide.")
        return

    room_code = room_code.upper()

    # --- Validation du token de session ---
    if not verify_session_token(room_code, player_id, token):
        logger.warning(
            "Token de session invalide pour player_id=%s, room=%s.",
            player_id, room_code,
        )
        await websocket.close(code=4001, reason="Token de session invalide.")
        return

    # --- Vérification de l'existence de la room ---
    if not await room_exists(redis, room_code):
        logger.warning(
            "Connexion WebSocket à une room inexistante : %s (player=%s).",
            room_code, player_id,
        )
        await websocket.close(code=4004, reason="Room introuvable.")
        return

    # --- Acceptation de la connexion ---
    await websocket.accept()
    logger.info("WebSocket accepté pour player %s dans room %s.", player_id, room_code)

    # --- Envoi de l'état initial de la room ---
    state = await build_room_state(redis, room_code)
    if state:
        await websocket.send_text(json.dumps({"type": "room_state", "payload": state}))

    # --- Annonce player_join aux autres participants ---
    players = await get_players(redis, room_code)
    roles = await get_player_roles(redis, room_code)
    await _publish(
        redis,
        room_code,
        "player_join",
        {
            "player_id": player_id,
            "player_name": players.get(player_id, "Inconnu"),
            "role": roles.get(player_id, "dev"),
            "players": [
                {"player_id": pid, "player_name": name, "role": roles.get(pid, "dev")}
                for pid, name in players.items()
            ],
        },
    )

    # --- Abonnement au canal Pub/Sub de la room ---
    pubsub = redis.pubsub()
    await pubsub.subscribe(room_channel(room_code))

    rate_limiter = _SlidingWindowRateLimiter(
        max_calls=WS_RATE_LIMIT_MAX,
        window=WS_RATE_LIMIT_WINDOW,
    )

    # -----------------------------------------------------------------------
    # Tâche 1 : Pub/Sub Redis → WebSocket client
    # Diffuse à ce client tous les messages broadcast de la room.
    # -----------------------------------------------------------------------
    async def pubsub_to_ws() -> None:
        try:
            async for message in pubsub.listen():
                if message["type"] == "message":
                    try:
                        await websocket.send_text(message["data"])
                    except Exception:
                        # La connexion WebSocket est fermée côté client
                        break
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.debug("pubsub_to_ws terminé : %s", exc)

    # -----------------------------------------------------------------------
    # Tâche 2 : WebSocket client → traitement + Redis Pub/Sub
    # -----------------------------------------------------------------------
    async def ws_to_handler() -> None:
        while True:
            try:
                # Timeout d'inactivité de 30 minutes
                raw = await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=float(INACTIVITY_TIMEOUT),
                )
            except asyncio.TimeoutError:
                logger.info(
                    "Timeout d'inactivité atteint pour player %s dans room %s.",
                    player_id, room_code,
                )
                await websocket.close(code=4003, reason="Déconnexion pour inactivité (30 min).")
                return
            except WebSocketDisconnect:
                return
            except Exception:
                return

            # --- Rate limiting ---
            if not rate_limiter.is_allowed():
                logger.warning(
                    "Rate limit WebSocket atteint pour player %s dans room %s.",
                    player_id, room_code,
                )
                await websocket.close(code=4029, reason="Trop de messages. Ralentissez.")
                return

            # --- Parsing JSON ---
            try:
                raw_dict = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning(
                    "Payload WebSocket non-JSON reçu de player %s dans room %s : %.100s",
                    player_id, room_code, raw,
                )
                await websocket.close(code=4002, reason="Payload JSON invalide.")
                return

            # --- Validation du message via Pydantic ---
            try:
                msg = WSIncomingMessage(**raw_dict)
            except Exception as exc:
                logger.warning(
                    "Message WebSocket invalide de player %s dans room %s : %s",
                    player_id, room_code, exc,
                )
                await websocket.close(code=4002, reason="Structure de message invalide.")
                return

            # --- Dispatch selon le type ---
            if msg.type == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))

            elif msg.type == "vote_cast":
                await _handle_vote_cast(redis, room_code, player_id, msg.payload, websocket)

            elif msg.type == "votes_reveal":
                await _handle_votes_reveal(redis, room_code, player_id, websocket)

            elif msg.type == "set_task_name":
                await _handle_set_task_name(redis, room_code, player_id, msg.payload, websocket)

            elif msg.type == "new_round":
                await _handle_new_round(redis, room_code, player_id, msg.payload, websocket)

    # -----------------------------------------------------------------------
    # Exécution concurrente des deux tâches
    # -----------------------------------------------------------------------
    task_pubsub = asyncio.create_task(pubsub_to_ws())
    task_ws = asyncio.create_task(ws_to_handler())

    try:
        # On attend que l'une des deux tâches se termine (déconnexion ou erreur)
        done, pending = await asyncio.wait(
            {task_pubsub, task_ws},
            return_when=asyncio.FIRST_COMPLETED,
        )
    finally:
        # Annulation des tâches encore actives
        for task in pending if "pending" in dir() else [task_pubsub, task_ws]:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

        # Désabonnement Redis Pub/Sub
        try:
            await pubsub.unsubscribe(room_channel(room_code))
            await pubsub.aclose()
        except Exception:
            pass

        # Retrait du joueur de la room + broadcast player_leave
        try:
            players_before = await get_players(redis, room_code)
            player_name = players_before.get(player_id, "Inconnu")
            await remove_player(redis, room_code, player_id)
            players_after = await get_players(redis, room_code)

            await _publish(
                redis,
                room_code,
                "player_leave",
                {
                    "player_id": player_id,
                    "player_name": player_name,
                    "players": [
                        {"player_id": pid, "player_name": name}
                        for pid, name in players_after.items()
                    ],
                },
            )
        except Exception as exc:
            logger.debug("Erreur lors du cleanup player_leave : %s", exc)

        logger.info("WebSocket fermé pour player %s dans room %s.", player_id, room_code)
