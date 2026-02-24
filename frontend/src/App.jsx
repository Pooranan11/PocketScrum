import { useState, useCallback, lazy, Suspense } from 'react'
import Dashboard from './views/Dashboard.jsx'
import Home from './views/Home.jsx'
import Room from './views/Room.jsx'
import Velocity from './views/Velocity.jsx'
import './App.css'

const Visualisation = lazy(() => import('./views/Visualisation.jsx'))

export default function App() {
  const [view,    setView]    = useState('dashboard') // 'dashboard' | 'game' | 'velocity' | 'visualisation'
  const [session, setSession] = useState(null)
  const [vizData, setVizData] = useState(null)

  const handleSelectTool = useCallback((tool) => {
    if (tool === 'planning-poker') setView('game')
    if (tool === 'velocity')       setView('velocity')
    if (tool === 'visualisation')  { setVizData(null); setView('visualisation') }
  }, [])

  const handleVisualize = useCallback((data) => {
    setVizData(data)
    setView('visualisation')
  }, [])

  const handleJoin    = useCallback((s) => { setSession(s); setView('game') }, [])
  const handleLeave   = useCallback(() => { setSession(null); setView('dashboard') }, [])
  const handleBack    = useCallback(() => { setSession(null); setView('dashboard') }, [])

  // SM : aller sur Vélocité sans couper le WebSocket (Room reste monté)
  const handleVelocityFromRoom = useCallback(() => setView('velocity'), [])

  // Retour depuis Vélocité : revenir à la room si session active, sinon dashboard
  const handleBackFromVelocity = useCallback(() => {
    if (session) setView('game')
    else handleBack()
  }, [session, handleBack])

  // ── Cas avec session active : Room TOUJOURS monté (WS reste connecté) ──
  // On affiche/masque via CSS selon la vue courante.
  if (session) {
    return (
      <>
        <div className="app" style={view !== 'game' ? { display: 'none' } : {}}>
          <Room
            session={session}
            onLeave={handleLeave}
            onVelocity={session.is_scrum_master ? handleVelocityFromRoom : undefined}
          />
        </div>
        {view === 'velocity' && (
          <div className="app" style={{ justifyContent: 'flex-start' }}>
            <Velocity onBack={handleBackFromVelocity} onVisualize={handleVisualize} />
          </div>
        )}
      </>
    )
  }

  // ── Cas sans session : navigation normale ──
  if (view === 'velocity') {
    return (
      <div className="app" style={{ justifyContent: 'flex-start' }}>
        <Velocity onBack={handleBack} onVisualize={handleVisualize} />
      </div>
    )
  }

  if (view === 'visualisation') {
    return (
      <Suspense fallback={<div className="app" />}>
        <div className="app" style={{ justifyContent: 'flex-start' }}>
          <Visualisation
            onBack={vizData ? () => setView('velocity') : handleBack}
            initialData={vizData}
          />
        </div>
      </Suspense>
    )
  }

  if (view === 'game') {
    return (
      <div className="app">
        <Home onJoin={handleJoin} onBack={handleBack} />
      </div>
    )
  }

  return (
    <div className="app">
      <Dashboard onSelectTool={handleSelectTool} />
    </div>
  )
}
