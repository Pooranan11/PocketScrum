import { useState, useEffect } from 'react'
import styles from './PreviewRetro.module.css'

const OBJECTIVES = [
  { label: 'Déploiement v2.1',    status: 'done',    pct: 100 },
  { label: 'Tests automatisés',   status: 'partial',  pct: 72  },
  { label: 'Migration base de données', status: 'miss', pct: 20 },
]

const STATUS = {
  done:    { label: 'Atteint',     color: '#4ade80', bg: 'rgba(34,197,94,0.1)',  border: 'rgba(34,197,94,0.25)'  },
  partial: { label: 'Partiel',     color: '#fbbf24', bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.25)' },
  miss:    { label: 'Non atteint', color: '#f87171', bg: 'rgba(248,113,113,0.1)',border: 'rgba(248,113,113,0.25)'},
}

export default function PreviewRetro() {
  const [animated, setAnimated] = useState(false)
  const planned = 42
  const actual  = 38

  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 300)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.sprint}>Sprint 12</span>
        <span className={styles.dates}>12 – 26 fév. 2026</span>
      </div>

      {/* Velocity comparison */}
      <div className={styles.velocityBlock}>
        <div className={styles.velRow}>
          <span className={styles.velLabel}>Planifié</span>
          <div className={styles.velTrack}>
            <div className={styles.velBar} style={{ width: animated ? '100%' : '0%', background: 'rgba(99,102,241,0.5)' }} />
          </div>
          <span className={styles.velPts}>{planned} pts</span>
        </div>
        <div className={styles.velRow}>
          <span className={styles.velLabel}>Réel</span>
          <div className={styles.velTrack}>
            <div className={styles.velBar} style={{ width: animated ? `${Math.round((actual/planned)*100)}%` : '0%', background: '#818cf8', transitionDelay: '0.15s' }} />
          </div>
          <span className={styles.velPts}>{actual} pts</span>
        </div>
      </div>

      {/* Objectives */}
      <div className={styles.objectives}>
        {OBJECTIVES.map(obj => {
          const s = STATUS[obj.status]
          return (
            <div key={obj.label} className={styles.objRow}>
              <div className={styles.objInfo}>
                <span className={styles.objLabel}>{obj.label}</span>
                <span
                  className={styles.badge}
                  style={{ color: s.color, background: s.bg, borderColor: s.border }}
                >{s.label}</span>
              </div>
              <div className={styles.objTrack}>
                <div
                  className={styles.objBar}
                  style={{ width: animated ? `${obj.pct}%` : '0%', background: s.color }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
