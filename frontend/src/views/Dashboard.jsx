import styles from './Dashboard.module.css'

const tools = [
  {
    id: 'planning-poker',
    icon: '🃏',
    name: 'Planning Poker',
    description: 'Estimez vos user stories en équipe, en temps réel.',
    available: true,
  },
  {
    id: 'velocity',
    icon: '📈',
    name: 'Planificateur de sprint',
    description: 'Planifiez la vélocité et la capacité de votre équipe sprint après sprint.',
    available: true,
  },
  {
    id: 'retro',
    icon: '🔁',
    name: 'Rétro sprint',
    description: 'Évaluez les objectifs du sprint : statut atteint/partiel/non atteint et vélocité réelle vs planifiée.',
    available: true,
  },
  {
    id: 'visualisation',
    icon: '📊',
    name: 'Visualisation',
    description: 'Importez un export Excel pour visualiser la charge, la répartition des tâches et les membres surchargés.',
    available: true,
  },
]

export default function Dashboard({ onSelectTool }) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <img src="/logo.png" alt="PocketScrum" className={styles.logo} />
        <p className={styles.subtitle}>Choisissez un outil Scrum pour commencer</p>
      </header>

      <div className={styles.grid}>
        {tools.map(tool => (
          <button
            key={tool.id}
            className={tool.available ? styles.card : `${styles.card} ${styles.cardDisabled}`}
            onClick={() => tool.available && onSelectTool(tool.id)}
            disabled={!tool.available}
            aria-disabled={!tool.available}
          >
            <div className={styles.iconContainer}>
              <span className={styles.icon}>{tool.icon}</span>
            </div>
            <div className={styles.cardContent}>
              <h2 className={styles.toolName}>{tool.name}</h2>
              <p className={styles.toolDesc}>{tool.description}</p>
            </div>
            <div className={styles.cardFooter}>
              <span className={tool.available ? styles.badgeAvailable : styles.badgeSoon}>
                {tool.available ? 'Disponible' : 'Bientôt disponible'}
              </span>
              {tool.available && (
                <span className={styles.cardCta}>Commencer →</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
