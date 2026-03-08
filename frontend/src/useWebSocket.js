import { useEffect, useRef, useCallback } from 'react'
import { getWsTicket } from './api.js'

// Détecte automatiquement ws:// en dev et wss:// en prod (HTTPS)
const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const WS_BASE = `${WS_PROTOCOL}//${window.location.host}`

/**
 * Hook WebSocket pour PocketScrum.
 * Gère la connexion, le heartbeat (ping/30s) et la reconnexion automatique.
 * Utilise un ticket à usage unique (30s) au lieu du token HMAC dans l'URL
 * pour éviter l'exposition du token dans les logs serveur et l'historique navigateur.
 */
export function useWebSocket({ roomCode, playerId, token, onMessage, enabled }) {
  const wsRef = useRef(null)
  const pingRef = useRef(null)
  const reconnectRef = useRef(null)

  const connect = useCallback(() => {
    if (!enabled || !roomCode || !playerId || !token) return
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    // Obtenir un ticket à usage unique avant d'ouvrir la connexion WS.
    // Le ticket expire en 30s — il est demandé juste avant la connexion.
    getWsTicket(roomCode, playerId, token)
      .then(ticket => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return

        const url = `${WS_BASE}/ws/${roomCode}?player_id=${playerId}&ticket=${ticket}`
        const ws = new WebSocket(url)
        wsRef.current = ws

        ws.onopen = () => {
          // Heartbeat toutes les 25 secondes pour maintenir la connexion active
          pingRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping' }))
            }
          }, 25_000)
        }

        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data)
            if (msg.type !== 'pong') onMessage(msg)
          } catch {
            // ignore les messages non-JSON
          }
        }

        ws.onclose = () => {
          clearInterval(pingRef.current)
          // Reconnexion automatique après 2s : un nouveau ticket sera demandé
          reconnectRef.current = setTimeout(connect, 2_000)
        }

        ws.onerror = () => ws.close()
      })
      .catch((err) => {
        // Erreurs permanentes (room supprimée, auth invalide) : ne pas réessayer
        if (err.status === 404 || err.status === 401 || err.status === 403) return
        // Erreur réseau temporaire : réessayer après 3s
        reconnectRef.current = setTimeout(connect, 3_000)
      })
  }, [enabled, roomCode, playerId, token, onMessage])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectRef.current)
      clearInterval(pingRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  const send = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  return { send }
}
