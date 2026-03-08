import { useState, useRef, useEffect, useCallback } from 'react'
import styles from './ToolBarrel.module.css'

const TOOLS = [
  {
    id: 'planning-poker',
    icon: '🃏',
    name: 'Planning Poker',
    description: 'Estimez vos user stories en équipe, en temps réel.',
  },
  {
    id: 'velocity',
    icon: '📈',
    name: 'Planificateur de sprint',
    description: 'Planifiez la vélocité et la capacité de votre équipe sprint après sprint.',
  },
  {
    id: 'retro',
    icon: '🔁',
    name: 'Rétro sprint',
    description: 'Évaluez les objectifs du sprint : statut atteint/partiel/non atteint.',
  },
  {
    id: 'visualisation',
    icon: '📊',
    name: 'Visualisation',
    description: 'Importez un export Excel pour visualiser la charge et la répartition des tâches.',
  },
]

const N        = TOOLS.length
const GAP      = 10   // px between cards
const ANGLE    = 18   // degrees rotateX per step
const THROTTLE = 220  // ms between wheel events

// Modulo toujours positif
const mod = (n, m) => ((n % m) + m) % m

export default function ToolBarrel({ currentTool, onSelect, onChange }) {
  const initIdx = Math.max(0, TOOLS.findIndex(t => t.id === currentTool))
  // rawIdx est un entier continu (non borné) — on n'utilise jamais de modulo sur lui
  const [rawIdx, setRawIdx] = useState(initIdx)
  const [itemH,  setItemH]  = useState(220)
  const lastWheel            = useRef(0)
  const barrelRef            = useRef(null)
  const lastEmitted          = useRef(null)

  // Outil actuellement centré (pour les dots et la synchro externe)
  const currentIdx = mod(rawIdx, N)

  // Notifie App à chaque changement d'outil centré (scroll en temps réel)
  useEffect(() => {
    const toolId = TOOLS[currentIdx].id
    if (toolId !== lastEmitted.current) {
      lastEmitted.current = toolId
      onChange?.(toolId)
    }
  }, [currentIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  // Synchro si navigation externe (bouton retour, etc.)
  useEffect(() => {
    const i = TOOLS.findIndex(t => t.id === currentTool)
    if (i >= 0 && i !== currentIdx) {
      // On choisit la direction la plus courte pour rester continu
      const forward  = mod(i - currentIdx, N)
      const backward = mod(currentIdx - i, N)
      setRawIdx(r => r + (forward <= backward ? forward : -backward)) // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [currentTool]) // eslint-disable-line react-hooks/exhaustive-deps

  // Mesure dynamique du barrel → itemH
  useEffect(() => {
    const el = barrelRef.current
    if (!el) return
    const update = () => setItemH(Math.floor(el.clientHeight / 3))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const moveTo = useCallback((next) => setRawIdx(next), [])

  // Non-passive wheel
  useEffect(() => {
    const el = barrelRef.current
    if (!el) return
    const handler = (e) => {
      e.preventDefault()
      const now = Date.now()
      if (now - lastWheel.current < THROTTLE) return
      lastWheel.current = now
      setRawIdx(r => r + (e.deltaY > 0 ? 1 : -1))
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  const cardH = itemH - GAP

  // On rend les slots rawIdx-2 … rawIdx+2 (5 positions continues)
  const slots = [-2, -1, 0, 1, 2]

  return (
    <>
      <aside className={styles.sidebar}>
        <img src="/logo.png" alt="PocketScrum" className={styles.logo} />

        <div className={styles.barrelWrap} ref={barrelRef}>
          {slots.map((dist) => {
            const slotRaw  = rawIdx + dist
            const toolIdx  = mod(slotRaw, N)
            const tool     = TOOLS[toolIdx]
            const isCenter = dist === 0
            const ty       = dist * itemH
            const rx       = dist * -ANGLE
            const tz       = -Math.abs(dist) * 40
            const scale    = isCenter ? 1 : 0.77
            const opacity  = isCenter ? 1 : Math.max(0.22, 1 - Math.abs(dist) * 0.45)

            return (
              <button
                key={slotRaw}   // clé sur le slot continu → React anime la transition
                className={`${styles.card} ${isCenter ? styles.cardCenter : ''}`}
                style={{
                  height: `${cardH}px`,
                  transform: `translateY(calc(-50% + ${ty}px)) rotateX(${rx}deg) translateZ(${tz}px) scale(${scale})`,
                  opacity,
                }}
                onClick={() => isCenter ? onSelect(tool.id) : moveTo(slotRaw)}
                data-umami-event={isCenter ? 'tool-select' : undefined}
                data-umami-event-tool={isCenter ? tool.id : undefined}
              >
                <div className={styles.shimmer} />

                <div className={styles.iconContainer}>
                  <span className={styles.icon}>{tool.icon}</span>
                </div>

                <div className={styles.cardContent}>
                  <h2 className={styles.toolName}>{tool.name}</h2>
                  <p className={styles.toolDesc}>{tool.description}</p>
                </div>

                <div className={styles.cardFooter}>
                  <span className={styles.badge}>Disponible</span>
                  {isCenter && <span className={styles.cta}>Commencer →</span>}
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      {/* Scroll indicator — juste à droite de la colonne */}
      <div className={styles.scrollIndicator}>
        <button
          className={styles.arrowBtn}
          onClick={() => moveTo(rawIdx - 1)}
          title="Outil précédent"
        >▲</button>

        <div className={styles.dots}>
          {TOOLS.map((_, i) => (
            <span key={i} className={i === currentIdx ? styles.dotActive : styles.dot} />
          ))}
        </div>

        <button
          className={styles.arrowBtn}
          onClick={() => moveTo(rawIdx + 1)}
          title="Outil suivant"
        >▼</button>
      </div>
    </>
  )
}
