// En dev : Vite proxifie /api → localhost:8000
// En prod : nginx proxifie /api → backend Docker
const BASE = '/api'

export async function createRoom(playerName, role) {
  const res = await fetch(`${BASE}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player_name: playerName, role }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail ?? 'Erreur lors de la création de la room')
  }
  return res.json() // { room_code, player_id, token, is_scrum_master, role }
}

export async function joinRoom(roomCode, playerName, role) {
  const res = await fetch(`${BASE}/rooms/${roomCode}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room_code: roomCode, player_name: playerName, role }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail ?? 'Room introuvable ou expirée')
  }
  return res.json() // { room_code, player_id, token, is_scrum_master, role }
}

export async function getWsTicket(roomCode, playerId, token) {
  const res = await fetch(`${BASE}/rooms/${roomCode}/ws-ticket`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ player_id: playerId }),
  })
  if (!res.ok) {
    const err = new Error('Impossible d\'obtenir un ticket WebSocket')
    err.status = res.status
    throw err
  }
  const data = await res.json()
  return data.ticket
}
