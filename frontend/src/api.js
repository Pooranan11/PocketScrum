const BASE = 'http://localhost:8000/api'

export async function createRoom(playerName) {
  const res = await fetch(`${BASE}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player_name: playerName }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail ?? 'Erreur lors de la création de la room')
  }
  return res.json() // { room_code, player_id, token, is_scrum_master }
}

export async function joinRoom(roomCode, playerName) {
  const res = await fetch(`${BASE}/rooms/${roomCode}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room_code: roomCode, player_name: playerName }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail ?? 'Room introuvable ou expirée')
  }
  return res.json() // { room_code, player_id, token, is_scrum_master }
}
