import { useState, useCallback, lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import Home          from './views/Home.jsx'
import Room          from './views/Room.jsx'
import Velocity      from './views/Velocity.jsx'
import ToolLanding   from './views/ToolLanding.jsx'
import Footer        from './components/Footer.jsx'
import Background    from './components/Background.jsx'
import ToolBarrel    from './components/ToolBarrel.jsx'
import './App.css'

const Visualisation = lazy(() => import('./views/Visualisation.jsx'))
const Retro         = lazy(() => import('./views/Retro.jsx'))

// Map view → tool id for the barrel highlight
const VIEW_TO_TOOL = {
  'landing-planning-poker': 'planning-poker',
  'landing-velocity':       'velocity',
  'landing-retro':          'retro',
  'landing-visualisation':  'visualisation',
  'game':                   'planning-poker',
  'velocity':               'velocity',
  'retro':                  'retro',
  'visualisation':          'visualisation',
}

export default function App() {
  const [searchParams] = useSearchParams()
  const initialRoomCode = searchParams.get('room') ?? ''

  const [view,           setView]           = useState(initialRoomCode ? 'game' : 'landing-planning-poker')
  const [session,        setSession]        = useState(null)
  const [vizData,        setVizData]        = useState(null)
  const [barrelCollapsed, setBarrelCollapsed] = useState(() => window.innerWidth < 768)

  // Barrel scroll → met à jour la landing en temps réel uniquement depuis les landing pages
  const handleToolChange = useCallback((tool) => {
    setView(v => v.startsWith('landing-') ? `landing-${tool}` : v)
  }, [])

  // Clic sur la carte centrale = aller directement à l'outil
  const handleSelectTool = useCallback((tool) => {
    if (tool === 'planning-poker') { setView('game'); return }
    // Session active : on change la vue sans jamais détruire la session
    if (session) { setView(tool); return }
    // Pas de session : navigation normale
    if (tool === 'velocity')      setView('velocity')
    if (tool === 'retro')         setView('retro')
    if (tool === 'visualisation') setView('visualisation')
  }, [session])

  // Bouton "Commencer" sur la landing = idem
  const handleStart = useCallback((tool) => {
    if (tool !== 'planning-poker') setSession(null)
    if (tool === 'planning-poker') setView('game')
    if (tool === 'velocity')       setView('velocity')
    if (tool === 'retro')          setView('retro')
    if (tool === 'visualisation')  setView('visualisation')
  }, [])

  const handleVisualize = useCallback((data) => {
    setVizData(data)
    setView('visualisation')
  }, [])

  const handleJoin  = useCallback((s) => { setSession(s); setView('game') }, [])
  const handleLeave = useCallback(() => { setSession(null); setView('landing-planning-poker') }, [])
  const handleBack  = useCallback((tool = 'planning-poker') => {
    setSession(null)
    setView(`landing-${tool}`)
  }, [])

  // SM : switch to Velocity without dropping the WebSocket
  const handleVelocityFromRoom = useCallback(() => setView('velocity'), [])
  const handleBackFromVelocity = useCallback(() => {
    if (session) setView('game')
    else setView('landing-velocity')
  }, [session])

  const currentTool = VIEW_TO_TOOL[view] ?? 'planning-poker'

  // Derive landing tool from view name
  const landingTool = view.startsWith('landing-') ? view.replace('landing-', '') : null

  return (
    <>
      <Background />
      <ToolBarrel
        currentTool={currentTool}
        onSelect={handleSelectTool}
        onChange={handleToolChange}
        collapsed={barrelCollapsed}
        onToggle={() => setBarrelCollapsed(c => !c)}
      />

      <div className={`content${barrelCollapsed ? ' contentCollapsed' : ''}`}>

        {/* ── Landing pages ── */}
        {landingTool && (
          <div className="page pageTop">
            <ToolLanding tool={landingTool} onStart={() => handleStart(landingTool)} />
          </div>
        )}

        {/* ── Planning Poker ── */}
        {!landingTool && session ? (
          <>
            <div className="page" style={view !== 'game' ? { display: 'none' } : {}}>
              <Room
                session={session}
                onLeave={handleLeave}
                onVelocity={session.is_scrum_master ? handleVelocityFromRoom : undefined}
              />
            </div>

            {view === 'velocity' && (
              <div className="page pageTop">
                <Velocity onBack={handleBackFromVelocity} onVisualize={handleVisualize} />
              </div>
            )}

            {view === 'retro' && (
              <Suspense fallback={<div className="page" />}>
                <div className="page pageTop">
                  <Retro onBack={() => setView('game')} />
                </div>
              </Suspense>
            )}

            {view === 'visualisation' && (
              <Suspense fallback={<div className="page" />}>
                <div className="page pageTop">
                  <Visualisation
                    onBack={() => setView('velocity')}
                    initialData={vizData}
                  />
                </div>
              </Suspense>
            )}
          </>
        ) : !landingTool ? (
          <>
            {view === 'game' && (
              <div className="page">
                <Home onJoin={handleJoin} onBack={() => handleBack('planning-poker')} initialCode={initialRoomCode} />
              </div>
            )}

            {view === 'velocity' && (
              <div className="page pageTop">
                <Velocity onBack={() => handleBack('velocity')} onVisualize={handleVisualize} />
              </div>
            )}

            {view === 'retro' && (
              <Suspense fallback={<div className="page" />}>
                <div className="page pageTop">
                  <Retro onBack={() => handleBack('retro')} />
                </div>
              </Suspense>
            )}

            {view === 'visualisation' && (
              <Suspense fallback={<div className="page" />}>
                <div className="page pageTop">
                  <Visualisation
                    onBack={vizData ? () => setView('velocity') : () => handleBack('visualisation')}
                    initialData={vizData}
                  />
                </div>
              </Suspense>
            )}
          </>
        ) : null}
      </div>

      <Footer />
    </>
  )
}
