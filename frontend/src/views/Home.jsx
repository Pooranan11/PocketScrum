import { useState } from 'react'
import { createRoom, joinRoom } from '../api.js'
import styles from './Home.module.css'

export default function Home({ onJoin }) {
  const [tab, setTab] = useState('create') // 'create' | 'join'
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const session = await createRoom(name.trim())
      onJoin(session)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleJoin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const session = await joinRoom(code.trim().toUpperCase(), name.trim())
      onJoin(session)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.card}>
      <h1 className={styles.logo}>🃏 PocketScrum</h1>
      <p className={styles.subtitle}>Planning poker en temps réel</p>

      <div className={styles.tabs}>
        <button
          className={tab === 'create' ? styles.tabActive : styles.tab}
          onClick={() => { setTab('create'); setError('') }}
        >
          Créer une room
        </button>
        <button
          className={tab === 'join' ? styles.tabActive : styles.tab}
          onClick={() => { setTab('join'); setError('') }}
        >
          Rejoindre
        </button>
      </div>

      <form onSubmit={tab === 'create' ? handleCreate : handleJoin} className={styles.form}>
        {tab === 'join' && (
          <div className={styles.field}>
            <label>Code de la room</label>
            <input
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD"
              maxLength={4}
              required
              autoFocus
            />
          </div>
        )}

        <div className={styles.field}>
          <label>Ton prénom</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Alice"
            maxLength={30}
            required
            autoFocus={tab === 'create'}
          />
        </div>

        {error && <p className="error">{error}</p>}

        <button type="submit" className={styles.submit} disabled={loading}>
          {loading ? '…' : tab === 'create' ? 'Créer la room' : 'Rejoindre'}
        </button>
      </form>
    </div>
  )
}
