import { useState, useEffect } from 'react'
import styles from './PreviewVelocity.module.css'

const MEMBERS = [
  { name: 'Alice',  role: 'Dev', capacity: 10, load: 8,  tasks: ['Auth', 'API REST'] },
  { name: 'Clara',  role: 'QA',  capacity: 8,  load: 4,  tasks: ['Test plan'] },
  { name: 'David',  role: 'Dev', capacity: 10, load: 13, tasks: ['Migration', 'CI/CD', 'Perf'] },
]

export default function PreviewVelocity() {
  const [animated, setAnimated] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 300)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.sprint}>Sprint 13</span>
        <span className={styles.pts}>Vélocité cible : <b>34 pts</b></span>
      </div>

      <div className={styles.members}>
        {MEMBERS.map(m => {
          const over   = m.load > m.capacity
          const barPct = animated ? 100 : 0

          return (
            <div key={m.name} className={`${styles.row} ${over ? styles.rowOver : ''}`}>
              <div className={styles.avatar}>{m.name[0]}</div>

              <div className={styles.info}>
                <div className={styles.topLine}>
                  <span className={styles.name}>{m.name}</span>
                  <span className={`${styles.role} ${m.role === 'QA' ? styles.roleQA : ''}`}>{m.role}</span>
                  <span className={styles.loadLabel}>
                    {m.load}/{m.capacity}j
                    {over && <span className={styles.warn}>⚠</span>}
                  </span>
                </div>

                <div className={styles.barTrack}>
                  <div
                    className={`${styles.bar} ${over ? styles.barOver : ''}`}
                    style={{ width: `${barPct}%` }}
                  />
                </div>

                <div className={styles.tasks}>
                  {m.tasks.map(t => (
                    <span key={t} className={styles.chip}>{t}</span>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
