import { useEffect, useRef } from 'react'
import styles from './Background.module.css'

const FIB = [1, 2, 3, 5, 8, 13, 21, 34, '?', '∞']

const POKER_CHIPS = [
  /* top row */
  { value: 1,   left: '5%',  top: '10%', dur: '5s',   delay: '0s'   },
  { value: 3,   left: '28%', top: '16%', dur: '5.8s', delay: '2.5s' },
  { value: 8,   left: '52%', top: '8%',  dur: '5s',   delay: '1.8s' },
  { value: 21,  left: '74%', top: '14%', dur: '4.8s', delay: '0.9s' },
  { value: '?', left: '92%', top: '20%', dur: '6.8s', delay: '1.5s' },
  /* middle row */
  { value: 2,   left: '10%', top: '48%', dur: '6.5s', delay: '1.2s' },
  { value: 5,   left: '36%', top: '42%', dur: '7.2s', delay: '0.4s' },
  { value: 13,  left: '62%', top: '50%', dur: '6s',   delay: '3.2s' },
  { value: 34,  left: '86%', top: '44%', dur: '5.5s', delay: '2s'   },
  /* bottom row */
  { value: 5,   left: '6%',  top: '76%', dur: '5.6s', delay: '3s'   },
  { value: '∞', left: '28%', top: '82%', dur: '7s',   delay: '4s'   },
  { value: 3,   left: '52%', top: '78%', dur: '6.2s', delay: '0.6s' },
  { value: 8,   left: '76%', top: '74%', dur: '5.3s', delay: '1.8s' },
  { value: 2,   left: '92%', top: '80%', dur: '6s',   delay: '2.8s' },
]

const SPRINT_CARDS = [
  { label: 'Sprint',        value: '12',     left: '7%',  dur: '20s', delay: '0s'  },
  { label: 'Velocity',      value: '34 pts', left: '30%', dur: '25s', delay: '5s'  },
  { label: 'Story Points',  value: '89',     left: '53%', dur: '22s', delay: '11s' },
  { label: 'Team',          value: '6 devs', left: '75%', dur: '27s', delay: '17s' },
]

export default function Background() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let animId
    let W, H

    function resize() {
      W = canvas.width = window.innerWidth
      H = canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    class Particle {
      constructor() { this.reset() }
      reset() {
        this.x = Math.random() * W
        this.y = Math.random() * H
        this.vx = (Math.random() - 0.5) * 0.28
        this.vy = (Math.random() - 0.5) * 0.28
        this.size = Math.random() * 1.4 + 0.4
        this.alpha = Math.random() * 0.35 + 0.08
        this.color = Math.random() > 0.5 ? '#6366f1' : '#818cf8'
        this.label = Math.random() > 0.78 ? String(FIB[Math.floor(Math.random() * FIB.length)]) : null
        this.pulse = Math.random() * Math.PI * 2
      }
      update() {
        this.x += this.vx
        this.y += this.vy
        this.pulse += 0.018
        if (this.x < 0 || this.x > W || this.y < 0 || this.y > H) this.reset()
      }
      draw() {
        const a = this.alpha * (0.7 + 0.3 * Math.sin(this.pulse))
        ctx.globalAlpha = a
        if (this.label) {
          ctx.font = `300 10px 'DM Mono', monospace`
          ctx.fillStyle = this.color
          ctx.fillText(this.label, this.x, this.y)
        } else {
          ctx.beginPath()
          ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2)
          ctx.fillStyle = this.color
          ctx.fill()
        }
        ctx.globalAlpha = 1
      }
    }

    const particles = Array.from({ length: 110 }, () => new Particle())

    function drawConnections() {
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i], b = particles[j]
          const dx = a.x - b.x, dy = a.y - b.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 90) {
            ctx.globalAlpha = (1 - dist / 90) * 0.07
            ctx.strokeStyle = '#6366f1'
            ctx.lineWidth = 0.5
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.stroke()
            ctx.globalAlpha = 1
          }
        }
      }
    }

    function animate() {
      ctx.clearRect(0, 0, W, H)
      particles.forEach(p => { p.update(); p.draw() })
      drawConnections()
      animId = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <>
      <canvas ref={canvasRef} className={styles.canvas} />
      <div className={styles.gradientOverlay} />
      <div className={styles.floatLayer}>
        {POKER_CHIPS.map(chip => (
          <div
            key={chip.value}
            className={styles.pokerChip}
            style={{ left: chip.left, top: chip.top, animationDuration: chip.dur, animationDelay: chip.delay }}
          >
            {chip.value}
          </div>
        ))}
        {SPRINT_CARDS.map(card => (
          <div
            key={card.label}
            className={styles.sprintCard}
            style={{ left: card.left, top: '88%', animationDuration: card.dur, animationDelay: card.delay }}
          >
            <div className={styles.sprintLabel}>{card.label}</div>
            <div className={styles.sprintValue}>{card.value}</div>
          </div>
        ))}
      </div>
    </>
  )
}
