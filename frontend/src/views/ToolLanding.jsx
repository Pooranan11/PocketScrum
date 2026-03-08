import { lazy, Suspense } from 'react'
import {
  Link, Hash, Eye, MessageSquare,
  Users, Zap, AlertTriangle, BarChart2,
  CheckCircle2, TrendingUp, FolderOpen, HardDrive,
  PieChart, FileSpreadsheet,
} from 'lucide-react'
import styles from './ToolLanding.module.css'

const PREVIEWS = {
  'planning-poker': lazy(() => import('../components/previews/PreviewPoker.jsx')),
  velocity:         lazy(() => import('../components/previews/PreviewVelocity.jsx')),
  retro:            lazy(() => import('../components/previews/PreviewRetro.jsx')),
  visualisation:    lazy(() => import('../components/previews/PreviewVisualisation.jsx')),
}

const CONTENT = {
  'planning-poker': {
    illustration: '/illustrations/poker.svg',
    name: 'Planning Poker',
    tagline: 'Estimez en équipe, révélez ensemble.',
    description:
      `Le Planning Poker permet à toute l'équipe Scrum d'estimer les user stories en temps réel.
       Chaque membre vote en secret, puis tous révèlent simultanément — idéal pour éviter
       les biais d'influence et converger rapidement vers un consensus.`,
    steps: [
      { n: '1', label: 'Créez une room', desc: `Générez un code à 4 lettres et partagez-le à votre équipe.` },
      { n: '2', label: 'Votez en secret', desc: `Chacun choisit sa carte Fibonacci sans voir les autres.` },
      { n: '3', label: 'Révélation simultanée', desc: `Tous les votes s'affichent d'un coup — discussion si écart important.` },
      { n: '4', label: 'Convergez', desc: `Relancez un vote jusqu'au consensus sur l'estimation.` },
    ],
    features: [
      { Icon: Link,          label: 'Room partagée via un code 4 lettres' },
      { Icon: Hash,          label: 'Séquence Fibonacci : 1 2 3 5 8 13 21 34 ? ∞' },
      { Icon: Eye,           label: 'Révélation simultanée anti-biais' },
      { Icon: MessageSquare, label: 'Justification obligatoire sur les votes extrêmes' },
    ],
  },

  velocity: {
    illustration: '/illustrations/velocity.svg',
    name: 'Planificateur de sprint',
    tagline: 'Planifiez la capacité, sprint après sprint.',
    description:
      `Le Planificateur de sprint calcule automatiquement la vélocité et la capacité de chaque
       membre de l'équipe. Il détecte les surcharges, suggère des rééquilibrages de tâches
       et garde l'historique des sprints pour affiner vos estimations.`,
    steps: [
      { n: '1', label: `Ajoutez l'équipe`, desc: 'Saisissez les membres (Dev/QA) et leurs jours disponibles.' },
      { n: '2', label: 'Listez les tâches', desc: 'Entrez les user stories et leur estimation en points.' },
      { n: '3', label: 'Répartissez', desc: `Assignez les tâches — l'outil signale les surcharges.` },
      { n: '4', label: 'Exportez', desc: 'Envoyez les données en Visualisation ou Rétro.' },
    ],
    features: [
      { Icon: Users,         label: 'Gestion Dev/QA avec capacités individuelles' },
      { Icon: Zap,           label: `Calcul automatique de vélocité d'équipe` },
      { Icon: AlertTriangle, label: 'Alertes membres surchargés' },
      { Icon: BarChart2,     label: 'Export direct vers Visualisation et Rétro' },
    ],
  },

  retro: {
    illustration: '/illustrations/retro.svg',
    name: 'Rétro sprint',
    tagline: 'Analysez vos sprints, progressez ensemble.',
    description:
      `La Rétro sprint centralise le bilan de votre sprint terminé. Évaluez chaque objectif,
       comparez la vélocité réelle à la vélocité planifiée, et identifiez les axes
       d'amélioration sprint après sprint.`,
    steps: [
      { n: '1', label: 'Importez les données', desc: 'Chargez le fichier Excel (Résumé + Tâches) du sprint.' },
      { n: '2', label: 'Évaluez les objectifs', desc: 'Marquez chaque objectif : Atteint / Partiel / Non atteint.' },
      { n: '3', label: 'Comparez les vélocités', desc: 'Vélocité réelle vs planifiée affichée automatiquement.' },
      { n: '4', label: 'Archivez', desc: 'Les données sont sauvegardées localement pour les prochains sprints.' },
    ],
    features: [
      { Icon: CheckCircle2,  label: 'Statuts : Atteint / Partiel / Non atteint' },
      { Icon: TrendingUp,    label: 'Vélocité réelle vs planifiée' },
      { Icon: FolderOpen,    label: 'Import Excel (Résumé + Tâches)' },
      { Icon: HardDrive,     label: 'Sauvegarde locale automatique' },
    ],
  },

  visualisation: {
    illustration: '/illustrations/visualisation.svg',
    name: 'Visualisation',
    tagline: 'Visualisez la charge, identifiez les goulots.',
    description:
      `La Visualisation transforme un export Excel en tableaux de bord lisibles : charge par
       membre, répartition des tâches par type, et alertes de surcharge pour piloter
       vos sprints avec précision.`,
    steps: [
      { n: '1', label: `Importez l'Excel`, desc: `Chargez directement l'export de votre outil de gestion.` },
      { n: '2', label: 'Charge par membre', desc: 'Graphiques de charge individuels par rôle (Dev/QA).' },
      { n: '3', label: 'Répartition des tâches', desc: 'Visualisez la distribution par type de tâche.' },
      { n: '4', label: 'Alertes surcharge', desc: `Les membres dépassant leur capacité sont mis en évidence.` },
    ],
    features: [
      { Icon: BarChart2,      label: 'Graphiques de charge par rôle (Dev/QA)' },
      { Icon: PieChart,       label: 'Répartition des tâches par type' },
      { Icon: AlertTriangle,  label: 'Membres en surcharge mis en évidence' },
      { Icon: FileSpreadsheet, label: 'Import fichier Excel direct' },
    ],
  },
}

export default function ToolLanding({ tool, onStart }) {
  const c       = CONTENT[tool]
  const Preview = PREVIEWS[tool]
  if (!c) return null

  return (
    <div className={styles.page}>

      {/* ── Hero ── */}
      <div className={styles.hero}>
        <div className={styles.heroText}>
          <div className={styles.illustrationCard}>
            <img src={c.illustration} alt={c.name} className={styles.heroIllustration} />
          </div>
          <h1 className={styles.title}>{c.name}</h1>
          <p className={styles.tagline}>{c.tagline}</p>
          <p className={styles.description}>{c.description}</p>
          <button className={styles.cta} onClick={onStart}>
            Commencer <span className={styles.ctaArrow}>→</span>
          </button>
        </div>

        {/* Live preview */}
        <div className={styles.preview}>
          <Suspense fallback={<div className={styles.previewLoading} />}>
            <Preview />
          </Suspense>
        </div>
      </div>

      {/* ── Comment ça marche ── */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Comment ça marche</h2>
        <div className={styles.steps}>
          {c.steps.map(s => (
            <div key={s.n} className={styles.step}>
              <div className={styles.stepNum}>{s.n}</div>
              <div className={styles.stepBody}>
                <strong className={styles.stepLabel}>{s.label}</strong>
                <p className={styles.stepDesc}>{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Fonctionnalités ── */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Fonctionnalités</h2>
        <div className={styles.features}>
          {c.features.map(f => (
            <div key={f.label} className={styles.feature}>
              <div className={styles.featureIconWrap}>
                <f.Icon size={15} strokeWidth={1.75} color="#818cf8" />
              </div>
              <span className={styles.featureLabel}>{f.label}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}
