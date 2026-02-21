"""
Utilitaires de sécurité : génération et vérification des tokens de session.

Chaque joueur reçoit un token HMAC-SHA256 lié à (room_code, player_id).
Ce token est requis pour ouvrir une connexion WebSocket, empêchant toute
usurpation d'identité ou connexion non autorisée.
"""
import hashlib
import hmac
import secrets

from core.config import settings


def generate_player_id() -> str:
    """
    Génère un identifiant joueur unique et cryptographiquement sûr.
    Utilise secrets.token_urlsafe pour un ID URL-safe de ~22 caractères.
    """
    return secrets.token_urlsafe(16)


def generate_session_token(room_code: str, player_id: str) -> str:
    """
    Génère un token de session HMAC-SHA256 lié au couple (room_code, player_id).

    Le message signé inclut les deux identifiants pour éviter qu'un token
    valide dans une room soit réutilisable dans une autre.
    """
    message = f"{room_code}:{player_id}"
    return hmac.new(
        settings.SECRET_KEY.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def verify_session_token(room_code: str, player_id: str, token: str) -> bool:
    """
    Vérifie un token de session en comparaison temporellement constante
    (hmac.compare_digest) pour prévenir les attaques timing.

    Retourne True si le token est valide, False sinon.
    """
    if not token or not player_id or not room_code:
        return False
    expected = generate_session_token(room_code, player_id)
    return hmac.compare_digest(expected, token)
