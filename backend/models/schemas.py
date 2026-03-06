"""
Schémas Pydantic v2 pour la validation de tous les inputs entrants.

Politique de validation :
- Regex strictes sur chaque champ texte libre
- Longueurs maximales sur tous les champs
- Aucun caractère spécial autorisé dans les identifiants
- Les cartes de vote sont limitées à l'ensemble Fibonacci défini
"""
import re
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

# ---------------------------------------------------------------------------
# Constantes de validation
# ---------------------------------------------------------------------------

# Regex du nom de joueur : lettres (y compris accentuées), chiffres,
# espaces, tirets et underscores uniquement — longueur 1-30
PLAYER_NAME_REGEX = re.compile(r"^[a-zA-ZÀ-ÿ0-9 _\-]{1,30}$")

# Regex du nom de tâche : lettres, chiffres, espaces et ponctuation courante — longueur 1-60
TASK_NAME_REGEX = re.compile(r"^[a-zA-ZÀ-ÿ0-9 _\-\(\)\[\]#\.,!?:]{1,60}$")

# Regex du code room : exactement 4 lettres majuscules
ROOM_CODE_REGEX = re.compile(r"^[A-Z]{4}$")

# Cartes de vote Fibonacci autorisées (ensemble figé, immuable)
FIBONACCI_CARDS: frozenset[str] = frozenset({"1", "2", "3", "5", "8", "13", "21", "?", "☕"})

# Types de messages WebSocket acceptés (whitelist stricte)
WS_MESSAGE_TYPES: frozenset[str] = frozenset({"vote_cast", "votes_reveal", "new_round", "set_task_name", "ping"})


# ---------------------------------------------------------------------------
# Helpers de validation réutilisables
# ---------------------------------------------------------------------------

def _validate_player_name(v: str) -> str:
    """Valide et nettoie un nom de joueur."""
    v = v.strip()
    if not PLAYER_NAME_REGEX.match(v):
        raise ValueError(
            "Nom invalide : utilisez uniquement des lettres, chiffres, "
            "espaces, tirets (-) et underscores (_)."
        )
    return v


def _validate_room_code(v: str) -> str:
    """Valide et normalise un code room (force les majuscules)."""
    v = v.strip().upper()
    if not ROOM_CODE_REGEX.match(v):
        raise ValueError("Code room invalide : exactement 4 lettres majuscules (ex. ABCD).")
    return v


# ---------------------------------------------------------------------------
# Requêtes REST
# ---------------------------------------------------------------------------

class CreateRoomRequest(BaseModel):
    """Corps de la requête POST /api/rooms."""
    player_name: str = Field(..., min_length=1, max_length=30, description="Nom du Scrum Master")
    role: Literal["dev", "qa"] = Field(..., description="Rôle du Scrum Master : dev ou qa")

    @field_validator("player_name")
    @classmethod
    def validate_player_name(cls, v: str) -> str:
        return _validate_player_name(v)


class JoinRoomRequest(BaseModel):
    """Corps de la requête POST /api/rooms/{code}/join."""
    room_code: str = Field(..., min_length=4, max_length=4, description="Code de la room (4 lettres)")
    player_name: str = Field(..., min_length=1, max_length=30, description="Nom du joueur")
    role: Literal["dev", "qa"] = Field(..., description="Rôle du joueur : dev ou qa")

    @field_validator("room_code")
    @classmethod
    def validate_room_code(cls, v: str) -> str:
        return _validate_room_code(v)

    @field_validator("player_name")
    @classmethod
    def validate_player_name(cls, v: str) -> str:
        return _validate_player_name(v)


# ---------------------------------------------------------------------------
# Réponses REST
# ---------------------------------------------------------------------------

class CreateRoomResponse(BaseModel):
    """Réponse de POST /api/rooms."""
    room_code: str
    player_id: str
    token: str
    is_scrum_master: bool = True
    role: Literal["dev", "qa"]


class JoinRoomResponse(BaseModel):
    """Réponse de POST /api/rooms/{code}/join."""
    room_code: str
    player_id: str
    token: str
    is_scrum_master: bool = False
    role: Literal["dev", "qa"]


# ---------------------------------------------------------------------------
# Schémas WebSocket
# ---------------------------------------------------------------------------

class WSIncomingMessage(BaseModel):
    """
    Message entrant depuis un client WebSocket.
    Tout message ne respectant pas ce schéma entraîne une déconnexion immédiate.
    """
    type: str = Field(..., description="Type d'événement WebSocket")
    payload: dict = Field(default_factory=dict, description="Données associées au message")

    @field_validator("type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        if v not in WS_MESSAGE_TYPES:
            raise ValueError(
                f"Type de message inconnu : '{v}'. "
                f"Valeurs acceptées : {sorted(WS_MESSAGE_TYPES)}"
            )
        return v


class WSVotePayload(BaseModel):
    """Payload attendu pour l'événement vote_cast."""
    vote: str = Field(..., description="Carte Fibonacci choisie")
    justification: str = Field(default="", max_length=200)

    @field_validator("vote")
    @classmethod
    def validate_vote(cls, v: str) -> str:
        if v not in FIBONACCI_CARDS:
            raise ValueError(
                f"Vote invalide : '{v}'. "
                f"Cartes autorisées : {sorted(FIBONACCI_CARDS)}"
            )
        return v

    @field_validator("justification")
    @classmethod
    def clean_justification(cls, v: str) -> str:
        return v.strip()[:200]


class WsTicketRequest(BaseModel):
    """Corps de POST /api/rooms/{code}/ws-ticket."""
    player_id: str = Field(..., min_length=1, max_length=100)


class WSNewRoundPayload(BaseModel):
    """Payload attendu pour l'événement new_round."""
    task_name: str = Field(default="", max_length=60)

    @field_validator("task_name")
    @classmethod
    def validate_task_name(cls, v: str) -> str:
        v = v.strip()
        if v and not TASK_NAME_REGEX.match(v):
            raise ValueError("Nom de tâche invalide.")
        return v


# ---------------------------------------------------------------------------
# Modèles internes (états de room)
# ---------------------------------------------------------------------------

class PlayerInfo(BaseModel):
    """Informations publiques d'un joueur dans une room."""
    player_id: str
    player_name: str
    has_voted: bool = False
    role: Literal["dev", "qa"] = "dev"


class VoteResult(BaseModel):
    """Résultat de vote d'un joueur après révélation."""
    player_id: str
    player_name: str
    vote: Optional[str] = None
    justification: str = ""
    role: Literal["dev", "qa"] = "dev"


class RoomState(BaseModel):
    """État complet d'une room, envoyé au client lors de sa connexion."""
    room_code: str
    state: Literal["voting", "revealed"]
    round: int
    players: list[PlayerInfo]
    votes: Optional[list[VoteResult]] = None  # Non-null uniquement si state == "revealed"
    scrum_master_id: str
    task_name: str = ""
