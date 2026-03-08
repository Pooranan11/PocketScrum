import { useState, useEffect } from 'react'
import styles from './PreviewVisualisation.module.css'

const MEMBERS = [
  { name: 'Alice',  role: 'Dev', load: 80  },
  { name: 'Bob',    role: 'Dev', load: 100 },
  { name: 'Clara',  role: 'QA',  load: 45  },
  { name: 'David',  role: 'Dev', load: 128 },
  { name: 'Emma',   role: 'QA',  load: 60  },
]

const PIE = [
  { label: 'Dev',     pct: 58, color: '#6366f1' },
  { label: 'QA',      pct: 24, color: '#4ade80' },
  { label: 'Ops',     pct: 18, color: '#fbbf24' },
]

export default function PreviewVisualisation() {
  const [animated, setAnimated] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 200)
    return () => clearTimeout(t)
  }, [])

  // Simple conic-gradient for the pie
  let cumul = 0
  const conicParts = PIE.map(p => {
    const start = cumul
    cumul += p.pct
    return `${p.color} ${start}% ${cumul}%`
  }).join(', ')

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>Charge équipe</span>
        <span className={styles.sprint}>Sprint 13</span>
      </div>

      <div className={styles.body}>
        {/* Bar chart */}
        <div className={styles.chart}>
          {MEMBERS.map(m => {
            const over   = m.load > 100
            const height = animated ? Math.min(m.load, 130) : 0
            return (
              <div key={m.name} className={styles.barCol}>
                <div className={styles.barWrap}>
                  {over && <div className={styles.overMark} style={{ bottom: animated ? '100%' : 0 }}>⚠</div>}
                  <div
                    className={`${styles.bar} ${over ? styles.barOver : m.role === 'QA' ? styles.barQA : ''}`}
                    style={{ height: `${height}%` }}
                  />
                </div>
                <span className={styles.barName}>{m.name}</span>
                <span className={styles.barPct}>{m.load}%</span>
              </div>
            )
          })}
          {/* 100% line */}
          <div className={styles.limitLine} />
        </div>

        {/* Pie + legend */}
        <div className={styles.pieSection}>
          <div
            className={styles.pie}
            style={{ background: animated ? `conic-gradient(${conicParts})` : '#1e293b' }}
          />
          <div className={styles.legend}>
            {PIE.map(p => (
              <div key={p.label} className={styles.legendRow}>
                <span className={styles.legendDot} style={{ background: p.color }} />
                <span className={styles.legendLabel}>{p.label}</span>
                <span className={styles.legendPct}>{p.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
