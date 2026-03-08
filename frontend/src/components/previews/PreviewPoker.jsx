import { useState, useEffect } from 'react'
import styles from './PreviewPoker.module.css'

const PLAYERS = [
  { name: 'Alice',  role: 'SM', vote: '8',  angle: 270 },
  { name: 'Bob',    role: 'Dev', vote: '5', angle: 342 },
  { name: 'Clara',  role: 'Dev', vote: '8', angle: 54  },
  { name: 'David',  role: 'QA',  vote: '13',angle: 126 },
  { name: 'Emma',   role: 'Dev', vote: '8', angle: 198 },
]

const PHASES = ['voting', 'revealing', 'revealed', 'voting']
const PHASE_DURATION = [2000, 1800, 2500, 500]

export default function PreviewPoker() {
  const [phase, setPhase]       = useState('voting')
  const [revealed, setRevealed] = useState([])

  useEffect(() => {
    let phaseIdx = 0
    let timeouts = []

    const nextPhase = () => {
      phaseIdx = (phaseIdx + 1) % PHASES.length
      const p = PHASES[phaseIdx]
      setPhase(p)

      if (p === 'revealing') {
        PLAYERS.forEach((_, i) => {
          const t = setTimeout(() => setRevealed(r => [...r, i]), i * 320)
          timeouts.push(t)
        })
      }
      if (p === 'voting') {
        setRevealed([])
      }

      const t = setTimeout(nextPhase, PHASE_DURATION[phaseIdx])
      timeouts.push(t)
    }

    const t = setTimeout(nextPhase, PHASE_DURATION[0])
    timeouts.push(t)
    return () => timeouts.forEach(clearTimeout)
  }, [])

  return (
    <div className={styles.wrap}>
      {/* Table centrale */}
      <div className={styles.table}>
        <div className={styles.tableLabel}>
          {phase === 'revealed'
            ? <><span className={styles.tableMedian}>8</span><span className={styles.tableHint}>pts · consensus</span></>
            : <span className={styles.tableHint}>{phase === 'voting' ? 'Vote en cours…' : 'Révélation…'}</span>
          }
        </div>
      </div>

      {/* Joueurs en orbite */}
      {PLAYERS.map((p, i) => {
        const rad = (p.angle * Math.PI) / 180
        const r   = 110
        const x   = Math.cos(rad) * r
        const y   = Math.sin(rad) * r
        const isRevealed = revealed.includes(i)

        return (
          <div
            key={p.name}
            className={styles.player}
            style={{ transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))` }}
          >
            <div className={`${styles.card} ${isRevealed ? styles.cardRevealed : ''}`}>
              <div className={styles.cardFront}>{p.vote}</div>
              <div className={styles.cardBack}>?</div>
            </div>
            <div className={styles.playerName}>{p.name}</div>
          </div>
        )
      })}

      {/* Badge SM */}
      <div className={styles.smBadge}>Scrum Master</div>
    </div>
  )
}
