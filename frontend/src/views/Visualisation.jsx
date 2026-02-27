import { useState, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts'
import styles from './Visualisation.module.css'

const DEV_COLORS = ['#6366f1', '#8b5cf6', '#06b6d4', '#14b8a6', '#3b82f6', '#a78bfa', '#67e8f9', '#93c5fd']
const QA_COLORS  = ['#f59e0b', '#f97316', '#ec4899', '#10b981', '#fbbf24', '#fb923c', '#f472b6', '#34d399']

function CustomBarTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className={styles.tooltip}>
      <p className={styles.tooltipLabel}>{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color, margin: 0 }}>{p.name} : {p.value}j</p>
      ))}
    </div>
  )
}

function CustomPieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  return (
    <div className={styles.tooltip}>
      <p style={{ color: payload[0].payload.fill, margin: 0 }}>
        {payload[0].name} : {payload[0].value}j
      </p>
    </div>
  )
}

async function parseExcel(file) {
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })

  // ── Résumé ──
  const sumRows = XLSX.utils.sheet_to_json(wb.Sheets['Résumé'], { header: 1 })
  const sprint = {
    name:             String(sumRows[0]?.[1] ?? ''),
    startDate:        sumRows[1]?.[1] ?? '—',
    endDate:          sumRows[2]?.[1] ?? '—',
    devTotalPlanned:  sumRows[4]?.[1] ?? 0,
    qaTotalPlanned:   sumRows[5]?.[1] ?? 0,
    devTotalCapacity: sumRows[6]?.[1] ?? 0,
    qaTotalCapacity:  sumRows[7]?.[1] ?? 0,
    devTeamLoad:      sumRows[8]?.[1] ?? 0,
    qaTeamLoad:       sumRows[9]?.[1] ?? 0,
  }

  // ── Capacité Dev ──
  const devCapRows = XLSX.utils.sheet_to_json(wb.Sheets['Capacité Dev'] ?? {}, { header: 1 })
  const devMembers = (devCapRows ?? []).slice(1)
    .map(r => ({ name: r[0], capacity: r[1], assigned: r[2], load: r[3], status: r[4] }))
    .filter(m => m.name)

  // ── Capacité QA ──
  const qaCapRows = XLSX.utils.sheet_to_json(wb.Sheets['Capacité QA'] ?? {}, { header: 1 })
  const qaMembers = (qaCapRows ?? []).slice(1)
    .map(r => ({ name: r[0], capacity: r[1], assigned: r[2], load: r[3], status: r[4] }))
    .filter(m => m.name)

  // ── Tâches ──
  const taskRows = XLSX.utils.sheet_to_json(wb.Sheets['Tâches'], { header: 1 })
  const tasks = (taskRows ?? []).slice(1)
    .map(r => ({
      title:       r[0],
      devEstimate: r[1] ?? 0,
      qaEstimate:  r[2] ?? 0,
      devAssignee: r[3],
      qaAssignee:  r[4],
      startDate:   r[5],
      endDate:     r[6],
    }))
    .filter(t => t.title)

  return { sprint, devMembers, qaMembers, tasks }
}

function MembersTable({ members, colors }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Membre</th>
            <th>Capacité max</th>
            <th>Assigné</th>
            <th>Charge</th>
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m, i) => {
            const over = m.status !== 'OK'
            return (
              <tr key={i}>
                <td>
                  <span className={styles.memberName}>
                    <span className={styles.memberDot} style={{ background: colors[i % colors.length] }} />
                    {m.name}
                  </span>
                </td>
                <td>{m.capacity}j</td>
                <td>{m.assigned}j</td>
                <td>
                  <div className={styles.barRow}>
                    <div className={styles.barTrack}>
                      <div
                        className={`${styles.barFill} ${over ? styles.barOver : ''}`}
                        style={{ width: `${Math.min(m.load, 100)}%` }}
                      />
                    </div>
                    <span className={`${styles.pct} ${over ? styles.pctOver : ''}`}>{m.load}%</span>
                  </div>
                </td>
                <td>
                  <span className={`${styles.badge} ${over ? styles.badgeOver : styles.badgeOk}`}>
                    {m.status}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function Visualisation({ onBack, initialData = null }) {
  const [data,     setData]     = useState(initialData)
  const [error,    setError]    = useState('')
  const [dragging, setDragging] = useState(false)

  const handleFile = useCallback(async (file) => {
    if (!file?.name.endsWith('.xlsx')) {
      setError('Veuillez importer un fichier .xlsx exporté depuis Vélocité & Capacité.')
      return
    }
    setError('')
    try {
      setData(await parseExcel(file))
    } catch {
      setError("Impossible de lire le fichier. Vérifiez qu'il s'agit d'un export PocketScrum.")
    }
  }, [])

  const onDrop  = useCallback(e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]) }, [handleFile])
  const onInput = useCallback(e => handleFile(e.target.files[0]), [handleFile])

  // ── Bar data ──
  const devBarData = (data?.devMembers ?? []).map(m => ({
    name: m.name, 'Capacité max': m.capacity, 'Assigné': m.assigned,
  }))
  const qaBarData = (data?.qaMembers ?? []).map(m => ({
    name: m.name, 'Capacité max': m.capacity, 'Assigné': m.assigned,
  }))

  // ── Pie Dev ──
  const devAssignedMap = {}
  data?.tasks.forEach(t => {
    if (t.devAssignee && t.devAssignee !== '—')
      devAssignedMap[t.devAssignee] = (devAssignedMap[t.devAssignee] ?? 0) + (t.devEstimate ?? 0)
  })
  const devUnassigned = data?.tasks.filter(t => !t.devAssignee || t.devAssignee === '—').reduce((s, t) => s + (t.devEstimate ?? 0), 0) ?? 0
  const devPieData = [
    ...Object.entries(devAssignedMap).map(([name, value]) => ({ name, value })),
    ...(devUnassigned > 0 ? [{ name: 'Non assigné', value: devUnassigned }] : []),
  ]

  // ── Pie QA ──
  const qaAssignedMap = {}
  data?.tasks.forEach(t => {
    if (t.qaAssignee && t.qaAssignee !== '—')
      qaAssignedMap[t.qaAssignee] = (qaAssignedMap[t.qaAssignee] ?? 0) + (t.qaEstimate ?? 0)
  })
  const qaUnassigned = data?.tasks.filter(t => !t.qaAssignee || t.qaAssignee === '—').reduce((s, t) => s + (t.qaEstimate ?? 0), 0) ?? 0
  const qaPieData = [
    ...Object.entries(qaAssignedMap).map(([name, value]) => ({ name, value })),
    ...(qaUnassigned > 0 ? [{ name: 'Non assigné', value: qaUnassigned }] : []),
  ]

  return (
    <div className={styles.page}>

      {/* ── Top bar ── */}
      <div className={styles.topBar}>
        <button className={styles.back} onClick={onBack}>← Retour</button>
        <h1 className={styles.title}>
          <span className={styles.titleWhite}>Visualisation</span>
          <span className={styles.titleAccent}> Sprint</span>
        </h1>
        {data && (
          <label className={styles.reloadBtn}>
            Changer de fichier
            <input type="file" accept=".xlsx" onChange={onInput} style={{ display: 'none' }} />
          </label>
        )}
      </div>

      {!data ? (
        <div
          className={`${styles.dropZone} ${dragging ? styles.dropZoneActive : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <span className={styles.dropIcon}>📊</span>
          <p className={styles.dropTitle}>Glissez votre export Excel ici</p>
          <p className={styles.dropSub}>ou</p>
          <label className={styles.dropBtn}>
            Parcourir…
            <input type="file" accept=".xlsx" onChange={onInput} style={{ display: 'none' }} />
          </label>
          <p className={styles.dropHint}>Fichier .xlsx exporté depuis Vélocité &amp; Capacité</p>
          {error && <p className={styles.dropError}>{error}</p>}
        </div>
      ) : (
        <div className={styles.content}>

          {/* ── Bandeau sprint ── */}
          {(data.sprint.name || data.sprint.startDate !== '—') && (
            <div className={styles.sprintBanner}>
              {data.sprint.name && <span className={styles.sprintName}>{data.sprint.name}</span>}
              {(data.sprint.startDate !== '—' || data.sprint.endDate !== '—') && (
                <span className={styles.sprintDates}>{data.sprint.startDate} → {data.sprint.endDate}</span>
              )}
            </div>
          )}

          {/* ── Stats Dev ── */}
          <div className={styles.statGroup}>
            <span className={styles.statGroupLabel}>Dev</span>
            <div className={styles.statRow}>
              {[
                { val: `${data.sprint.devTotalPlanned}j`, label: 'Vélocité planifiée' },
                { val: `${data.sprint.devTotalCapacity}j`, label: 'Capacité totale' },
                { val: `${data.sprint.devTeamLoad}%`, label: 'Charge équipe', over: data.sprint.devTeamLoad > 100 },
                { val: data.devMembers.length, label: 'Membres Dev' },
              ].map(({ val, label, over }) => (
                <div key={label} className={styles.statCard}>
                  <span className={`${styles.statVal} ${over ? styles.statOver : ''}`}>{val}</span>
                  <span className={styles.statLabel}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Stats QA ── */}
          <div className={styles.statGroup}>
            <span className={`${styles.statGroupLabel} ${styles.statGroupLabelQa}`}>QA / Fonc</span>
            <div className={styles.statRow}>
              {[
                { val: `${data.sprint.qaTotalPlanned}j`, label: 'Vélocité planifiée' },
                { val: `${data.sprint.qaTotalCapacity}j`, label: 'Capacité totale' },
                { val: `${data.sprint.qaTeamLoad}%`, label: 'Charge équipe', over: data.sprint.qaTeamLoad > 100 },
                { val: data.qaMembers.length, label: 'Membres QA' },
              ].map(({ val, label, over }) => (
                <div key={label} className={`${styles.statCard} ${styles.statCardQa}`}>
                  <span className={`${styles.statVal} ${styles.statValQa} ${over ? styles.statOver : ''}`}>{val}</span>
                  <span className={styles.statLabel}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Graphiques Dev ── */}
          {data.devMembers.length > 0 && (
            <div className={styles.charts}>
              <div className={styles.chartCard}>
                <h2 className={styles.chartTitle}>Capacité vs Charge — Dev</h2>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={devBarData} margin={{ top: 8, right: 16, left: -10, bottom: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={{ stroke: '#334155' }} tickLine={false} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={{ stroke: '#334155' }} tickLine={false} unit="j" />
                    <Tooltip content={<CustomBarTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                    <Legend wrapperStyle={{ color: '#94a3b8', fontSize: '.8rem', paddingTop: '8px' }} />
                    <Bar dataKey="Capacité max" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Assigné" radius={[4, 4, 0, 0]}>
                      {devBarData.map((entry, i) => (
                        <Cell key={i} fill={entry['Assigné'] > entry['Capacité max'] ? '#ef4444' : '#10b981'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className={styles.chartCard}>
                <h2 className={styles.chartTitle}>Répartition tâches Dev (j estimés)</h2>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={devPieData} cx="50%" cy="46%" innerRadius={70} outerRadius={110} paddingAngle={3} dataKey="value">
                      {devPieData.map((entry, i) => (
                        <Cell key={i} fill={entry.name === 'Non assigné' ? '#475569' : DEV_COLORS[i % DEV_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomPieTooltip />} />
                    <Legend wrapperStyle={{ color: '#94a3b8', fontSize: '.8rem' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── Graphiques QA ── */}
          {data.qaMembers.length > 0 && (
            <div className={styles.charts}>
              <div className={styles.chartCard}>
                <h2 className={`${styles.chartTitle} ${styles.chartTitleQa}`}>Capacité vs Charge — QA / Fonc</h2>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={qaBarData} margin={{ top: 8, right: 16, left: -10, bottom: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={{ stroke: '#334155' }} tickLine={false} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={{ stroke: '#334155' }} tickLine={false} unit="j" />
                    <Tooltip content={<CustomBarTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                    <Legend wrapperStyle={{ color: '#94a3b8', fontSize: '.8rem', paddingTop: '8px' }} />
                    <Bar dataKey="Capacité max" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Assigné" radius={[4, 4, 0, 0]}>
                      {qaBarData.map((entry, i) => (
                        <Cell key={i} fill={entry['Assigné'] > entry['Capacité max'] ? '#ef4444' : '#10b981'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className={styles.chartCard}>
                <h2 className={`${styles.chartTitle} ${styles.chartTitleQa}`}>Répartition tâches QA (j estimés)</h2>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={qaPieData} cx="50%" cy="46%" innerRadius={70} outerRadius={110} paddingAngle={3} dataKey="value">
                      {qaPieData.map((entry, i) => (
                        <Cell key={i} fill={entry.name === 'Non assigné' ? '#475569' : QA_COLORS[i % QA_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomPieTooltip />} />
                    <Legend wrapperStyle={{ color: '#94a3b8', fontSize: '.8rem' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── Tableau membres Dev ── */}
          {data.devMembers.length > 0 && (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Membres Dev</h2>
              <MembersTable members={data.devMembers} colors={DEV_COLORS} />
            </div>
          )}

          {/* ── Tableau membres QA ── */}
          {data.qaMembers.length > 0 && (
            <div className={styles.section}>
              <h2 className={`${styles.sectionTitle} ${styles.sectionTitleQa}`}>Membres QA / Fonc</h2>
              <MembersTable members={data.qaMembers} colors={QA_COLORS} />
            </div>
          )}

          {/* ── Tableau tâches ── */}
          {data.tasks.length > 0 && (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Tâches ({data.tasks.length})</h2>
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
                    </tr>
                  </thead>
                  <tbody>
                    {data.tasks.map((t, i) => (
                      <tr key={i}>
                        <td>{t.title}</td>
                        <td>{t.devEstimate ?? 0}j</td>
                        <td>{t.qaEstimate ?? 0}j</td>
                        <td className={!t.devAssignee || t.devAssignee === '—' ? styles.unassigned : ''}>{t.devAssignee ?? '—'}</td>
                        <td className={!t.qaAssignee || t.qaAssignee === '—' ? styles.unassigned : ''}>{t.qaAssignee ?? '—'}</td>
                        <td className={styles.dim}>{t.startDate ?? '—'}</td>
                        <td className={styles.dim}>{t.endDate ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
}
