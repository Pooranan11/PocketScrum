import { useState, useEffect } from 'react'
import styles from './Velocity.module.css'
import { uid, fmtJ, fmtDate, parseFrDate } from '../utils.js'

const STORAGE_KEY = 'pocketscrum_velocity'

const loadSaved = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') }
  catch { return null }
}


/**
 * Parmi les membres disponibles, retourne celui avec le plus de capacité libre
 * pouvant absorber la tâche (excluant le membre source).
 */
function findBestTarget(taskEstimate, members, getAssigned, excludeMemberId) {
  let best = null
  let bestAvailable = -Infinity
  for (const m of members) {
    if (m.id === excludeMemberId) continue
    const available = parseFloat((m.capacity - getAssigned(m.id)).toFixed(2))
    if (available >= taskEstimate && available > bestAvailable) {
      best = m
      bestAvailable = available
    }
  }
  return best ? { member: best, available: bestAvailable } : null
}

/**
 * Trouve le sous-ensemble minimal de tâches à retirer pour couvrir le surplus.
 * Recherche exhaustive (faisable jusqu'à ~18 tâches par membre).
 */
function suggestRemovals(memberTasks, surplus) {
  if (surplus <= 0 || memberTasks.length === 0) return []

  const n = memberTasks.length

  if (n > 18) {
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
      const score = Math.round((total - surplus) * 10000) * 100 + count
      if (score < bestScore) {
        bestScore = score
        best = subset
      }
    }
  }

  return best ?? []
}

export default function Velocity({ onBack, onVisualize }) {
  const saved = loadSaved()
  const [sprint,     setSprint]     = useState(saved?.sprint     ?? { name: '', startDate: '', endDate: '' })
  const [devMembers, setDevMembers] = useState(saved?.devMembers ?? [])
  const [qaMembers,  setQaMembers]  = useState(saved?.qaMembers  ?? [])
  const [tasks,      setTasks]      = useState(saved?.tasks      ?? [])

  // Persistance automatique
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sprint, devMembers, qaMembers, tasks }))
  }, [sprint, devMembers, qaMembers, tasks])

  // Écoute les membres ajoutés par Room en arrière-plan
  useEffect(() => {
    const handleUpdate = () => {
      const fresh = loadSaved()
      setDevMembers(prev => {
        const extra = (fresh?.devMembers ?? []).filter(fm => !prev.some(m => m.name === fm.name))
        return extra.length > 0 ? [...prev, ...extra] : prev
      })
      setQaMembers(prev => {
        const extra = (fresh?.qaMembers ?? []).filter(fm => !prev.some(m => m.name === fm.name))
        return extra.length > 0 ? [...prev, ...extra] : prev
      })
    }
    window.addEventListener('pocketscrum-velocity-updated', handleUpdate)
    return () => window.removeEventListener('pocketscrum-velocity-updated', handleUpdate)
  }, [])

  // Formulaire membres Dev
  const [devName, setDevName] = useState('')
  const [devCap,  setDevCap]  = useState('5')

  // Formulaire membres QA
  const [qaName, setQaName] = useState('')
  const [qaCap,  setQaCap]  = useState('5')

  // Formulaire tâches
  const [tTitle,        setTTitle]        = useState('')
  const [tDevEst,       setTDevEst]       = useState('1')
  const [tQaEst,        setTQaEst]        = useState('0')
  const [tDevAssignee,  setTDevAssignee]  = useState('')
  const [tQaAssignee,   setTQaAssignee]   = useState('')
  const [tStartDate,    setTStartDate]    = useState('')
  const [tEndDate,      setTEndDate]      = useState('')

  // --- actions membres ---
  function addDevMember(e) {
    e.preventDefault()
    if (!devName.trim()) return
    setDevMembers(ms => [...ms, { id: uid(), name: devName.trim(), capacity: parseFloat(devCap) }])
    setDevName('')
    setDevCap('5')
  }

  function addQaMember(e) {
    e.preventDefault()
    if (!qaName.trim()) return
    setQaMembers(ms => [...ms, { id: uid(), name: qaName.trim(), capacity: parseFloat(qaCap) }])
    setQaName('')
    setQaCap('5')
  }

  function removeDevMember(id) {
    setDevMembers(ms => ms.filter(m => m.id !== id))
    setTasks(ts => ts.map(t => t.devAssigneeId === id ? { ...t, devAssigneeId: '' } : t))
  }

  function removeQaMember(id) {
    setQaMembers(ms => ms.filter(m => m.id !== id))
    setTasks(ts => ts.map(t => t.qaAssigneeId === id ? { ...t, qaAssigneeId: '' } : t))
  }

  function updateDevMember(id, changes) {
    setDevMembers(ms => ms.map(m => m.id === id ? { ...m, ...changes } : m))
  }

  function updateQaMember(id, changes) {
    setQaMembers(ms => ms.map(m => m.id === id ? { ...m, ...changes } : m))
  }

  // --- actions tâches ---
  function addTask(e) {
    e.preventDefault()
    if (!tTitle.trim()) return
    setTasks(ts => [...ts, {
      id: uid(),
      title: tTitle.trim(),
      devEstimate: parseFloat(tDevEst),
      qaEstimate:  parseFloat(tQaEst),
      devAssigneeId: tDevAssignee,
      qaAssigneeId:  tQaAssignee,
      startDate: tStartDate,
      endDate:   tEndDate,
    }])
    setTTitle('')
    setTDevEst('1')
    setTQaEst('0')
    setTDevAssignee('')
    setTQaAssignee('')
    setTStartDate('')
    setTEndDate('')
  }

  function removeTask(id) {
    setTasks(ts => ts.filter(t => t.id !== id))
  }

  function updateTask(id, changes) {
    setTasks(ts => ts.map(t => t.id === id ? { ...t, ...changes } : t))
  }

  // --- computed ---
  const devMemberAssigned = memberId =>
    tasks.filter(t => t.devAssigneeId === memberId).reduce((s, t) => s + (t.devEstimate ?? 0), 0)

  const qaMemberAssigned = memberId =>
    tasks.filter(t => t.qaAssigneeId === memberId).reduce((s, t) => s + (t.qaEstimate ?? 0), 0)

  const devTotalCapacity = devMembers.reduce((s, m) => s + m.capacity, 0)
  const qaTotalCapacity  = qaMembers.reduce((s, m) => s + m.capacity, 0)
  const devTotalPlanned  = tasks.reduce((s, t) => s + (t.devEstimate ?? 0), 0)
  const qaTotalPlanned   = tasks.reduce((s, t) => s + (t.qaEstimate  ?? 0), 0)
  const devTeamLoad      = devTotalCapacity > 0 ? Math.round((devTotalPlanned / devTotalCapacity) * 100) : 0
  const qaTeamLoad       = qaTotalCapacity  > 0 ? Math.round((qaTotalPlanned  / qaTotalCapacity)  * 100) : 0

  // Membres surchargés Dev
  const devOverloaded = devMembers
    .map(m => {
      const assigned = devMemberAssigned(m.id)
      const surplus  = parseFloat((assigned - m.capacity).toFixed(2))
      if (surplus <= 0) return null
      const memberTasks = tasks
        .filter(t => t.devAssigneeId === m.id)
        .map(t => ({ ...t, estimate: t.devEstimate ?? 0 }))
      const suggested   = suggestRemovals(memberTasks, surplus)
      const suggestedSum = suggested.reduce((s, t) => s + t.estimate, 0)
      const suggestedWithTargets = suggested.map(t => ({
        ...t,
        bestTarget: findBestTarget(t.devEstimate ?? 0, devMembers, devMemberAssigned, m.id),
      }))
      return { member: m, assigned, surplus, suggested: suggestedWithTargets, newLoad: parseFloat((assigned - suggestedSum).toFixed(2)) }
    })
    .filter(Boolean)

  // Membres surchargés QA
  const qaOverloaded = qaMembers
    .map(m => {
      const assigned = qaMemberAssigned(m.id)
      const surplus  = parseFloat((assigned - m.capacity).toFixed(2))
      if (surplus <= 0) return null
      const memberTasks = tasks
        .filter(t => t.qaAssigneeId === m.id)
        .map(t => ({ ...t, estimate: t.qaEstimate ?? 0 }))
      const suggested   = suggestRemovals(memberTasks, surplus)
      const suggestedSum = suggested.reduce((s, t) => s + t.estimate, 0)
      const suggestedWithTargets = suggested.map(t => ({
        ...t,
        bestTarget: findBestTarget(t.qaEstimate ?? 0, qaMembers, qaMemberAssigned, m.id),
      }))
      return { member: m, assigned, surplus, suggested: suggestedWithTargets, newLoad: parseFloat((assigned - suggestedSum).toFixed(2)) }
    })
    .filter(Boolean)

  async function exportExcel() {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const devMemberName = id => devMembers.find(m => m.id === id)?.name ?? '—'
    const qaMemberName  = id => qaMembers.find(m => m.id === id)?.name  ?? '—'

    // ── Onglet 1 : Résumé sprint ──
    const summaryData = [
      ['Sprint', sprint.name || '—'],
      ['Début', sprint.startDate ? fmtDate(sprint.startDate) : '—'],
      ['Fin',   sprint.endDate   ? fmtDate(sprint.endDate)   : '—'],
      [],
      ['Vélocité Dev planifiée (j)', parseFloat(devTotalPlanned.toFixed(2))],
      ['Vélocité QA planifiée (j)',  parseFloat(qaTotalPlanned.toFixed(2))],
      ['Capacité Dev totale (j)',    parseFloat(devTotalCapacity.toFixed(2))],
      ['Capacité QA totale (j)',     parseFloat(qaTotalCapacity.toFixed(2))],
      ['Charge équipe Dev (%)',      devTeamLoad],
      ['Charge équipe QA (%)',       qaTeamLoad],
    ]
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData)
    wsSummary['!cols'] = [{ wch: 28 }, { wch: 18 }]
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Résumé')

    // ── Onglet 2 : Capacité Dev ──
    const devCapHeader = ['Membre Dev', 'Capacité max (j)', 'Assigné (j)', 'Charge (%)', 'Statut']
    const devCapRows = devMembers.map(m => {
      const assigned = devMemberAssigned(m.id)
      const pct      = m.capacity > 0 ? Math.round((assigned / m.capacity) * 100) : 0
      const surplus  = parseFloat((assigned - m.capacity).toFixed(2))
      return [m.name, m.capacity, parseFloat(assigned.toFixed(2)), pct, surplus > 0 ? `Surchargé (+${fmtJ(surplus)})` : 'OK']
    })
    const wsDevCap = XLSX.utils.aoa_to_sheet([devCapHeader, ...devCapRows])
    wsDevCap['!cols'] = [{ wch: 20 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 22 }]
    XLSX.utils.book_append_sheet(wb, wsDevCap, 'Capacité Dev')

    // ── Onglet 3 : Capacité QA ──
    const qaCapHeader = ['Membre QA', 'Capacité max (j)', 'Assigné (j)', 'Charge (%)', 'Statut']
    const qaCapRows = qaMembers.map(m => {
      const assigned = qaMemberAssigned(m.id)
      const pct      = m.capacity > 0 ? Math.round((assigned / m.capacity) * 100) : 0
      const surplus  = parseFloat((assigned - m.capacity).toFixed(2))
      return [m.name, m.capacity, parseFloat(assigned.toFixed(2)), pct, surplus > 0 ? `Surchargé (+${fmtJ(surplus)})` : 'OK']
    })
    const wsQaCap = XLSX.utils.aoa_to_sheet([qaCapHeader, ...qaCapRows])
    wsQaCap['!cols'] = [{ wch: 20 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 22 }]
    XLSX.utils.book_append_sheet(wb, wsQaCap, 'Capacité QA')

    // ── Onglet 4 : Tâches ──
    const taskHeader = ['Tâche', 'Estimation Dev (j)', 'Estimation QA (j)', 'Assigné Dev', 'Assigné QA', 'Début', 'Fin']
    const taskRows = tasks.map(t => [
      t.title,
      t.devEstimate ?? 0,
      t.qaEstimate  ?? 0,
      t.devAssigneeId ? devMemberName(t.devAssigneeId) : '—',
      t.qaAssigneeId  ? qaMemberName(t.qaAssigneeId)   : '—',
      t.startDate ? fmtDate(t.startDate) : '—',
      t.endDate   ? fmtDate(t.endDate)   : '—',
    ])
    const wsTasks = XLSX.utils.aoa_to_sheet([taskHeader, ...taskRows])
    wsTasks['!cols'] = [{ wch: 34 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 12 }]
    XLSX.utils.book_append_sheet(wb, wsTasks, 'Tâches')

    const filename = `velocite${sprint.name ? '_' + sprint.name.replace(/\s+/g, '_') : ''}.xlsx`
    XLSX.writeFile(wb, filename)
  }

  function handleVisualize() {
    const devMemberName = id => devMembers.find(m => m.id === id)?.name ?? '—'
    const qaMemberName  = id => qaMembers.find(m => m.id === id)?.name  ?? '—'
    onVisualize({
      sprint: {
        name:          sprint.name || '',
        startDate:     sprint.startDate ? fmtDate(sprint.startDate) : '—',
        endDate:       sprint.endDate   ? fmtDate(sprint.endDate)   : '—',
        devTotalPlanned:  parseFloat(devTotalPlanned.toFixed(2)),
        qaTotalPlanned:   parseFloat(qaTotalPlanned.toFixed(2)),
        devTotalCapacity: parseFloat(devTotalCapacity.toFixed(2)),
        qaTotalCapacity:  parseFloat(qaTotalCapacity.toFixed(2)),
        devTeamLoad,
        qaTeamLoad,
      },
      devMembers: devMembers.map(m => {
        const assigned = devMemberAssigned(m.id)
        const pct      = m.capacity > 0 ? Math.round((assigned / m.capacity) * 100) : 0
        const surplus  = parseFloat((assigned - m.capacity).toFixed(2))
        return { name: m.name, capacity: m.capacity, assigned: parseFloat(assigned.toFixed(2)), load: pct, status: surplus > 0 ? `Surchargé (+${fmtJ(surplus)})` : 'OK' }
      }),
      qaMembers: qaMembers.map(m => {
        const assigned = qaMemberAssigned(m.id)
        const pct      = m.capacity > 0 ? Math.round((assigned / m.capacity) * 100) : 0
        const surplus  = parseFloat((assigned - m.capacity).toFixed(2))
        return { name: m.name, capacity: m.capacity, assigned: parseFloat(assigned.toFixed(2)), load: pct, status: surplus > 0 ? `Surchargé (+${fmtJ(surplus)})` : 'OK' }
      }),
      tasks: tasks.map(t => ({
        title:       t.title,
        devEstimate: t.devEstimate ?? 0,
        qaEstimate:  t.qaEstimate  ?? 0,
        devAssignee: t.devAssigneeId ? devMemberName(t.devAssigneeId) : '—',
        qaAssignee:  t.qaAssigneeId  ? qaMemberName(t.qaAssigneeId)   : '—',
        startDate:   t.startDate ? fmtDate(t.startDate) : '—',
        endDate:     t.endDate   ? fmtDate(t.endDate)   : '—',
      })),
    })
  }

  async function importExcel(e) {
    const file = e.target.files[0]
    if (!file) return
    const XLSX = await import('xlsx')
    const buf  = await file.arrayBuffer()
    const wb   = XLSX.read(buf, { type: 'array' })

    // Sprint
    const sumRows = XLSX.utils.sheet_to_json(wb.Sheets['Résumé'], { header: 1 })
    setSprint({
      name:      String(sumRows[0]?.[1] ?? ''),
      startDate: parseFrDate(String(sumRows[1]?.[1] ?? '')),
      endDate:   parseFrDate(String(sumRows[2]?.[1] ?? '')),
    })

    // Membres Dev
    const devCapRows = XLSX.utils.sheet_to_json(wb.Sheets['Capacité Dev'], { header: 1 })
    const importedDevMembers = (devCapRows ?? []).slice(1)
      .filter(r => r[0])
      .map(r => ({ id: uid(), name: String(r[0]), capacity: Number(r[1]) || 0 }))
    setDevMembers(importedDevMembers)

    // Membres QA
    const qaCapRows = XLSX.utils.sheet_to_json(wb.Sheets['Capacité QA'], { header: 1 })
    const importedQaMembers = (qaCapRows ?? []).slice(1)
      .filter(r => r[0])
      .map(r => ({ id: uid(), name: String(r[0]), capacity: Number(r[1]) || 0 }))
    setQaMembers(importedQaMembers)

    // Tâches
    const taskRows = XLSX.utils.sheet_to_json(wb.Sheets['Tâches'], { header: 1 })
    setTasks((taskRows ?? []).slice(1)
      .filter(r => r[0])
      .map(r => ({
        id:           uid(),
        title:        String(r[0]),
        devEstimate:  Number(r[1]) || 0,
        qaEstimate:   Number(r[2]) || 0,
        devAssigneeId: importedDevMembers.find(m => m.name === r[3])?.id ?? '',
        qaAssigneeId:  importedQaMembers.find(m => m.name === r[4])?.id  ?? '',
        startDate:    parseFrDate(String(r[5] ?? '')),
        endDate:      parseFrDate(String(r[6] ?? '')),
      }))
    )
    e.target.value = ''
  }

  const hasData = devMembers.length > 0 || qaMembers.length > 0 || tasks.length > 0 || sprint.name

  // Indicateur de complétude
  const completeness = [
    { label: 'Sprint nommé',       ok: !!sprint.name.trim() },
    { label: 'Dates renseignées',  ok: !!(sprint.startDate && sprint.endDate) },
    { label: `Équipe Dev${devMembers.length ? ` (${devMembers.length})` : ''}`, ok: devMembers.length > 0 },
    { label: `Équipe QA${qaMembers.length  ? ` (${qaMembers.length})`  : ''}`,  ok: qaMembers.length  > 0 },
    { label: `Tâches${tasks.length ? ` (${tasks.length})` : ''}`,                ok: tasks.length > 0 },
    { label: 'Tâches assignées',   ok: tasks.length > 0 && tasks.every(t => t.devAssigneeId && t.qaAssigneeId) },
  ]
  const completenessScore = completeness.filter(c => c.ok).length

  // --- rendu d'une section membres ---
  function MemberSection({ title, accentClass, members, onAdd, onRemove, onUpdate, nameVal, setNameVal, capVal, setCapVal, getAssigned }) {
    return (
      <section className={styles.section}>
        <h2 className={`${styles.sectionTitle} ${accentClass}`}>{title}</h2>

        <form className={styles.addForm} onSubmit={onAdd}>
          <input
            className={`${styles.input} ${styles.inputWide}`}
            value={nameVal}
            onChange={e => setNameVal(e.target.value)}
            placeholder="Prénom du membre"
            maxLength={30}
            required
          />
          <label className={styles.capLabel}>
            <input
              className={`${styles.input} ${styles.inputSmall}`}
              type="number"
              value={capVal}
              onChange={e => setCapVal(e.target.value)}
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
                  const assigned = getAssigned(m.id)
                  const pct      = m.capacity > 0 ? Math.round((assigned / m.capacity) * 100) : 0
                  const surplus  = parseFloat((assigned - m.capacity).toFixed(2))
                  const over     = surplus > 0
                  return (
                    <tr key={m.id}>
                      <td className={styles.memberName}>{m.name}</td>
                      <td>
                        <input
                          className={styles.inlineDateInput}
                          type="number"
                          value={m.capacity}
                          min="0.25"
                          step="0.25"
                          onChange={e => onUpdate(m.id, { capacity: parseFloat(e.target.value) || 0 })}
                          style={{ width: '70px' }}
                        />
                      </td>
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
                          onClick={() => onRemove(m.id)}
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
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <button className={styles.back} onClick={onBack}>← Retour</button>
        <h1 className={styles.title}>
          <span className={styles.titleWhite}>Planificateur</span>
          <span className={styles.titleAccent}> de sprint</span>
        </h1>
        <label className={styles.importBtn}>
          ↑ Importer Excel
          <input type="file" accept=".xlsx" onChange={importExcel} style={{ display: 'none' }} />
        </label>
      </div>

      <div className={styles.layout}>
        {/* ── Colonne gauche : Membres + Tâches ── */}
        <div className={styles.main}>

          {/* Section membres Dev */}
          <MemberSection
            title="Équipe Dev"
            accentClass={styles.stMembers}
            members={devMembers}
            onAdd={addDevMember}
            onRemove={removeDevMember}
            onUpdate={updateDevMember}
            nameVal={devName}
            setNameVal={setDevName}
            capVal={devCap}
            setCapVal={setDevCap}
            getAssigned={devMemberAssigned}
          />

          {/* Section membres QA */}
          <MemberSection
            title="Équipe QA / Fonc"
            accentClass={styles.stQa}
            members={qaMembers}
            onAdd={addQaMember}
            onRemove={removeQaMember}
            onUpdate={updateQaMember}
            nameVal={qaName}
            setNameVal={setQaName}
            capVal={qaCap}
            setCapVal={setQaCap}
            getAssigned={qaMemberAssigned}
          />

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
              <label className={styles.capLabel}>
                <input
                  className={`${styles.input} ${styles.inputSmall}`}
                  type="number"
                  value={tDevEst}
                  onChange={e => setTDevEst(e.target.value)}
                  min="0"
                  step="0.25"
                  required
                />
                <span className={styles.unit}>j Dev</span>
              </label>
              <label className={styles.capLabel}>
                <input
                  className={`${styles.input} ${styles.inputSmall}`}
                  type="number"
                  value={tQaEst}
                  onChange={e => setTQaEst(e.target.value)}
                  min="0"
                  step="0.25"
                  required
                />
                <span className={styles.unit}>j QA</span>
              </label>
              <select
                className={styles.select}
                value={tDevAssignee}
                onChange={e => setTDevAssignee(e.target.value)}
              >
                <option value="">— Dev —</option>
                {devMembers.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <select
                className={styles.select}
                value={tQaAssignee}
                onChange={e => setTQaAssignee(e.target.value)}
              >
                <option value="">— QA —</option>
                {qaMembers.map(m => (
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
                      <th>Est. Dev</th>
                      <th>Est. QA</th>
                      <th>Assigné Dev</th>
                      <th>Assigné QA</th>
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
                          <input
                            className={styles.inlineDateInput}
                            type="number"
                            value={t.devEstimate ?? 0}
                            onChange={e => updateTask(t.id, { devEstimate: parseFloat(e.target.value) || 0 })}
                            min="0"
                            step="0.25"
                            style={{ width: '60px' }}
                          />
                        </td>
                        <td>
                          <input
                            className={styles.inlineDateInput}
                            type="number"
                            value={t.qaEstimate ?? 0}
                            onChange={e => updateTask(t.id, { qaEstimate: parseFloat(e.target.value) || 0 })}
                            min="0"
                            step="0.25"
                            style={{ width: '60px' }}
                          />
                        </td>
                        <td>
                          <select
                            className={styles.inlineSelect}
                            value={t.devAssigneeId ?? ''}
                            onChange={e => updateTask(t.id, { devAssigneeId: e.target.value })}
                          >
                            <option value="">— Dev —</option>
                            {devMembers.map(m => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            className={styles.inlineSelect}
                            value={t.qaAssigneeId ?? ''}
                            onChange={e => updateTask(t.id, { qaAssigneeId: e.target.value })}
                          >
                            <option value="">— QA —</option>
                            {qaMembers.map(m => (
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
            <div className={styles.sprintHeader}>
              <h2 className={`${styles.sectionTitle} ${styles.stSprint}`}>Sprint</h2>
              {hasData && (
                <button
                  className={styles.resetBtn}
                  onClick={() => {
                    setSprint({ name: '', startDate: '', endDate: '' })
                    setDevMembers([])
                    setQaMembers([])
                    setTasks([])
                  }}
                >
                  Réinitialiser
                </button>
              )}
            </div>
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

          {/* Indicateur de complétude */}
          <section className={styles.section}>
            <div className={styles.completenessHeader}>
              <h2 className={`${styles.sectionTitle} ${styles.stCompleteness}`}>Statut</h2>
              <span className={`${styles.completenessScore} ${completenessScore === completeness.length ? styles.completenessScoreFull : ''}`}>
                {completenessScore}/{completeness.length}
              </span>
            </div>
            <ul className={styles.checkList}>
              {completeness.map(({ label, ok }) => (
                <li key={label} className={`${styles.checkItem} ${ok ? styles.checkOk : styles.checkKo}`}>
                  <span className={styles.checkIcon}>{ok ? '✓' : '✗'}</span>
                  {label}
                </li>
              ))}
            </ul>
          </section>

          {(devMembers.length > 0 || qaMembers.length > 0) && (
            <div className={styles.exportBtns}>
              <button className={styles.csvBtn} onClick={exportExcel}>↓ Excel</button>
              <button className={styles.vizBtn} onClick={handleVisualize}>Visualiser →</button>
            </div>
          )}

          {/* Résumé Dev */}
          <section className={`${styles.section} ${styles.summary}`}>
            <h2 className={`${styles.sectionTitle} ${styles.stSummary}`}>Résumé Dev</h2>
            <div className={styles.stats}>
              <div className={styles.stat}>
                <span className={styles.statVal}>{fmtJ(devTotalPlanned)}</span>
                <span className={styles.statLabel}>Vélocité planifiée</span>
              </div>
              <div className={styles.statDivider} />
              <div className={styles.stat}>
                <span className={styles.statVal}>{fmtJ(devTotalCapacity)}</span>
                <span className={styles.statLabel}>Capacité totale</span>
              </div>
              <div className={styles.statDivider} />
              <div className={styles.stat}>
                <span className={`${styles.statVal} ${devTeamLoad > 100 ? styles.statOver : ''}`}>
                  {devTeamLoad}%
                </span>
                <span className={styles.statLabel}>Charge équipe</span>
              </div>
            </div>
          </section>

          {/* Résumé QA */}
          <section className={`${styles.section} ${styles.summary}`}>
            <h2 className={`${styles.sectionTitle} ${styles.stQa}`}>Résumé QA / Fonc</h2>
            <div className={styles.stats}>
              <div className={styles.stat}>
                <span className={styles.statVal}>{fmtJ(qaTotalPlanned)}</span>
                <span className={styles.statLabel}>Vélocité planifiée</span>
              </div>
              <div className={styles.statDivider} />
              <div className={styles.stat}>
                <span className={styles.statVal}>{fmtJ(qaTotalCapacity)}</span>
                <span className={styles.statLabel}>Capacité totale</span>
              </div>
              <div className={styles.statDivider} />
              <div className={styles.stat}>
                <span className={`${styles.statVal} ${qaTeamLoad > 100 ? styles.statOver : ''}`}>
                  {qaTeamLoad}%
                </span>
                <span className={styles.statLabel}>Charge équipe</span>
              </div>
            </div>
          </section>

          {/* Rééquilibrage Dev */}
          {devOverloaded.length > 0 && (
            <aside className={styles.sidebar}>
              <div className={styles.sidebarHeader}>
                <span className={styles.sidebarIcon}>⚠️</span>
                <div>
                  <h2 className={styles.sidebarTitle}>Rééquilibrage Dev</h2>
                  <p className={styles.sidebarSubtitle}>
                    Suggestion pour ramener chaque Dev sous sa capacité.
                  </p>
                </div>
              </div>

              {devOverloaded.map(({ member, surplus, suggested, newLoad }) => {
                const newPct = member.capacity > 0 ? Math.round((newLoad / member.capacity) * 100) : 0
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
                          <span className={styles.suggTaskEst}>{fmtJ(t.devEstimate ?? 0)}</span>
                        </div>
                        {t.bestTarget ? (
                          <button
                            className={styles.suggReassignBtn}
                            onClick={() => updateTask(t.id, { devAssigneeId: t.bestTarget.member.id })}
                          >
                            → {t.bestTarget.member.name}
                          </button>
                        ) : (
                          <button
                            className={styles.suggRemoveBtn}
                            onClick={() => updateTask(t.id, { devAssigneeId: '' })}
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

          {/* Rééquilibrage QA */}
          {qaOverloaded.length > 0 && (
            <aside className={styles.sidebar}>
              <div className={styles.sidebarHeader}>
                <span className={styles.sidebarIcon}>⚠️</span>
                <div>
                  <h2 className={styles.sidebarTitle}>Rééquilibrage QA</h2>
                  <p className={styles.sidebarSubtitle}>
                    Suggestion pour ramener chaque QA sous sa capacité.
                  </p>
                </div>
              </div>

              {qaOverloaded.map(({ member, surplus, suggested, newLoad }) => {
                const newPct = member.capacity > 0 ? Math.round((newLoad / member.capacity) * 100) : 0
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
                          <span className={styles.suggTaskEst}>{fmtJ(t.qaEstimate ?? 0)}</span>
                        </div>
                        {t.bestTarget ? (
                          <button
                            className={styles.suggReassignBtn}
                            onClick={() => updateTask(t.id, { qaAssigneeId: t.bestTarget.member.id })}
                          >
                            → {t.bestTarget.member.name}
                          </button>
                        ) : (
                          <button
                            className={styles.suggRemoveBtn}
                            onClick={() => updateTask(t.id, { qaAssigneeId: '' })}
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
