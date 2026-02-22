import { useState } from 'react'
import styles from './Velocity.module.css'

const ESTIMATES = [0.25, 0.5, 1, 2, 3, 5, 8]

let _id = 0
const uid = () => String(++_id)

const fmtJ = n => `${parseFloat(n.toFixed(2))}j`

export default function Velocity({ onBack }) {
  const [members, setMembers] = useState([])  // { id, name, capacity }
  const [tasks, setTasks]     = useState([])  // { id, title, estimate, assigneeId }

  const [mName, setMName] = useState('')
  const [mCap,  setMCap]  = useState('5')

  const [tTitle,    setTTitle]    = useState('')
  const [tEst,      setTEst]      = useState('1')
  const [tAssignee, setTAssignee] = useState('')

  // --- actions ---
  function addMember(e) {
    e.preventDefault()
    if (!mName.trim()) return
    setMembers(ms => [...ms, { id: uid(), name: mName.trim(), capacity: parseFloat(mCap) }])
    setMName('')
    setMCap('5')
  }

  function removeMember(id) {
    setMembers(ms => ms.filter(m => m.id !== id))
    setTasks(ts => ts.map(t => t.assigneeId === id ? { ...t, assigneeId: '' } : t))
  }

  function addTask(e) {
    e.preventDefault()
    if (!tTitle.trim()) return
    setTasks(ts => [...ts, {
      id: uid(),
      title: tTitle.trim(),
      estimate: parseFloat(tEst),
      assigneeId: tAssignee,
    }])
    setTTitle('')
    setTEst('1')
    setTAssignee('')
  }

  function removeTask(id) {
    setTasks(ts => ts.filter(t => t.id !== id))
  }

  // --- computed ---
  const totalCapacity = members.reduce((s, m) => s + m.capacity, 0)
  const totalPlanned  = tasks.reduce((s, t) => s + t.estimate, 0)
  const teamLoad      = totalCapacity > 0 ? Math.round((totalPlanned / totalCapacity) * 100) : 0

  function memberAssigned(memberId) {
    return tasks
      .filter(t => t.assigneeId === memberId)
      .reduce((s, t) => s + t.estimate, 0)
  }

  const hasSummary = members.length > 0 || tasks.length > 0

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <button className={styles.back} onClick={onBack}>← Retour</button>
        <h1 className={styles.title}>📈 Vélocité &amp; Capacité</h1>
      </div>

      {/* ── Membres ── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Membres de l'équipe</h2>

        <form className={styles.addForm} onSubmit={addMember}>
          <input
            className={styles.input}
            value={mName}
            onChange={e => setMName(e.target.value)}
            placeholder="Prénom du membre"
            maxLength={30}
            required
          />
          <label className={styles.capLabel}>
            <input
              className={`${styles.input} ${styles.inputSmall}`}
              type="number"
              value={mCap}
              onChange={e => setMCap(e.target.value)}
              min="0.25"
              step="0.25"
              required
            />
            <span className={styles.unit}>j dispo</span>
          </label>
          <button type="submit" className={styles.addBtn}>+ Ajouter</button>
        </form>

        {members.length > 0 && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Membre</th>
                  <th>Capa. max</th>
                  <th>Assigné</th>
                  <th>Charge</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {members.map(m => {
                  const assigned = memberAssigned(m.id)
                  const pct      = m.capacity > 0
                    ? Math.min(Math.round((assigned / m.capacity) * 100), 100)
                    : 0
                  const over = assigned > m.capacity
                  return (
                    <tr key={m.id}>
                      <td className={styles.memberName}>{m.name}</td>
                      <td>{fmtJ(m.capacity)}</td>
                      <td>{fmtJ(assigned)}</td>
                      <td>
                        <div className={styles.barRow}>
                          <div className={styles.barTrack}>
                            <div
                              className={`${styles.barFill} ${over ? styles.barOver : ''}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className={`${styles.pct} ${over ? styles.pctOver : ''}`}>
                            {pct}%
                          </span>
                        </div>
                      </td>
                      <td>
                        <button
                          className={styles.removeBtn}
                          onClick={() => removeMember(m.id)}
                          aria-label={`Retirer ${m.name}`}
                        >✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Tâches ── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Tâches du sprint</h2>

        <form className={styles.addForm} onSubmit={addTask}>
          <input
            className={`${styles.input} ${styles.inputWide}`}
            value={tTitle}
            onChange={e => setTTitle(e.target.value)}
            placeholder="Nom de la tâche"
            maxLength={60}
            required
          />
          <select
            className={styles.select}
            value={tEst}
            onChange={e => setTEst(e.target.value)}
          >
            {ESTIMATES.map(v => (
              <option key={v} value={v}>{v}j</option>
            ))}
          </select>
          <select
            className={styles.select}
            value={tAssignee}
            onChange={e => setTAssignee(e.target.value)}
          >
            <option value="">— Assigné —</option>
            {members.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <button type="submit" className={styles.addBtn}>+ Ajouter</button>
        </form>

        {tasks.length > 0 && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Tâche</th>
                  <th>Estimation</th>
                  <th>Assigné</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(t => (
                  <tr key={t.id}>
                    <td>{t.title}</td>
                    <td>{fmtJ(t.estimate)}</td>
                    <td>{members.find(m => m.id === t.assigneeId)?.name ?? <span className={styles.unassigned}>—</span>}</td>
                    <td>
                      <button
                        className={styles.removeBtn}
                        onClick={() => removeTask(t.id)}
                        aria-label="Supprimer la tâche"
                      >✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Résumé ── */}
      {hasSummary && (
        <section className={`${styles.section} ${styles.summary}`}>
          <h2 className={styles.sectionTitle}>Résumé du sprint</h2>
          <div className={styles.stats}>
            <div className={styles.stat}>
              <span className={styles.statVal}>{fmtJ(totalPlanned)}</span>
              <span className={styles.statLabel}>Vélocité planifiée</span>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.stat}>
              <span className={styles.statVal}>{fmtJ(totalCapacity)}</span>
              <span className={styles.statLabel}>Capacité totale</span>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.stat}>
              <span className={`${styles.statVal} ${teamLoad > 100 ? styles.statOver : ''}`}>
                {teamLoad}%
              </span>
              <span className={styles.statLabel}>Charge équipe</span>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
