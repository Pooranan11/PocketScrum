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

  return (
    <div className="app">
      {session
        ? <Room session={session} onLeave={handleLeave} />
        : <Home onJoin={handleJoin} onBack={handleBack} />
      }
    </div>
  )
}
