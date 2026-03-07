export const uid = () => crypto.randomUUID()

export const fmtJ = n => `${parseFloat(n.toFixed(2))}j`

export const fmtDate = d =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'

// Reconvertit DD/MM/YY (format export) en YYYY-MM-DD (format input date)
export const parseFrDate = s => {
  if (!s || s === '—') return ''
  const parts = String(s).split('/')
  if (parts.length !== 3) return ''
  const [d, m, y] = parts
  return `20${y.padStart(2, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}
