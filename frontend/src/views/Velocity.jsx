import { useState } from 'react'
import styles from './Velocity.module.css'

const ESTIMATES = [0.25, 0.5, 1, 2, 3, 5, 8]

const uid = () => crypto.randomUUID()

const fmtJ = n => `${parseFloat(n.toFixed(2))}j`

const fmtDate = d => d
  ? new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
  : '—'

/**
 * Parmi les membres disponibles, retourne celui avec le plus de capacité libre
 * pouvant absorber la tâche (excluant le membre source).
 * Retourne null si personne ne peut la prendre.
 */
function findBestTarget(task, members, getAssigned, excludeMemberId) {
  let best = null
  let bestAvailable = -Infinity
  for (const m of members) {
    if (m.id === excludeMemberId) continue
    const available = parseFloat((m.capacity - getAssigned(m.id)).toFixed(2))
    if (available >= task.estimate && available > bestAvailable) {
      best = m
      bestAvailable = available
    }
  }
  return best ? { member: best, available: bestAvailable } : null
}

/**
 * Trouve le sous-ensemble minimal de tâches à retirer pour couvrir le surplus.
 * Priorité : minimiser le dépassement (overshoot), puis le nombre de tâches.
 * Recherche exhaustive (faisable jusqu'à ~18 tâches par membre).
 */
function suggestRemovals(memberTasks, surplus) {
  if (surplus <= 0 || memberTasks.length === 0) return []

  const n = memberTasks.length

  if (n > 18) {
    // Fallback glouton pour de très grandes listes
    const sorted = [...memberTasks].sort((a, b) => b.estimate - a.estimate)
    const result = []
    let covered = 0
    for (const t of sorted) {
      if (covered >= surplus) break
      result.push(t)
      covered += t.estimate
    }
    return result
  }

  let best = null
  let bestScore = Infinity

  for (let mask = 1; mask < (1 << n); mask++) {
    let total = 0
    let count = 0
    const subset = []
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        total += memberTasks[i].estimate
        subset.push(memberTasks[i])
        count++
      }
    }
    if (total >= surplus) {
      // Score : overshoot (prioritaire) puis taille du sous-ensemble
      const score = Math.round((total - surplus) * 10000) * 100 + count
      if (score < bestScore) {
        bestScore = score
        best = subset
      }
    }
  }

  return best ?? []
}

export default function Velocity({ onBack }) {
  const [sprint,  setSprint]  = useState({ name: '', startDate: '', endDate: '' })
  const [members, setMembers] = useState([])  // { id, name, capacity }
  const [tasks, setTasks]     = useState([])  // { id, title, estimate, assigneeId, startDate, endDate }

  const [mName, setMName] = useState('')
  const [mCap,  setMCap]  = useState('5')

  const [tTitle,     setTTitle]     = useState('')
  const [tEst,       setTEst]       = useState('1')
  const [tAssignee,  setTAssignee]  = useState('')
  const [tStartDate, setTStartDate] = useState('')
  const [tEndDate,   setTEndDate]   = useState('')

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
      startDate: tStartDate,
      endDate: tEndDate,
    }])
    setTTitle('')
    setTEst('1')
    setTAssignee('')
    setTStartDate('')
    setTEndDate('')
  }

  function removeTask(id) {
    setTasks(ts => ts.filter(t => t.id !== id))
  }

  async function exportExcel() {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const memberName = id => members.find(m => m.id === id)?.name ?? '—'

    // ── Onglet 1 : Résumé sprint ──
    const summaryData = [
      ['Sprint', sprint.name || '—'],
      ['Début', sprint.startDate ? fmtDate(sprint.startDate) : '—'],
      ['Fin',   sprint.endDate   ? fmtDate(sprint.endDate)   : '—'],
      [],
      ['Vélocité planifiée (j)', parseFloat(totalPlanned.toFixed(2))],
      ['Capacité totale (j)',    parseFloat(totalCapacity.toFixed(2))],
      ['Charge équipe (%)',      teamLoad],
    ]
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData)
    wsSummary['!cols'] = [{ wch: 26 }, { wch: 18 }]
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Résumé')

    // ── Onglet 2 : Capacité membres ──
    const capHeader = ['Membre', 'Capacité max (j)', 'Assigné (j)', 'Charge (%)', 'Statut']
    const capRows = members.map(m => {
      const assigned = memberAssigned(m.id)
      const pct      = m.capacity > 0 ? Math.round((assigned / m.capacity) * 100) : 0
      const surplus  = parseFloat((assigned - m.capacity).toFixed(2))
      return [
        m.name,
        m.capacity,
        parseFloat(assigned.toFixed(2)),
        pct,
        surplus > 0 ? `Surchargé (+${fmtJ(surplus)})` : 'OK',
      ]
    })
    const wsCapacity = XLSX.utils.aoa_to_sheet([capHeader, ...capRows])
    wsCapacity['!cols'] = [{ wch: 20 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 22 }]
    XLSX.utils.book_append_sheet(wb, wsCapacity, 'Capacité')

    // ── Onglet 3 : Tâches ──
    const taskHeader = ['Tâche', 'Estimation (j)', 'Assigné à', 'Début', 'Fin']
    const taskRows = tasks.map(t => [
      t.title,
      t.estimate,
      t.assigneeId ? memberName(t.assigneeId) : '—',
      t.startDate  ? fmtDate(t.startDate)     : '—',
      t.endDate    ? fmtDate(t.endDate)        : '—',
    ])
    const wsTasks = XLSX.utils.aoa_to_sheet([taskHeader, ...taskRows])
    wsTasks['!cols'] = [{ wch: 34 }, { wch: 14 }, { wch: 20 }, { wch: 12 }, { wch: 12 }]
    XLSX.utils.book_append_sheet(wb, wsTasks, 'Tâches')

    const filename = `velocite${sprint.name ? '_' + sprint.name.replace(/\s+/g, '_') : ''}.xlsx`
    XLSX.writeFile(wb, filename)
  }

  function updateTask(id, changes) {
    setTasks(ts => ts.map(t => t.id === id ? { ...t, ...changes } : t))
  }

  // --- computed ---
  const totalCapacity = members.reduce((s, m) => s + m.capacity, 0)
  const totalPlanned  = tasks.reduce((s, t) => s + t.estimate, 0)
  const teamLoad      = totalCapacity > 0 ? Math.round((totalPlanned / totalCapacity) * 100) : 0

  const memberAssigned = memberId =>
    tasks.filter(t => t.assigneeId === memberId).reduce((s, t) => s + t.estimate, 0)

  // Membres surchargés + suggestions
  const overloaded = members
    .map(m => {
      const assigned = memberAssigned(m.id)
      const surplus  = parseFloat((assigned - m.capacity).toFixed(2))
      if (surplus <= 0) return null
      const memberTasks  = tasks.filter(t => t.assigneeId === m.id)
      const suggested    = suggestRemovals(memberTasks, surplus)
      const suggestedSum = suggested.reduce((s, t) => s + t.estimate, 0)
      // Pour chaque tâche suggérée, chercher le meilleur destinataire
      const suggestedWithTargets = suggested.map(t => ({
        ...t,
        bestTarget: findBestTarget(t, members, memberAssigned, m.id),
      }))
      return {
        member:  m,
        assigned,
        surplus,
        suggested: suggestedWithTargets,
        newLoad: parseFloat((assigned - suggestedSum).toFixed(2)),
      }
    })
    .filter(Boolean)

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <button className={styles.back} onClick={onBack}>← Retour</button>
        <h1 className={styles.title}>
          <span className={styles.titleWhite}>Vélocité</span>
          <span className={styles.titleAccent}> &amp; Capacité</span>
        </h1>
      </div>

      <div className={styles.layout}>
        {/* ── Colonne gauche : Membres + Tâches ── */}
        <div className={styles.main}>

          {/* Membres */}
          <section className={styles.section}>
            <h2 className={`${styles.sectionTitle} ${styles.stMembers}`}>Membres de l'équipe</h2>

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
                      const pct      = m.capacity > 0 ? Math.round((assigned / m.capacity) * 100) : 0
                      const surplus  = parseFloat((assigned - m.capacity).toFixed(2))
                      const over     = surplus > 0
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
                                  style={{ width: `${Math.min(pct, 100)}%` }}
                                />
                              </div>
                              <span className={`${styles.pct} ${over ? styles.pctOver : ''}`}>
                                {pct}%{over && <span className={styles.surplus}> (+{fmtJ(surplus)})</span>}
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

          {/* Tâches */}
          <section className={styles.section}>
            <h2 className={`${styles.sectionTitle} ${styles.stTasks}`}>Tâches du sprint</h2>

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
                  <option key={v} value={v}>{v}</option>
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
              <label className={styles.dateLabel}>
                <span className={styles.unit}>Début</span>
                <input
                  className={styles.input}
                  type="date"
                  value={tStartDate}
                  onChange={e => setTStartDate(e.target.value)}
                />
              </label>
              <label className={styles.dateLabel}>
                <span className={styles.unit}>Fin</span>
                <input
                  className={styles.input}
                  type="date"
                  value={tEndDate}
                  onChange={e => setTEndDate(e.target.value)}
                />
              </label>
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
                      <th>Début</th>
                      <th>Fin</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map(t => (
                      <tr key={t.id}>
                        <td>{t.title}</td>
                        <td>
                          <select
                            className={styles.inlineSelect}
                            value={t.estimate}
                            onChange={e => updateTask(t.id, { estimate: parseFloat(e.target.value) })}
                          >
                            {ESTIMATES.map(v => (
                              <option key={v} value={v}>{v}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            className={styles.inlineSelect}
                            value={t.assigneeId}
                            onChange={e => updateTask(t.id, { assigneeId: e.target.value })}
                          >
                            <option value="">— Assigné —</option>
                            {members.map(m => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            className={styles.inlineDateInput}
                            type="date"
                            value={t.startDate ?? ''}
                            onChange={e => updateTask(t.id, { startDate: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            className={styles.inlineDateInput}
                            type="date"
                            value={t.endDate ?? ''}
                            onChange={e => updateTask(t.id, { endDate: e.target.value })}
                          />
                        </td>
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

        </div>

        {/* ── Colonne droite : Sprint + Résumé + Rééquilibrage ── */}
        <div className={styles.rightPanel}>
          <section className={styles.section}>
            <h2 className={`${styles.sectionTitle} ${styles.stSprint}`}>Sprint</h2>
            <div className={styles.sprintForm}>
              <input
                className={`${styles.input} ${styles.inputWide}`}
                value={sprint.name}
                onChange={e => setSprint(s => ({ ...s, name: e.target.value }))}
                placeholder="Nom du sprint (ex : Sprint 3)"
                maxLength={50}
              />
              <label className={styles.dateLabel}>
                <span className={styles.unit}>Début</span>
                <input
                  className={styles.input}
                  type="date"
                  value={sprint.startDate}
                  onChange={e => setSprint(s => ({ ...s, startDate: e.target.value }))}
                />
              </label>
              <label className={styles.dateLabel}>
                <span className={styles.unit}>Fin</span>
                <input
                  className={styles.input}
                  type="date"
                  value={sprint.endDate}
                  onChange={e => setSprint(s => ({ ...s, endDate: e.target.value }))}
                />
              </label>
            </div>
          </section>

          {members.length > 0 && (
            <button className={styles.csvBtn} onClick={exportExcel}>
              ↓ Exporter Excel
            </button>
          )}

          <section className={`${styles.section} ${styles.summary}`}>
            <h2 className={`${styles.sectionTitle} ${styles.stSummary}`}>Résumé du sprint</h2>
            {(sprint.name || sprint.startDate || sprint.endDate) && (
              <div className={styles.sprintMeta}>
                {sprint.name && <span className={styles.sprintMetaName}>{sprint.name}</span>}
                {(sprint.startDate || sprint.endDate) && (
                  <span className={styles.sprintMetaDates}>
                    {fmtDate(sprint.startDate)} → {fmtDate(sprint.endDate)}
                  </span>
                )}
              </div>
            )}
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

          {overloaded.length > 0 && (
            <aside className={styles.sidebar}>
              <div className={styles.sidebarHeader}>
                <span className={styles.sidebarIcon}>⚠️</span>
                <div>
                  <h2 className={styles.sidebarTitle}>Rééquilibrage</h2>
                  <p className={styles.sidebarSubtitle}>
                    Suggestion pour ramener chaque membre sous sa capacité.
                  </p>
                </div>
              </div>

              {overloaded.map(({ member, surplus, suggested, newLoad }) => {
                const newPct = member.capacity > 0
                  ? Math.round((newLoad / member.capacity) * 100)
                  : 0
                return (
                  <div key={member.id} className={styles.suggCard}>
                    <div className={styles.suggHeader}>
                      <span className={styles.suggName}>{member.name}</span>
                      <span className={styles.suggBadge}>+{fmtJ(surplus)} surchargé</span>
                    </div>

                    <p className={styles.suggLabel}>Déplacer :</p>

                    {suggested.map(t => (
                      <div key={t.id} className={styles.suggTask}>
                        <div className={styles.suggTaskInfo}>
                          <span className={styles.suggTaskName}>{t.title}</span>
                          <span className={styles.suggTaskEst}>{fmtJ(t.estimate)}</span>
                        </div>
                        {t.bestTarget ? (
                          <button
                            className={styles.suggReassignBtn}
                            onClick={() => updateTask(t.id, { assigneeId: t.bestTarget.member.id })}
                          >
                            → {t.bestTarget.member.name}
                          </button>
                        ) : (
                          <button
                            className={styles.suggRemoveBtn}
                            onClick={() => updateTask(t.id, { assigneeId: '' })}
                          >
                            Désassigner
                          </button>
                        )}
                      </div>
                    ))}

                    <div className={styles.suggResult}>
                      Charge après :{' '}
                      <strong className={styles.suggResultVal}>
                        {fmtJ(newLoad)} / {fmtJ(member.capacity)}
                      </strong>
                      {' '}({newPct}%)
                    </div>
                  </div>
                )
              })}
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}
