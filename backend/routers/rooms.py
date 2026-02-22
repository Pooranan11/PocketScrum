"""
Router REST pour la gestion des rooms.

Endpoints :
  POST /api/rooms         → Créer une room (Scrum Master)
  POST /api/rooms/{code}/join → Rejoindre une room existante

Le rate limiting est appliqué via slowapi sur chaque route.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from redis.asyncio import Redis
from slowapi import Limiter
from slowapi.util import get_remote_address

from core.redis import get_redis
from core.security import generate_player_id, generate_session_token
from models.schemas import (
    CreateRoomRequest,
    CreateRoomResponse,
    JoinRoomRequest,
    JoinRoomResponse,
    _validate_room_code,
)
from services.room import create_room, join_room

logger = logging.getLogger(__name__)

limiter = Limiter(key_func=get_remote_address)

router = APIRouter(prefix="/api", tags=["rooms"])


@router.post(
    "/rooms",
    response_model=CreateRoomResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Créer une nouvelle room de planning poker",
)
@limiter.limit("10/minute")
async def create_room_endpoint(
    request: Request,
    body: CreateRoomRequest,
    redis: Redis = Depends(get_redis),
) -> CreateRoomResponse:
    """
    Crée une room et retourne :
    - Le code unique de 4 lettres
    - L'identifiant du joueur (Scrum Master)
    - Le token de session pour l'authentification WebSocket
    """
    player_id = generate_player_id()
    room_code = await create_room(redis, player_id, body.player_name)
    token = generate_session_token(room_code, player_id)

    logger.info("Room %s créée par Scrum Master %s.", room_code, player_id)
    return CreateRoomResponse(
        room_code=room_code,
        player_id=player_id,
        token=token,
        is_scrum_master=True,
    )


@router.post(
    "/rooms/{room_code}/join",
    response_model=JoinRoomResponse,
    status_code=status.HTTP_200_OK,
    summary="Rejoindre une room existante",
)
@limiter.limit("20/minute")
async def join_room_endpoint(
    request: Request,
    room_code: str,
    body: JoinRoomRequest,
    redis: Redis = Depends(get_redis),
) -> JoinRoomResponse:
    """
    Rejoint une room existante et retourne :
    - L'identifiant du joueur
    - Le token de session pour l'authentification WebSocket
    """
    try:
        validated_code = _validate_room_code(room_code)
    except ValueError as e:
        logger.warning("Code room invalide dans l'URL : %s", room_code)
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))

    # Cohérence entre path param et body
    if validated_code != body.room_code.upper():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Le code room dans l'URL et dans le corps ne correspondent pas.",
        )

    player_id = generate_player_id()
    success = await join_room(redis, validated_code, player_id, body.player_name)

    if not success:
        logger.warning("Tentative de rejoindre une room inexistante : %s", validated_code)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Room '{validated_code}' introuvable ou expirée.",
        )

    token = generate_session_token(validated_code, player_id)

    logger.info("Joueur %s a rejoint la room %s.", player_id, validated_code)
    return JoinRoomResponse(
        room_code=validated_code,
        player_id=player_id,
        token=token,
        is_scrum_master=False,
    )
