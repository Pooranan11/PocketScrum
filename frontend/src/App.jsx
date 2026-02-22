import { useState, useCallback } from 'react'
import Dashboard from './views/Dashboard.jsx'
import Home from './views/Home.jsx'
import Room from './views/Room.jsx'
import Velocity from './views/Velocity.jsx'
import './App.css'

export default function App() {
  const [view, setView] = useState('dashboard') // 'dashboard' | 'game' | 'velocity'
  // session : { room_code, player_id, token, is_scrum_master }
  const [session, setSession] = useState(null)

  const handleSelectTool = useCallback((tool) => {
    if (tool === 'planning-poker') setView('game')
    if (tool === 'velocity') setView('velocity')
  }, [])

  const handleJoin = useCallback((s) => setSession(s), [])

  const handleLeave = useCallback(() => setSession(null), [])

  const handleBack = useCallback(() => {
    setSession(null)
    setView('dashboard')
  }, [])

  if (view === 'dashboard') {
    return (
      <div className="app">
        <Dashboard onSelectTool={handleSelectTool} />
      </div>
    )
  }

  if (view === 'velocity') {
    return (
      <div className="app">
        <Velocity onBack={handleBack} />
      </div>
    )
  }

  return (
    <div className="app">
      {session
        ? <Room session={session} onLeave={handleLeave} />
        : <Home onJoin={handleJoin} onBack={handleBack} />
      }
    </div>
  )
}
