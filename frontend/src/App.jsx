import { useState, useCallback } from 'react'
import Home from './views/Home.jsx'
import Room from './views/Room.jsx'
import './App.css'

export default function App() {
  // session : { room_code, player_id, token, is_scrum_master }
  const [session, setSession] = useState(null)

  const leave = useCallback(() => setSession(null), [])

  return (
    <div className="app">
      {session
        ? <Room session={session} onLeave={leave} />
        : <Home onJoin={setSession} />
      }
    </div>
  )
}
