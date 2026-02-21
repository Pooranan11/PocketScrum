import { useEffect, useRef, useCallback } from 'react'

// Détecte automatiquement ws:// en dev et wss:// en prod (HTTPS)
const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const WS_BASE = `${WS_PROTOCOL}//${window.location.host}`

/**
 * Hook WebSocket pour PocketScrum.
 * Gère la connexion, le heartbeat (ping/30s) et la reconnexion automatique.
 */
export function useWebSocket({ roomCode, playerId, token, onMessage, enabled }) {
  const wsRef = useRef(null)
  const pingRef = useRef(null)
  const reconnectRef = useRef(null)

  const connect = useCallback(() => {
    if (!enabled || !roomCode || !playerId || !token) return
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const url = `${WS_BASE}/ws/${roomCode}?player_id=${playerId}&token=${token}`
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
      // Reconnexion automatique après 2s si la fermeture n'est pas volontaire
      reconnectRef.current = setTimeout(connect, 2_000)
    }

    ws.onerror = () => ws.close()
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
