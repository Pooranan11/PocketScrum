import { useState, useCallback, useRef, useEffect } from 'react'
import { useWebSocket } from '../useWebSocket.js'
import styles from './Room.module.css'

const CARDS = ['1', '2', '3', '5', '8', '13', '21', '?', '☕']

function savePokerResult(taskName, round, roomCode, votes) {
  const nums = votes.map(v => Number(v.vote)).filter(n => !isNaN(n) && n > 0)
  const average = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
  try {
    const results = JSON.parse(localStorage.getItem('pocketscrum_poker_results') ?? '[]')
    results.push({
      id: crypto.randomUUID(),
      taskName: taskName || `Round ${round}`,
      round,
      roomCode,
      timestamp: new Date().toISOString(),
      votes: votes.map(v => ({ player_name: v.player_name, vote: v.vote, justification: v.justification ?? '' })),
      average,
    })
    localStorage.setItem('pocketscrum_poker_results', JSON.stringify(results))
  } catch {
    // Ignore localStorage errors (private browsing, quota exceeded, etc.)
  }
}

export default function Room({ session, onLeave }) {
  const { room_code, player_id, token, is_scrum_master } = session

  const [players, setPlayers] = useState([])
  const [votes, setVotes] = useState(null)      // null = non révélés
  const [gameState, setGameState] = useState('voting') // 'voting' | 'revealed'
  const [round, setRound] = useState(1)
  const [myVote, setMyVote] = useState(null)
  const [log, setLog] = useState([])
  const [taskName, setTaskName] = useState('')
  const [pendingTaskName, setPendingTaskName] = useState('')

  // Refs pour accéder aux valeurs courantes dans onMessage sans créer de dépendances
  const roundRef = useRef(round)
  const taskNameRef = useRef(taskName)
  useEffect(() => { roundRef.current = round }, [round])
  useEffect(() => { taskNameRef.current = taskName }, [taskName])
  const [pendingCard, setPendingCard] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [justification, setJustification] = useState('')

  const addLog = (msg) => setLog(l => [`${new Date().toLocaleTimeString()} — ${msg}`, ...l].slice(0, 8))

  const onMessage = useCallback((msg) => {
    switch (msg.type) {
      case 'room_state': {
        const p = msg.payload
        setPlayers(p.players ?? [])
        setGameState(p.state)
        setRound(p.round)
        setTaskName(p.task_name ?? '')
        setVotes(p.state === 'revealed' ? p.votes ?? [] : null)
        break
      }
      case 'player_join':
        setPlayers(msg.payload.players ?? [])
        addLog(`${msg.payload.player_name} a rejoint la room`)
        break
      case 'player_leave':
        setPlayers(msg.payload.players ?? [])
        addLog(`${msg.payload.player_name} a quitté la room`)
        break
      case 'vote_cast':
        setPlayers(prev =>
          prev.map(p =>
            p.player_id === msg.payload.player_id
              ? { ...p, has_voted: true }
              : p
          )
        )
        addLog(`${msg.payload.player_name} a voté`)
        break
      case 'votes_reveal': {
        const revealedVotes = msg.payload.votes ?? []
        setVotes(revealedVotes)
        setGameState('revealed')
        addLog('Votes révélés !')
        savePokerResult(taskNameRef.current, roundRef.current, room_code, revealedVotes)
        break
      }
      case 'new_round':
        setVotes(null)
        setGameState('voting')
        setMyVote(null)
        setRound(msg.payload.round)
        setTaskName(msg.payload.task_name ?? '')
        setPendingTaskName('')
        setPlayers(prev => prev.map(p => ({ ...p, has_voted: false })))
        addLog(`Nouveau round #${msg.payload.round}`)
        break
      case 'task_name_updated':
        setTaskName(msg.payload.task_name ?? '')
        break
      case 'error':
        addLog(`⚠️ ${msg.payload.message}`)
        break
    }
  }, [])

  const { send } = useWebSocket({ roomCode: room_code, playerId: player_id, token, onMessage, enabled: true })

  function handleCardClick(card) {
    if (gameState !== 'voting') return
    setPendingCard(card)
    setJustification('')
    setShowModal(true)
  }

  function confirmVote(withJustification = true) {
    setMyVote(pendingCard)
    send({ type: 'vote_cast', payload: { vote: pendingCard, justification: withJustification ? justification : '' } })
    setShowModal(false)
    setPendingCard(null)
    setJustification('')
  }

  function reveal() {
    send({ type: 'votes_reveal' })
  }

  function newRound() {
    send({ type: 'new_round', payload: { task_name: pendingTaskName.trim() } })
  }

  const votedCount = players.filter(p => p.has_voted).length
  const average = votes
    ? (() => {
        const nums = votes.map(v => Number(v.vote)).filter(n => !isNaN(n) && n > 0)
        return nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : null
      })()
    : null

  return (
    <div className={styles.layout}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.logoSmall}>🃏 PocketScrum</span>
          <span className={styles.badge}>
            Room <strong>{room_code}</strong>
          </span>
          {is_scrum_master && <span className={styles.smBadge}>Scrum Master</span>}
        </div>
        <div className={styles.headerRight}>
          <span className={styles.round}>Round #{round}</span>
          <button className={styles.leaveBtn} onClick={onLeave}>Quitter</button>
        </div>
      </header>

      {/* Task name banner */}
      {taskName && (
        <div className={styles.taskBanner}>
          Tâche : <strong>{taskName}</strong>
        </div>
      )}

      <main className={styles.main}>
        {/* Panneau joueurs */}
        <section className={styles.players}>
          <h2>Joueurs ({players.length})</h2>
          <ul className={styles.playerList}>
            {players.map(p => (
              <li key={p.player_id} className={styles.playerRow}>
                <div className={styles.playerInfo}>
                  <span className={p.player_id === player_id ? styles.me : ''}>
                    {p.player_name}
                    {p.player_id === player_id && ' (moi)'}
                  </span>
                  {gameState === 'revealed' && votes?.find(v => v.player_id === p.player_id)?.justification && (
                    <span className={styles.justification}>
                      "{votes.find(v => v.player_id === p.player_id).justification}"
                    </span>
                  )}
                </div>
                <span className={p.has_voted ? styles.voted : styles.waiting}>
                  {gameState === 'revealed'
                    ? (votes?.find(v => v.player_id === p.player_id)?.vote ?? '—')
                    : p.has_voted ? '✓' : '…'
                  }
                </span>
              </li>
            ))}
          </ul>

          {/* Progression */}
          <div className={styles.progress}>
            <div
              className={styles.progressBar}
              style={{ width: players.length ? `${(votedCount / players.length) * 100}%` : '0%' }}
            />
          </div>
          <p className={styles.progressLabel}>{votedCount}/{players.length} ont voté</p>

          {/* Résultats */}
          {gameState === 'revealed' && average && (
            <div className={styles.average}>
              Moyenne : <strong>{average}</strong>
            </div>
          )}

          {/* Actions Scrum Master */}
          {is_scrum_master && (
            <div className={styles.actions}>
              <div className={styles.taskInputRow}>
                <input
                  className={styles.taskInput}
                  value={pendingTaskName}
                  onChange={e => setPendingTaskName(e.target.value)}
                  placeholder={gameState === 'voting' ? 'Nom de la tâche en cours...' : 'Nom de la tâche suivante...'}
                  maxLength={60}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && gameState === 'voting') {
                      send({ type: 'set_task_name', payload: { task_name: pendingTaskName.trim() } })
                    }
                  }}
                />
                {gameState === 'voting' && (
                  <button
                    className={styles.setTaskBtn}
                    onClick={() => send({ type: 'set_task_name', payload: { task_name: pendingTaskName.trim() } })}
                    title="Nommer la tâche"
                  >
                    ✓
                  </button>
                )}
              </div>
              {gameState === 'voting' && (
                <button
                  className={styles.revealBtn}
                  onClick={reveal}
                  disabled={votedCount === 0}
                >
                  Révéler les votes
                </button>
              )}
              {gameState === 'revealed' && (
                <button className={styles.newRoundBtn} onClick={newRound}>
                  Nouveau round
                </button>
              )}
            </div>
          )}
        </section>

        {/* Zone de vote */}
        <section className={styles.voteZone}>
          <h2>
            {gameState === 'voting'
              ? myVote ? `Ton vote : ${myVote}` : 'Choisis une carte'
              : 'Votes révélés'}
          </h2>
          <div className={styles.cards}>
            {CARDS.map(card => (
              <button
                key={card}
                className={[
                  styles.card,
                  myVote === card ? styles.cardSelected : '',
                  gameState === 'revealed' ? styles.cardDisabled : '',
                ].join(' ')}
                onClick={() => handleCardClick(card)}
                disabled={gameState === 'revealed'}
              >
                {card}
              </button>
            ))}
          </div>
        </section>
      </main>

      {/* Log d'activité */}
      {log.length > 0 && (
        <footer className={styles.log}>
          {log.map((entry, i) => <p key={i}>{entry}</p>)}
        </footer>
      )}

      {/* Modal justification */}
      {showModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3>Ton vote : {pendingCard}</h3>
            <p className={styles.modalSubtitle}>Justification (optionnelle)</p>
            <textarea
              className={styles.modalTextarea}
              value={justification}
              onChange={e => setJustification(e.target.value)}
              maxLength={200}
              placeholder="Pourquoi cette estimation ?"
              rows={3}
              autoFocus
            />
            <div className={styles.modalActions}>
              <button className={styles.modalConfirm} onClick={() => confirmVote(true)}>Confirmer</button>
              <button className={styles.modalSkip} onClick={() => confirmVote(false)}>Passer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
