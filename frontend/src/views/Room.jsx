import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import { useWebSocket } from '../useWebSocket.js'
import styles from './Room.module.css'

const CARDS = ['1', '2', '3', '5', '8', '13', '21', '?', '☕']
const VELOCITY_STORAGE_KEY = 'pocketscrum_velocity'

function addMemberToVelocityBoard(playerName, playerRole) {
  try {
    const saved = JSON.parse(localStorage.getItem(VELOCITY_STORAGE_KEY) ?? 'null')
    const role = playerRole === 'qa' ? 'qa' : 'dev'
    const listKey = role === 'qa' ? 'qaMembers' : 'devMembers'
    const members = saved?.[listKey] ?? []
    if (members.some(m => m.name === playerName)) return
    members.push({ id: crypto.randomUUID(), name: playerName, capacity: 5 })
    localStorage.setItem(VELOCITY_STORAGE_KEY, JSON.stringify({ ...saved, [listKey]: members }))
    window.dispatchEvent(new Event('pocketscrum-velocity-updated'))
  } catch {
    // Ignore localStorage errors
  }
}

function addToVelocityBoard(taskName, round, votes) {
  const avg = (roleFilter) => {
    const nums = votes
      .filter(v => v.role === roleFilter)
      .map(v => Number(v.vote))
      .filter(n => !isNaN(n) && n > 0)
    return nums.length ? parseFloat((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2)) : null
  }
  const devEstimate = avg('dev') ?? 1
  const qaEstimate  = avg('qa')  ?? 0
  try {
    const saved = JSON.parse(localStorage.getItem(VELOCITY_STORAGE_KEY) ?? 'null')
    const tasks = saved?.tasks ?? []
    tasks.push({
      id: crypto.randomUUID(),
      title: taskName || `Round ${round}`,
      devEstimate,
      qaEstimate,
      devAssigneeId: '',
      qaAssigneeId: '',
      startDate: '',
      endDate: '',
    })
    localStorage.setItem(VELOCITY_STORAGE_KEY, JSON.stringify({ ...saved, tasks }))
  } catch {
    // Ignore localStorage errors
  }
}

function computeSeatPosition(index, count) {
  const angle = Math.PI / 2 + (index / count) * 2 * Math.PI
  return {
    left: `${50 + 40 * Math.cos(angle)}%`,
    top:  `${50 + 34 * Math.sin(angle)}%`,
  }
}

function getWrapperHeight(count) {
  if (count <= 2) return 'min(240px, 44vw)'
  if (count <= 4) return 'min(300px, 48vw)'
  if (count <= 6) return 'min(360px, 52vw)'
  return 'min(420px, 56vw)'
}

export default function Room({ session, onLeave, onVelocity }) {
  const { room_code, player_id, token, is_scrum_master } = session

  const [players,   setPlayers]   = useState([])
  const [votes,     setVotes]     = useState(null)
  const [gameState, setGameState] = useState('voting')
  const [round,     setRound]     = useState(1)
  const [myVote,    setMyVote]    = useState(null)
  const [log,       setLog]       = useState([])
  const [taskName,  setTaskName]  = useState('')

  const roundRef    = useRef(round)
  const taskNameRef = useRef(taskName)
  useEffect(() => { roundRef.current    = round    }, [round])
  useEffect(() => { taskNameRef.current = taskName }, [taskName])

  // Vote justification modal
  const [pendingCard,   setPendingCard]   = useState(null)
  const [showVoteModal, setShowVoteModal] = useState(false)
  const [justification, setJustification] = useState('')

  // Task name modal
  const [showTaskModal,  setShowTaskModal]  = useState(false)
  const [taskModalInput, setTaskModalInput] = useState('')
  const [taskModalMode,  setTaskModalMode]  = useState('name_task') // 'name_task' | 'new_round'

  const logRef = useRef(null)
  const addLog = (msg) => setLog(l => [...l, `${new Date().toLocaleTimeString()} — ${msg}`].slice(-20))

  useLayoutEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])

  const onMessage = useCallback((msg) => {
    switch (msg.type) {
      case 'room_state': {
        const p = msg.payload
        setPlayers(p.players ?? [])
        setGameState(p.state)
        setRound(p.round)
        setTaskName(p.task_name ?? '')
        setVotes(p.state === 'revealed' ? p.votes ?? [] : null)
        if (is_scrum_master) p.players?.forEach(pl => addMemberToVelocityBoard(pl.player_name, pl.role))
        break
      }
      case 'player_join':
        setPlayers(msg.payload.players ?? [])
        addLog(`${msg.payload.player_name} a rejoint la room`)
        if (is_scrum_master) addMemberToVelocityBoard(msg.payload.player_name, msg.payload.role)
        break
      case 'player_leave':
        setPlayers(msg.payload.players ?? [])
        addLog(`${msg.payload.player_name} a quitté la room`)
        break
      case 'vote_cast':
        setPlayers(prev =>
          prev.map(p => p.player_id === msg.payload.player_id ? { ...p, has_voted: true } : p)
        )
        addLog(`${msg.payload.player_name} a voté`)
        break
      case 'votes_reveal': {
        const revealedVotes = msg.payload.votes ?? []
        setVotes(revealedVotes)
        setGameState('revealed')
        addLog('Votes révélés !')
        if (is_scrum_master) addToVelocityBoard(taskNameRef.current, roundRef.current, revealedVotes)
        break
      }
      case 'new_round':
        setVotes(null)
        setGameState('voting')
        setMyVote(null)
        setPendingCard(null)
        setShowVoteModal(false)
        setJustification('')
        setRound(msg.payload.round)
        setTaskName(msg.payload.task_name ?? '')
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

  function openTaskModal(mode) {
    setTaskModalMode(mode)
    setTaskModalInput('')
    setShowTaskModal(true)
  }

  function confirmTaskModal() {
    if (taskModalMode === 'new_round') {
      send({ type: 'new_round', payload: { task_name: taskModalInput.trim() } })
    } else if (taskModalInput.trim()) {
      send({ type: 'set_task_name', payload: { task_name: taskModalInput.trim() } })
    }
    setShowTaskModal(false)
  }

  function handleCardClick(card) {
    if (gameState !== 'voting') return
    setPendingCard(card)
    setJustification('')
    setShowVoteModal(true)
  }

  function confirmVote(withJustification = true) {
    setMyVote(pendingCard)
    send({ type: 'vote_cast', payload: { vote: pendingCard, justification: withJustification ? justification : '' } })
    setShowVoteModal(false)
    setPendingCard(null)
    setJustification('')
  }

  const votedCount = players.filter(p => p.has_voted).length
  const average = votes
    ? (() => {
        const nums = votes.map(v => Number(v.vote)).filter(n => !isNaN(n) && n > 0)
        return nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : null
      })()
    : null

  // Current player at index 0 (bottom of table)
  const myIndex = players.findIndex(p => p.player_id === player_id)
  const orderedPlayers = myIndex > 0
    ? [...players.slice(myIndex), ...players.slice(0, myIndex)]
    : players

  return (
    <div className={styles.layout}>

      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.logoSmall}>🃏 PocketScrum</span>
          <span className={styles.badge}>Room <strong>{room_code}</strong></span>
          {is_scrum_master && <span className={styles.smBadge}>Scrum Master</span>}
        </div>
        <div className={styles.headerRight}>
          <span className={styles.roundBadge}>Round #{round}</span>
          {is_scrum_master && onVelocity && (
            <button className={styles.velocityBtn} onClick={onVelocity}>📈 Vélocité</button>
          )}
          <button className={styles.leaveBtn} onClick={onLeave}>Quitter</button>
        </div>
      </header>

      {/* Poker table */}
      <div className={styles.tableArea}>
        <div className={styles.tableWrapper} style={{ height: getWrapperHeight(players.length) }}>

          {/* Table felt */}
          <div className={styles.pokerTable} />

          {/* Player seats */}
          {orderedPlayers.map((p, i) => {
            const isMe      = p.player_id === player_id
            const voteData  = votes?.find(v => v.player_id === p.player_id)
            const pos       = computeSeatPosition(i, orderedPlayers.length)

            return (
              <div
                key={p.player_id}
                className={`${styles.seat} ${isMe ? styles.seatMe : ''}`}
                style={pos}
              >
                <div className={[
                  styles.seatCard,
                  gameState === 'revealed' ? styles.seatCardRevealed : p.has_voted ? styles.seatCardVoted : '',
                  isMe ? styles.seatCardMe : '',
                ].filter(Boolean).join(' ')}>
                  {gameState === 'revealed' ? (voteData?.vote ?? '—') : p.has_voted ? '✓' : '?'}
                </div>

                {gameState === 'revealed' && voteData?.justification && (
                  <div className={styles.seatJustification}>"{voteData.justification}"</div>
                )}

                <div className={styles.seatName}>
                  {p.player_name}{isMe && ' (moi)'}
                </div>
                <span className={`${styles.roleBadge} ${p.role === 'qa' ? styles.roleBadgeQa : styles.roleBadgeDev}`}>
                  {p.role === 'qa' ? 'QA' : 'Dev'}
                </span>
              </div>
            )
          })}

          {/* Table center */}
          <div className={styles.tableCenter}>
            {taskName ? (
              <p className={styles.tableTask}>{taskName}</p>
            ) : is_scrum_master ? (
              <button className={styles.nameTaskBtn} onClick={() => openTaskModal('name_task')}>
                + Nommer la tâche
              </button>
            ) : (
              <p className={styles.tableNoTask}>En attente d'une tâche…</p>
            )}

            <p className={styles.tableProgress}>
              {votedCount}/{players.length} ont voté
              {votedCount === players.length && players.length > 0 && ' ✓'}
            </p>

            {gameState === 'revealed' && average && (
              <div className={styles.tableAverage}>⌀ {average}</div>
            )}

            {is_scrum_master && gameState === 'voting' && (
              <button
                className={styles.revealBtn}
                onClick={() => send({ type: 'votes_reveal' })}
                disabled={votedCount === 0}
              >
                Révéler les votes
              </button>
            )}

            {is_scrum_master && gameState === 'revealed' && (
              <button className={styles.newRoundBtn} onClick={() => openTaskModal('new_round')}>
                Nouveau round →
              </button>
            )}
          </div>

        </div>
      </div>

      {/* Card hand — visible only during voting */}
      {gameState === 'voting' && (
        <div className={styles.hand}>
          {CARDS.map(card => (
            <button
              key={card}
              className={[styles.card, myVote === card ? styles.cardSelected : ''].join(' ')}
              onClick={() => handleCardClick(card)}
            >
              {card}
            </button>
          ))}
        </div>
      )}

      {/* Activity log */}
      {log.length > 0 && (
        <footer ref={logRef} className={styles.log}>
          {log.map((entry, i) => <p key={i}>{entry}</p>)}
        </footer>
      )}

      {/* Vote justification modal */}
      {showVoteModal && (
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
              <button className={styles.modalSkip}    onClick={() => confirmVote(false)}>Passer</button>
            </div>
          </div>
        </div>
      )}

      {/* Task name / new round modal */}
      {showTaskModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3>{taskModalMode === 'new_round' ? 'Nouveau round' : 'Nommer la tâche'}</h3>
            <p className={styles.modalSubtitle}>
              {taskModalMode === 'new_round'
                ? 'Nom de la prochaine tâche (optionnel)'
                : 'Quel est le nom de cette tâche ?'}
            </p>
            <input
              className={styles.modalInput}
              value={taskModalInput}
              onChange={e => setTaskModalInput(e.target.value)}
              placeholder="Ex : Intégrer la page de connexion"
              maxLength={60}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') confirmTaskModal() }}
            />
            <div className={styles.modalActions}>
              <button className={styles.modalConfirm} onClick={confirmTaskModal}>
                {taskModalMode === 'new_round' ? 'Lancer' : 'Confirmer'}
              </button>
              <button className={styles.modalSkip} onClick={() => setShowTaskModal(false)}>
                {taskModalMode === 'new_round' ? 'Passer' : 'Annuler'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
