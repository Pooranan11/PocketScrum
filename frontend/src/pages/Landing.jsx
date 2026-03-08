import { useEffect, useRef, Suspense, lazy } from 'react'
import { useNavigate } from 'react-router-dom'
import Background from '../components/Background.jsx'
import styles from './Landing.module.css'

const PreviewPoker         = lazy(() => import('../components/previews/PreviewPoker.jsx'))
const PreviewVelocity      = lazy(() => import('../components/previews/PreviewVelocity.jsx'))
const PreviewRetro         = lazy(() => import('../components/previews/PreviewRetro.jsx'))
const PreviewVisualisation = lazy(() => import('../components/previews/PreviewVisualisation.jsx'))

const TOOLS = [
  {
    id: 'planning-poker',
    icon: '🃏',
    name: 'Planning Poker',
    desc: `Estimez vos user stories en équipe, révélation simultanée pour éviter les biais.`,
    Preview: PreviewPoker,
  },
  {
    id: 'velocity',
    icon: '📈',
    name: 'Planificateur de sprint',
    desc: `Calculez la capacité de chaque membre et détectez les surcharges avant qu'elles arrivent.`,
    Preview: PreviewVelocity,
  },
  {
    id: 'retro',
    icon: '🔁',
    name: 'Rétro sprint',
    desc: `Évaluez vos objectifs et comparez vélocité réelle vs planifiée en un coup d'œil.`,
    Preview: PreviewRetro,
  },
  {
    id: 'visualisation',
    icon: '📊',
    name: 'Visualisation',
    desc: `Transformez un export Excel en tableaux de bord de charge et de répartition.`,
    Preview: PreviewVisualisation,
  },
]

const FLOW = [
  { icon: '🃏', step: '01', name: 'Estimez',    desc: 'Votez sur chaque story en équipe via le Planning Poker.' },
  { icon: '📈', step: '02', name: 'Planifiez',  desc: `Répartissez la charge et planifiez la capacité du sprint.` },
  { icon: '🔁', step: '03', name: `Rétrospectez`, desc: `Analysez le sprint écoulé, objectif par objectif.` },
  { icon: '📊', step: '04', name: 'Visualisez', desc: `Pilotez avec des graphiques clairs sur la charge réelle.` },
]

// Hook d'animation au scroll
function useInView(threshold = 0.15) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { el.classList.add(styles.visible); obs.disconnect() } },
      { threshold }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])
  return ref
}

function AnimatedSection({ children, className }) {
  const ref = useInView()
  return <div ref={ref} className={`${styles.fadeUp} ${className ?? ''}`}>{children}</div>
}

export default function Landing() {
  const navigate = useNavigate()

  return (
    <div className={styles.page}>
      <Background />

      {/* ════════════════════════════════════════
          HERO
      ════════════════════════════════════════ */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>

          {/* Text */}
          <div className={styles.heroText}>
            <div className={styles.heroBadge}>✦ Outil Scrum tout-en-un</div>
            <h1 className={styles.heroTitle}>
              Vos sprints,<br />
              <span className={styles.heroGradient}>sous contrôle.</span>
            </h1>
            <p className={styles.heroSub}>
              PocketScrum réunit Planning Poker, gestion de vélocité, rétrospective
              et visualisation dans une interface unique. Gérez vos sprints sans friction,
              de l&apos;estimation à l&apos;analyse.
            </p>
            <div className={styles.heroCtas}>
              <button className={styles.ctaPrimary} onClick={() => navigate('/app')}>
                Commencer gratuitement <span>→</span>
              </button>
              <a href="#tools" className={styles.ctaSecondary}>
                Découvrir les outils <span>↓</span>
              </a>
            </div>
          </div>

          {/* Hero visual — 2×2 mini previews */}
          <div className={styles.heroVisual}>
            {TOOLS.map((tool) => {
              const Cmp = tool.Preview
              return (
                <div key={tool.id} className={styles.miniPreview}>
                  <Suspense fallback={<div className={styles.miniLoader} />}>
                    <Cmp />
                  </Suspense>
                </div>
              )
            })}
          </div>
        </div>

        {/* Scroll hint */}
        <div className={styles.scrollHint}>
          <div className={styles.scrollDot} />
        </div>
      </section>

      {/* ════════════════════════════════════════
          TOOLS SHOWCASE
      ════════════════════════════════════════ */}
      <section id="tools" className={styles.section}>
        <AnimatedSection>
          <p className={styles.sectionEyebrow}>Les outils</p>
          <h2 className={styles.sectionTitle}>4 outils, 1 interface.</h2>
          <p className={styles.sectionSub}>
            Chaque outil est conçu pour une phase précise du sprint Scrum —
            et ils s&apos;alimentent entre eux.
          </p>
        </AnimatedSection>

        <div className={styles.toolsGrid}>
          {TOOLS.map(({ id, icon, name, desc, Preview }, i) => {
            const Cmp = Preview
            return (
            <AnimatedSection key={id} className={styles.toolCard}>
              <div className={styles.toolPreviewWrap}>
                <Suspense fallback={<div className={styles.miniLoader} />}>
                  <Cmp />
                </Suspense>
              </div>
              <div className={styles.toolCardBody}>
                <div className={styles.toolCardTop}>
                  <span className={styles.toolNum}>0{i + 1}</span>
                  <span className={styles.toolIcon}>{icon}</span>
                </div>
                <h3 className={styles.toolCardName}>{name}</h3>
                <p className={styles.toolCardDesc}>{desc}</p>
              </div>
            </AnimatedSection>
            )
          })}
        </div>
      </section>

      {/* ════════════════════════════════════════
          SPRINT FLOW
      ════════════════════════════════════════ */}
      <section className={styles.section}>
        <AnimatedSection>
          <p className={styles.sectionEyebrow}>Le cycle</p>
          <h2 className={styles.sectionTitle}>Du planning à la rétro,<br />en boucle.</h2>
          <p className={styles.sectionSub}>
            PocketScrum couvre l&apos;intégralité du cycle Scrum — chaque outil
            alimente le suivant, sprint après sprint.
          </p>
        </AnimatedSection>

        <div className={styles.flow}>
          {FLOW.map((f, i) => (
            <AnimatedSection key={f.step} className={styles.flowStep}>
              <div className={styles.flowStepInner}>
                <div className={styles.flowIcon}>{f.icon}</div>
                <div className={styles.flowNum}>{f.step}</div>
                <h3 className={styles.flowName}>{f.name}</h3>
                <p className={styles.flowDesc}>{f.desc}</p>
              </div>
              {i < FLOW.length - 1 && <div className={styles.flowArrow}>→</div>}
            </AnimatedSection>
          ))}
        </div>
      </section>

      {/* ════════════════════════════════════════
          FINAL CTA
      ════════════════════════════════════════ */}
      <section className={styles.ctaSection}>
        <AnimatedSection className={styles.ctaCard}>
          <div className={styles.ctaGlow} />
          <p className={styles.ctaEyebrow}>Prêt à démarrer ?</p>
          <h2 className={styles.ctaTitle}>Votre prochain sprint<br />commence ici.</h2>
          <p className={styles.ctaSub}>Gratuit, sans inscription, sans installation.</p>
          <button className={styles.ctaPrimary} onClick={() => navigate('/app')}>
            Lancer PocketScrum <span>→</span>
          </button>
        </AnimatedSection>
      </section>

      <footer className={styles.footer}>
        <span>© {new Date().getFullYear()} PocketScrum — Tous droits réservés</span>
      </footer>
    </div>
  )
}
