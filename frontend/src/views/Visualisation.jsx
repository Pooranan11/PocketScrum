import { useState, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts'
import styles from './Visualisation.module.css'

const MEMBER_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ec4899',
  '#14b8a6', '#8b5cf6', '#f97316', '#06b6d4',
]

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
    name:          sumRows[0]?.[1] ?? '',
    startDate:     sumRows[1]?.[1] ?? '—',
    endDate:       sumRows[2]?.[1] ?? '—',
    totalPlanned:  sumRows[4]?.[1] ?? 0,
    totalCapacity: sumRows[5]?.[1] ?? 0,
    teamLoad:      sumRows[6]?.[1] ?? 0,
  }

  // ── Capacité ──
  const capRows = XLSX.utils.sheet_to_json(wb.Sheets['Capacité'], { header: 1 })
  const members = capRows.slice(1)
    .map(r => ({ name: r[0], capacity: r[1], assigned: r[2], load: r[3], status: r[4] }))
    .filter(m => m.name)

  // ── Tâches ──
  const taskRows = XLSX.utils.sheet_to_json(wb.Sheets['Tâches'], { header: 1 })
  const tasks = taskRows.slice(1)
    .map(r => ({ title: r[0], estimate: r[1], assignee: r[2], startDate: r[3], endDate: r[4] }))
    .filter(t => t.title)

  return { sprint, members, tasks }
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

  const onDrop = useCallback(e => {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files[0])
  }, [handleFile])

  const onInput = useCallback(e => handleFile(e.target.files[0]), [handleFile])

  // ── Données graphiques ──
  const barData = (data?.members ?? []).map(m => ({
    name:            m.name,
    'Capacité max':  m.capacity,
    'Assigné':       m.assigned,
  }))

  const assignedByMember = {}
  data?.tasks.forEach(t => {
    if (t.assignee && t.assignee !== '—') {
      assignedByMember[t.assignee] = (assignedByMember[t.assignee] ?? 0) + (t.estimate ?? 0)
    }
  })
  const unassigned = data?.tasks
    .filter(t => !t.assignee || t.assignee === '—')
    .reduce((s, t) => s + (t.estimate ?? 0), 0) ?? 0
  const pieData = [
    ...Object.entries(assignedByMember).map(([name, value]) => ({ name, value })),
    ...(unassigned > 0 ? [{ name: 'Non assigné', value: unassigned }] : []),
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
        /* ── Drop zone ── */
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
                <span className={styles.sprintDates}>
                  {data.sprint.startDate} → {data.sprint.endDate}
                </span>
              )}
            </div>
          )}

          {/* ── Stats ── */}
          <div className={styles.statRow}>
            {[
              { val: `${data.sprint.totalPlanned}j`, label: 'Vélocité planifiée' },
              { val: `${data.sprint.totalCapacity}j`, label: 'Capacité totale' },
              { val: `${data.sprint.teamLoad}%`, label: 'Charge équipe', over: data.sprint.teamLoad > 100 },
              { val: data.members.length, label: 'Membres' },
              { val: data.tasks.length, label: 'Tâches' },
            ].map(({ val, label, over }) => (
              <div key={label} className={styles.statCard}>
                <span className={`${styles.statVal} ${over ? styles.statOver : ''}`}>{val}</span>
                <span className={styles.statLabel}>{label}</span>
              </div>
            ))}
          </div>

          {/* ── Graphiques ── */}
          <div className={styles.charts}>

            {/* Bar chart : capacité vs assigné */}
            <div className={styles.chartCard}>
              <h2 className={styles.chartTitle}>Capacité vs Charge par membre</h2>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={barData} margin={{ top: 8, right: 16, left: -10, bottom: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                    axisLine={{ stroke: '#334155' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                    axisLine={{ stroke: '#334155' }}
                    tickLine={false}
                    unit="j"
                  />
                  <Tooltip content={<CustomBarTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                  <Legend wrapperStyle={{ color: '#94a3b8', fontSize: '.8rem', paddingTop: '8px' }} />
                  <Bar dataKey="Capacité max" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Assigné" radius={[4, 4, 0, 0]}>
                    {barData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry['Assigné'] > entry['Capacité max'] ? '#ef4444' : '#10b981'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Pie chart : répartition des tâches */}
            <div className={styles.chartCard}>
              <h2 className={styles.chartTitle}>Répartition des tâches (j estimés)</h2>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="46%"
                    innerRadius={70}
                    outerRadius={110}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.name === 'Non assigné' ? '#475569' : MEMBER_COLORS[i % MEMBER_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomPieTooltip />} />
                  <Legend wrapperStyle={{ color: '#94a3b8', fontSize: '.8rem' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── Tableau membres ── */}
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Détail des membres</h2>
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
                  {data.members.map((m, i) => {
                    const over = m.status !== 'OK'
                    return (
                      <tr key={i}>
                        <td>
                          <span className={styles.memberName}>
                            <span
                              className={styles.memberDot}
                              style={{ background: MEMBER_COLORS[i % MEMBER_COLORS.length] }}
                            />
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
          </div>

          {/* ── Tableau tâches ── */}
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Tâches</h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Tâche</th>
                    <th>Estimation</th>
                    <th>Assigné à</th>
                    <th>Début</th>
                    <th>Fin</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tasks.map((t, i) => (
                    <tr key={i}>
                      <td>{t.title}</td>
                      <td>{t.estimate}j</td>
                      <td className={!t.assignee || t.assignee === '—' ? styles.unassigned : ''}>
                        {t.assignee ?? '—'}
                      </td>
                      <td className={styles.dim}>{t.startDate ?? '—'}</td>
                      <td className={styles.dim}>{t.endDate ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}
    </div>
  )
}
