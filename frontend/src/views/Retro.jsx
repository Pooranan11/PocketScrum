import { useState } from 'react'
import styles from './Retro.module.css'

const VELOCITY_KEY = 'pocketscrum_velocity'

const uid = () => crypto.randomUUID()

const fmtJ = n => `${parseFloat(n.toFixed(2))}j`

const fmtDate = d =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'

const parseFrDate = s => {
  if (!s || s === '—') return ''
  const parts = String(s).split('/')
  if (parts.length !== 3) return ''
  const [d, m, y] = parts
  return `20${y.padStart(2, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

function tasksFromVelocityData(data) {
  const devName = id => data.devMembers?.find(m => m.id === id)?.name ?? '—'
  const qaName  = id => data.qaMembers?.find(m => m.id === id)?.name  ?? '—'
  return (data.tasks ?? []).map(t => ({
    id:          t.id ?? uid(),
    title:       t.title,
    devEstimate: t.devEstimate ?? 0,
    qaEstimate:  t.qaEstimate  ?? 0,
    devAssignee: t.devAssigneeId ? devName(t.devAssigneeId) : '—',
    qaAssignee:  t.qaAssigneeId  ? qaName(t.qaAssigneeId)   : '—',
    status:      '',
    devActual:   t.devEstimate ?? 0,
    qaActual:    t.qaEstimate  ?? 0,
  }))
}

export default function Retro({ onBack }) {
  const [sprint, setSprint] = useState(null)
  const [tasks,  setTasks]  = useState([])
  const [loaded, setLoaded] = useState(false)

  // ── Chargement depuis localStorage ──
  function loadFromLS() {
    try {
      const raw = localStorage.getItem(VELOCITY_KEY)
      if (!raw) return alert('Aucune donnée de planificateur trouvée. Lance d\'abord un sprint dans le Planificateur.')
      const data = JSON.parse(raw)
      if (!data || typeof data !== 'object') return alert('Format de données invalide dans le stockage local.')
      if (!Array.isArray(data.tasks)) return alert('Structure de données inattendue : le champ "tasks" est absent ou invalide.')
      setSprint(data.sprint ?? { name: '', startDate: '', endDate: '' })
      setTasks(tasksFromVelocityData(data))
      setLoaded(true)
    } catch { alert('Erreur lors de la lecture des données du planificateur.') }
  }

  // ── Import Excel ──
  async function importExcel(e) {
    const file = e.target.files[0]
    if (!file) return
    const XLSX = await import('xlsx')
    const buf  = await file.arrayBuffer()
    const wb   = XLSX.read(buf, { type: 'array' })

    const sumRows  = XLSX.utils.sheet_to_json(wb.Sheets['Résumé'],   { header: 1 })
    const taskRows = XLSX.utils.sheet_to_json(wb.Sheets['Tâches'],   { header: 1 })

    setSprint({
      name:      String(sumRows[0]?.[1] ?? ''),
      startDate: parseFrDate(String(sumRows[1]?.[1] ?? '')),
      endDate:   parseFrDate(String(sumRows[2]?.[1] ?? '')),
    })

    setTasks((taskRows ?? []).slice(1).filter(r => r[0]).map(r => ({
      id:          uid(),
      title:       String(r[0]),
      devEstimate: Number(r[1]) || 0,
      qaEstimate:  Number(r[2]) || 0,
      devAssignee: r[3] ? String(r[3]) : '—',
      qaAssignee:  r[4] ? String(r[4]) : '—',
      status:      '',
      devActual:   Number(r[1]) || 0,
      qaActual:    Number(r[2]) || 0,
    })))
    setLoaded(true)
    e.target.value = ''
  }

  function updateTask(id, changes) {
    setTasks(ts => ts.map(t => t.id === id ? { ...t, ...changes } : t))
  }

  function toggleStatus(id, value) {
    setTasks(ts => ts.map(t => t.id === id ? { ...t, status: t.status === value ? '' : value } : t))
  }

  // ── Résumé ──
  const total      = tasks.length
  const atteint    = tasks.filter(t => t.status === 'atteint').length
  const partiel    = tasks.filter(t => t.status === 'partiel').length
  const nonAtteint = tasks.filter(t => t.status === 'non-atteint').length

  const devPlanned  = tasks.reduce((s, t) => s + (t.devEstimate ?? 0), 0)
  const qaPlanned   = tasks.reduce((s, t) => s + (t.qaEstimate  ?? 0), 0)
  const devActual   = tasks.reduce((s, t) => s + (t.devActual   ?? 0), 0)
  const qaActual    = tasks.reduce((s, t) => s + (t.qaActual    ?? 0), 0)
  const devDelta    = parseFloat((devActual - devPlanned).toFixed(2))
  const qaDelta     = parseFloat((qaActual  - qaPlanned).toFixed(2))

  // ── Écran de chargement ──
  if (!loaded) {
    return (
      <div className={styles.page}>
        <div className={styles.topBar}>
          <button className={styles.back} onClick={onBack}>← Retour</button>
          <h1 className={styles.title}>
            <span className={styles.titleWhite}>Rétro</span>
            <span className={styles.titleAccent}> sprint</span>
          </h1>
        </div>
        <div className={styles.loadScreen}>
          <p className={styles.loadTitle}>Charger les données du sprint</p>
          <p className={styles.loadDesc}>Utilise les données déjà saisies dans le Planificateur, ou importe un Excel précédemment exporté.</p>
          <div className={styles.loadActions}>
            <button className={styles.loadLsBtn} onClick={loadFromLS}>
              ↓ Depuis le planificateur
            </button>
            <label className={styles.loadXlsBtn}>
              ↑ Importer un Excel
              <input type="file" accept=".xlsx" onChange={importExcel} style={{ display: 'none' }} />
            </label>
          </div>
        </div>
      </div>
    )
  }

  // ── Vue principale ──
  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <button className={styles.back} onClick={onBack}>← Retour</button>
        <h1 className={styles.title}>
          <span className={styles.titleWhite}>Rétro</span>
          <span className={styles.titleAccent}>
            {sprint?.name ? ` — ${sprint.name}` : ' sprint'}
          </span>
        </h1>
        <label className={styles.importBtn}>
          ↑ Changer de source
          <input type="file" accept=".xlsx" onChange={importExcel} style={{ display: 'none' }} />
        </label>
      </div>

      <div className={styles.layout}>

        {/* ── Tableau des tâches ── */}
        <div className={styles.main}>
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={`${styles.sectionTitle} ${styles.stTasks}`}>Objectifs du sprint</h2>
              {sprint && (sprint.startDate || sprint.endDate) && (
                <span className={styles.sprintDates}>
                  {fmtDate(sprint.startDate)} → {fmtDate(sprint.endDate)}
                </span>
              )}
            </div>

            {tasks.length === 0 ? (
              <p className={styles.empty}>Aucune tâche chargée.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Tâche</th>
                      <th>Statut</th>
                      <th>Réel Dev</th>
                      <th>Réel QA</th>
                      <th>Est. Dev</th>
                      <th>Est. QA</th>
                      <th>Dev</th>
                      <th>QA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map(t => (
                      <tr
                        key={t.id}
                        className={
                          t.status === 'atteint'     ? styles.rowAtteint :
                          t.status === 'partiel'     ? styles.rowPartiel :
                          t.status === 'non-atteint' ? styles.rowNonAtteint : ''
                        }
                      >
                        <td className={styles.taskTitle}>{t.title}</td>
                        <td>
                          <div className={styles.statusBtns}>
                            <button
                              className={`${styles.statusBtn} ${t.status === 'atteint' ? styles.btnAtteint : ''}`}
                              onClick={() => toggleStatus(t.id, 'atteint')}
                              title="Atteint"
                            >✓</button>
                            <button
                              className={`${styles.statusBtn} ${t.status === 'partiel' ? styles.btnPartiel : ''}`}
                              onClick={() => toggleStatus(t.id, 'partiel')}
                              title="Partiel"
                            >~</button>
                            <button
                              className={`${styles.statusBtn} ${t.status === 'non-atteint' ? styles.btnNonAtteint : ''}`}
                              onClick={() => toggleStatus(t.id, 'non-atteint')}
                              title="Non atteint"
                            >✗</button>
                          </div>
                        </td>
                        <td>
                          <input
                            className={styles.actualInput}
                            type="number"
                            value={t.devActual ?? 0}
                            min="0" step="0.25"
                            onChange={e => updateTask(t.id, { devActual: parseFloat(e.target.value) || 0 })}
                          />
                        </td>
                        <td>
                          <input
                            className={styles.actualInput}
                            type="number"
                            value={t.qaActual ?? 0}
                            min="0" step="0.25"
                            onChange={e => updateTask(t.id, { qaActual: parseFloat(e.target.value) || 0 })}
                          />
                        </td>
                        <td className={styles.estimate}>{fmtJ(t.devEstimate ?? 0)}</td>
                        <td className={styles.estimate}>{fmtJ(t.qaEstimate  ?? 0)}</td>
                        <td className={`${styles.assignee} ${
                          t.devActual > t.devEstimate ? styles.assigneeOver :
                          (t.status === 'non-atteint' || t.status === 'partiel') ? styles.assigneeUnfinished : ''
                        }`}>{t.devAssignee}</td>
                        <td className={`${styles.assignee} ${
                          t.qaActual > t.qaEstimate ? styles.assigneeOver :
                          (t.status === 'non-atteint' || t.status === 'partiel') ? styles.assigneeUnfinished : ''
                        }`}>{t.qaAssignee}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* ── Panel résumé ── */}
        <div className={styles.rightPanel}>

          {/* Objectifs */}
          <section className={styles.section}>
            <h2 className={`${styles.sectionTitle} ${styles.stObjectifs}`}>Objectifs</h2>
            <div className={styles.objStats}>
              <div className={styles.objStat}>
                <span className={`${styles.objVal} ${styles.valAtteint}`}>{atteint}</span>
                <span className={styles.objLabel}>Atteints</span>
              </div>
              <div className={styles.objStat}>
                <span className={`${styles.objVal} ${styles.valPartiel}`}>{partiel}</span>
                <span className={styles.objLabel}>Partiels</span>
              </div>
              <div className={styles.objStat}>
                <span className={`${styles.objVal} ${styles.valNonAtteint}`}>{nonAtteint}</span>
                <span className={styles.objLabel}>Non atteints</span>
              </div>
            </div>
            {total > 0 && (
              <div className={styles.progressBar}>
                <div className={styles.progressAtteint}    style={{ width: `${(atteint    / total) * 100}%` }} />
                <div className={styles.progressPartiel}    style={{ width: `${(partiel    / total) * 100}%` }} />
                <div className={styles.progressNonAtteint} style={{ width: `${(nonAtteint / total) * 100}%` }} />
              </div>
            )}
            {total > 0 && (
              <p className={styles.objPct}>
                {Math.round(((atteint + partiel * 0.5) / total) * 100)}% de complétion
              </p>
            )}
          </section>

          {/* Vélocité Dev */}
          <section className={styles.section}>
            <h2 className={`${styles.sectionTitle} ${styles.stDev}`}>Vélocité Dev</h2>
            <div className={styles.veloRows}>
              <div className={styles.veloRow}>
                <span className={styles.veloLabel}>Planifié</span>
                <span className={styles.veloVal}>{fmtJ(devPlanned)}</span>
              </div>
              <div className={styles.veloRow}>
                <span className={styles.veloLabel}>Réel</span>
                <span className={styles.veloVal}>{fmtJ(devActual)}</span>
              </div>
              {devDelta !== 0 && (
                <div className={`${styles.veloDelta} ${devDelta > 0 ? styles.deltaOver : styles.deltaUnder}`}>
                  {devDelta > 0 ? '+' : ''}{fmtJ(devDelta)} vs estimé
                </div>
              )}
            </div>
          </section>

          {/* Vélocité QA */}
          <section className={styles.section}>
            <h2 className={`${styles.sectionTitle} ${styles.stQa}`}>Vélocité QA</h2>
            <div className={styles.veloRows}>
              <div className={styles.veloRow}>
                <span className={styles.veloLabel}>Planifié</span>
                <span className={styles.veloVal}>{fmtJ(qaPlanned)}</span>
              </div>
              <div className={styles.veloRow}>
                <span className={styles.veloLabel}>Réel</span>
                <span className={styles.veloVal}>{fmtJ(qaActual)}</span>
              </div>
              {qaDelta !== 0 && (
                <div className={`${styles.veloDelta} ${qaDelta > 0 ? styles.deltaOver : styles.deltaUnder}`}>
                  {qaDelta > 0 ? '+' : ''}{fmtJ(qaDelta)} vs estimé
                </div>
              )}
            </div>
          </section>

        </div>
      </div>
    </div>
  )
}
