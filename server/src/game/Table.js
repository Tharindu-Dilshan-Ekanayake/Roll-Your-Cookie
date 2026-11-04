const DATA = require('./data')

const T = DATA.timing
const TM = DATA.timer
/** Synced `time0`/`time1` values before a round is revealed, and for a player who never pressed. */
const HIDDEN = -1
const NO_PRESS = -2
/** After the result: when the loser's chair launches them out, in seconds. */
const EJECT_AT_S = 0.9
/** Phases in which a duel is under way (leaving one is a forfeit). */
const PLAYING = new Set(['target', 'running', 'reveal'])

const randomInt = (n) => Math.floor(Math.random() * n)
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

/** Settings for round `n` (1-based); rounds past the list reuse its last entry. */
const roundConfig = (n) => TM.rounds[Math.min(n, TM.rounds.length) - 1]

/**
 * A random target for round `n`, to the millisecond (e.g. 7.384 s): never a round
 * number to aim for. A whole or half second is rerolled.
 */
function pickTarget(n) {
  const r = roundConfig(n)
  let ms
  do ms = Math.round((r.min + Math.random() * (r.max - r.min)) * 1000)
  while (ms % 500 === 0)
  return ms
}

/**
 * One two-seat table and the duel played at it.
 *
 * Every round has a target time. A clock starts from zero in front of both players;
 * it shows for the first second or few (less each round), then goes blind. Each
 * player stops their own clock when they think it has reached the target. The
 * closer stop wins the round; the first to DATA.timer.winsNeeded rounds wins.
 *
 * Phases:
 *   waiting   - zero or one player seated
 *   countdown - both seats filled, "Starting in 3..."
 *   target    - the round's target is announced; the clock starts as it ends
 *   running   - the clock runs (visible, then blind) until both have pressed or
 *               DATA.timer.overSec after the target
 *   reveal    - both stopped times and the round's winner on screen
 *   ended     - result on screen; both players are stood up when it runs out
 *
 * The server keeps the time: a press counts from the round's start on the server
 * clock, so the client's reading is only trusted within DATA.timer.lagMs of it
 * (its network delay). Nobody learns the other's time until the reveal.
 */
class Table {
  /**
   * @param {{ id: number, x: number, z: number }} def
   * @param {import('./GameRoom')} room
   * @param {object} state this table's synced TableState, for every client to see
   */
  constructor(def, room, state) {
    this.id = def.id
    this.x = def.x
    this.z = def.z
    this.room = room
    this.state = state
    /** @type {Array<import('./Session')|null>} */
    this.seats = [null, null]
    this.token = 0
    this.reset()
  }

  reset() {
    this.phase = 'waiting'
    this.endsAt = 0
    this.startAt = 0
    this.round = 0
    this.target = 0
    this.showMs = 0
    this.score = [0, 0]
    /** What each seat's clock read when they stopped it this round, in ms (null = not yet). */
    this.pressed = [null, null]
    /** Total distance from the targets over every round: the tie-break after the last one. */
    this.errors = [0, 0]
    /** Rounds in a row each seat let pass without pressing. */
    this.misses = [0, 0]
    this.roundWinner = -1
    /** Seat index of the winner once the duel has ended, else -1. */
    this.winner = -1
    // Invalidates any setTimeout scheduled for the previous match.
    this.token += 1
  }

  seatOf(session) {
    return this.seats.indexOf(session)
  }

  sit(session, now) {
    if (this.phase !== 'waiting') return 'This table is already playing'
    const free = this.seats.indexOf(null)
    if (free < 0) return 'This table is full'

    this.seats[free] = session
    session.seat = { table: this, index: free }

    if (this.seats[0] && this.seats[1]) {
      this.phase = 'countdown'
      this.endsAt = now + T.countdown * 1000
    }
    this.sync(now)
    return null
  }

  /**
   * A seated player stands up (`gone` false: they pressed Quit / Leave) or
   * disconnected (`gone` true). Leaving a duel under way is a forfeit.
   */
  leave(session, now, { gone = false } = {}) {
    const i = this.seatOf(session)
    if (i < 0) return
    const other = this.seats[1 - i]

    if (PLAYING.has(this.phase) && other) {
      this.finish(1 - i, i, 'forfeit', now)
      if (!gone) this.room.bubble(session, 'I give up! 🏳️')
    } else if (this.phase === 'countdown') {
      other?.toast('Your opponent left the table')
    }

    this.unseat(i)
    if (this.phase !== 'ended') {
      // The remaining player (if any) keeps their seat and waits for someone new.
      this.reset()
      if (other) this.room.bubble(other, '')
    }
    this.sync(now)
  }

  unseat(i) {
    const session = this.seats[i]
    if (!session) return
    this.seats[i] = null
    session.seat = null
    session.send('match', { match: null })
  }

  /** Announces the next round's target; its clock starts when this phase ends. */
  startRound(now) {
    this.round += 1
    this.target = pickTarget(this.round)
    this.showMs = Math.round(roundConfig(this.round).show * 1000)
    this.pressed = [null, null]
    this.roundWinner = -1
    this.phase = 'target'
    this.endsAt = now + T.target * 1000
    this.startAt = this.endsAt
    this.sync(now)
  }

  startRunning(now) {
    this.phase = 'running'
    this.endsAt = this.startAt + this.target + TM.overSec * 1000
    this.sync(now)
  }

  /**
   * A player stops their clock. `ms` is what their own clock read (the client's
   * view of the time since the start); it only counts within DATA.timer.lagMs
   * before the server received the press, never later.
   */
  press(session, ms, now) {
    const i = this.seatOf(session)
    if (i < 0) return
    // The tick that starts the clock may not have run yet.
    if (this.phase === 'target' && now >= this.startAt) this.startRunning(now)
    if (this.phase !== 'running' || this.pressed[i] !== null) return

    const elapsed = now - this.startAt
    const claimed = Number.isFinite(ms) ? ms : elapsed
    this.pressed[i] = Math.round(clamp(claimed, Math.max(0, elapsed - TM.lagMs), elapsed))
    this.room.bubble(session, 'STOP! ✋')
    this.room.broadcast('fx', { kind: 'press', id: session.id })

    if (this.pressed[1 - i] !== null) this.resolveRound(now)
    else this.sync(now)
  }

  /** Both have pressed (or time ran out): who was closer? */
  resolveRound(now) {
    const err = this.pressed.map((p) => (p === null ? Infinity : Math.abs(p - this.target)))
    let w = -1
    if (err[0] < err[1]) w = 0
    else if (err[1] < err[0]) w = 1
    this.roundWinner = w
    if (w >= 0) this.score[w] += 1

    err.forEach((e, i) => {
      this.errors[i] += Math.min(e, TM.overSec * 1000)
      this.misses[i] = this.pressed[i] === null ? this.misses[i] + 1 : 0
      const s = this.seats[i]
      if (!s) return
      if (i === w) this.room.bubble(s, e <= TM.closeMs ? 'Nailed it! 😎' : 'Closer! 😏')
      else if (e === Infinity) this.room.bubble(s, 'Too late! 🐢')
      else if (w >= 0) this.room.bubble(s, 'So close! 😬')
      else this.room.bubble(s, 'A tie?! 🤝')
      if (e <= TM.closeMs) this.room.questEvent(s, 'close', now)
      if (e <= TM.bullseyeMs) {
        this.room.bonusCash(s, TM.bullseyeCash, now)
        this.room.questEvent(s, 'bullseye', now)
        this.room.bubble(s, 'BULLSEYE! 🎯')
        this.room.broadcast('fx', { kind: 'bullseye', id: s.id })
      }
    })
    // Everyone in the room sees the round's loser get a little zap from their button.
    const loser = w >= 0 ? this.seats[1 - w] : null
    if (loser) this.room.broadcast('fx', { kind: 'zap', id: loser.id })

    this.phase = 'reveal'
    this.endsAt = now + T.reveal * 1000
    this.sync(now)
  }

  /** After a reveal: the duel is decided, or on to the next round. */
  afterReveal(now) {
    const decided = this.score.findIndex((s) => s >= TM.winsNeeded)
    if (decided >= 0) {
      this.finish(decided, 1 - decided, 'timer', now)
      return
    }
    // Nobody is pressing any more: call the duel off rather than run it forever.
    if (this.misses[0] >= 2 && this.misses[1] >= 2) {
      for (const s of this.seats) s?.toast('Nobody stopped the clock: duel cancelled')
      this.unseat(0)
      this.unseat(1)
      this.reset()
      this.sync(now)
      return
    }
    const asleep = this.misses.findIndex((m) => m >= 2)
    if (asleep >= 0) {
      this.finish(1 - asleep, asleep, 'afk', now)
      return
    }
    if (this.round >= TM.maxRounds) {
      // Out of rounds: the higher score, then the smaller total error, wins.
      const [a, b] = this.score
      const [ea, eb] = this.errors
      let w
      if (a !== b) w = a > b ? 0 : 1
      else if (ea !== eb) w = ea < eb ? 0 : 1
      else w = randomInt(2)
      this.finish(w, 1 - w, 'timer', now)
      return
    }
    this.startRound(now)
  }

  /**
   * Ends the duel. A quitter (`reason` 'forfeit') pays DATA.forfeit.penalty, which
   * goes to the winner on top of the prize. A loser still in their seat is launched
   * out of it by their chair, then respawns in the lobby while the winner dances.
   */
  finish(w, l, reason, now) {
    this.phase = 'ended'
    this.endsAt = now + T.results * 1000
    this.winner = w

    const winner = this.seats[w]
    const loser = this.seats[l]
    let reward = 0

    const played = reason === 'timer'
    const penalty = reason === 'forfeit' && loser ? this.room.takeCash(loser, DATA.forfeit.penalty, now) : 0
    if (winner) {
      reward = this.room.recordWin(winner, { flawless: played && this.score[l] === 0 }, now)
      if (penalty) reward += this.room.bonusCash(winner, penalty, now)
    }
    let consolation = 0
    if (loser) consolation = this.room.recordLoss(loser, now, reason)
    if (loser && played) this.room.bubble(loser, 'NOOO! 😭')
    if (winner) this.room.bubble(winner, reason === 'forfeit' ? 'GG 👍' : 'Too easy! 😎')

    this.room.broadcast('result', {
      table: this.id,
      winner: winner?.id ?? null,
      loser: loser?.id ?? null,
      score: [...this.score],
      reward,
      consolation,
      penalty,
      reason,
    })
    this.sync(now)
    // Round end: report leaderboard scores now rather than at the next batch.
    this.room.flushScores()

    const token = this.token
    const stillSeated = () => this.token === token && loser && this.seats[l] === loser
    this.room.clock.setTimeout(() => {
      if (stillSeated()) this.room.broadcast('fx', { kind: 'eject', id: loser.id, by: winner?.id ?? '' })
    }, EJECT_AT_S * 1000)
    this.room.clock.setTimeout(() => {
      if (!stillSeated()) return
      this.unseat(l)
      loser.respawn()
      this.sync(Date.now())
    }, T.loserRespawn * 1000)
  }

  tick(now) {
    if (this.phase === 'waiting' || now < this.endsAt) return

    if (this.phase === 'countdown') {
      this.startRound(now)
    } else if (this.phase === 'target') {
      this.startRunning(now)
    } else if (this.phase === 'running') {
      // Out of time: whoever hasn't pressed loses the round.
      this.resolveRound(now)
    } else if (this.phase === 'reveal') {
      this.afterReveal(now)
    } else if (this.phase === 'ended') {
      this.unseat(0)
      this.unseat(1)
      this.reset()
      this.sync(now)
    }
  }

  /** A seat's synced time: secret until the reveal. */
  shownTime(i) {
    if (this.phase !== 'reveal' && this.phase !== 'ended') return HIDDEN
    return this.pressed[i] ?? NO_PRESS
  }

  privateState(i, now) {
    const o = 1 - i
    const ended = this.phase === 'ended'
    let roundWinner = null
    if (this.phase === 'reveal') roundWinner = this.roundWinner < 0 ? 'tie' : this.roundWinner === i ? 'me' : 'them'
    return {
      table: this.id,
      seat: i,
      phase: this.phase,
      endsInMs: Math.max(0, this.endsAt - now),
      /** Until the clock starts (negative once it has): turned into a local time on receipt. */
      startInMs: this.startAt ? this.startAt - now : 0,
      round: this.round,
      target: this.target,
      showMs: this.showMs,
      myScore: this.score[i],
      theirScore: this.score[o],
      pressed: this.pressed[i] !== null,
      theirPressed: this.pressed[o] !== null,
      myTime: this.shownTime(i),
      theirTime: this.shownTime(o),
      roundWinner,
      won: ended && this.winner === i,
      opponent: this.seats[o]?.id ?? null,
    }
  }

  /**
   * Publishes the table: the public part through the synced state (Colyseus sends
   * only fields that changed), the private part to each seated player.
   */
  sync(now = Date.now()) {
    const st = this.state
    const inRound = PLAYING.has(this.phase) || this.phase === 'ended'
    st.phase = this.phase
    st.seat0 = this.seats[0]?.id ?? ''
    st.seat1 = this.seats[1]?.id ?? ''
    st.chair0 = this.seats[0]?.profile.equippedChair ?? ''
    st.chair1 = this.seats[1]?.profile.equippedChair ?? ''
    st.winner = this.phase === 'ended' ? (this.seats[this.winner]?.id ?? '') : ''
    st.endsAt = this.phase === 'waiting' ? 0 : this.endsAt
    st.startAt = inRound ? this.startAt : 0
    st.round = this.round
    st.target = inRound ? this.target : 0
    st.show = inRound ? this.showMs : 0
    st.score0 = this.score[0]
    st.score1 = this.score[1]
    st.stop0 = this.phase === 'running' && this.pressed[0] !== null
    st.stop1 = this.phase === 'running' && this.pressed[1] !== null
    st.time0 = this.shownTime(0)
    st.time1 = this.shownTime(1)
    st.rwin = this.phase === 'reveal' ? this.roundWinner : -1
    this.seats.forEach((s, i) => s?.send('match', { match: this.privateState(i, now) }))
  }
}

module.exports = Table
