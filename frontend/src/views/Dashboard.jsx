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
    name: 'Vélocité & Capacité',
    description: 'Calculez la vélocité de votre équipe et visualisez sa capacité sprint après sprint.',
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
        <h1 className={styles.logo}>
          🃏 <span className={styles.logoPocket}>Pocket</span><span className={styles.logoScrum}>Scrum</span>
        </h1>
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
