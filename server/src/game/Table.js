const DATA = require('./data')
const { plinko } = require('./plinko')

const T = DATA.timing
const D = DATA.duel
const CUPS = D.cups
const KINDS = DATA.poisonKinds.length
/** After the result: when the loser is launched away from the table, in seconds. */
const EJECT_AT_S = 0.9
/** Phases in which a duel is under way (leaving one is a forfeit). */
const PLAYING = new Set(['poison', 'aim', 'rolling', 'reveal'])
/** The server moves on this long after a cookie lands, so every client has seen it land. */
const LAND_PAD_MS = 150
/** Rounds in a row without touching anything before a player counts as asleep. */
const AFK_ROUNDS = 2
/**
 * A drop's aim must be somewhere the launcher really was, at most this long before
 * the server got it (the player's round-trip time), give or take AIM_SLACK.
 */
const AIM_LAG_MS = 500
const AIM_SLACK = 0.03

const randomInt = (n) => Math.floor(Math.random() * n)
/** Cups each player poisons in round `n` (1-based); rounds past the list reuse its last entry. */
const poisonsFor = (n) => D.poisons[Math.min(n, D.poisons.length) - 1]

/** A list of distinct cup indexes from untrusted input, at most `max` long. */
function cleanCups(raw, max) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const c of raw.slice(0, CUPS)) {
    if (Number.isInteger(c) && c >= 0 && c < CUPS && !out.includes(c)) out.push(c)
    if (out.length >= max) break
  }
  return out
}

/**
 * One two-seat table and the cookie duel played at it.
 *
 * Every round, both players secretly poison some of the seven cups at the bottom of
 * the board (more each round). Then each drops a cookie in turn: it slides along
 * the launcher at the top until they let go, bounces down through the pegs and
 * lands in a cup. A cup the OTHER player poisoned costs a heart; milk is safe. The
 * last player with hearts wins.
 *
 * Phases:
 *   waiting   - zero or one player seated (they can ask for a bot: addBot)
 *   countdown - both seats filled, "Starting in 3..."
 *   poison    - both pick their cups; ends when both are ready or time runs out
 *   aim       - `turn`'s cookie sweeps along the launcher until they drop it
 *   rolling   - the cookie is on its way down (the server already knows the cup)
 *   reveal    - milk or poison, on screen; then the next turn or round
 *   ended     - result on screen; both players stand up when it runs out
 *
 * A roll is decided here: the client sends where it let go (its aim), the server
 * draws the seed, runs shared/plinko.mjs and broadcasts aim + seed so every client
 * animates the identical path. Which cups are poisoned never leaves the server
 * except to the player who poisoned them.
 */
class Table {
  /**
   * @param {{ id: number, x: number, z: number, ry: number }} def
   * @param {import('./GameRoom')} room
   * @param {object} state this table's synced TableState, for every client to see
   */
  constructor(def, room, state) {
    this.id = def.id
    this.x = def.x
    this.z = def.z
    this.ry = def.ry || 0
    this.room = room
    this.state = state
    /** @type {Array<import('./Session').Session|import('./Bot')|null>} */
    this.seats = [null, null]
    this.token = 0
    /** When the one seated player sat down (a bot joins them after a while). */
    this.waitingSince = 0
    this.reset()
  }

  reset() {
    this.phase = 'waiting'
    this.endsAt = 0
    this.round = 0
    this.poisons = poisonsFor(1)
    this.hearts = [D.hearts, D.hearts]
    /** Cups each seat has poisoned (for the other to fall into), in the order picked. */
    this.traps = [[], []]
    this.ready = [false, false]
    /** Who drops this turn (-1 outside the turns), and who went first this round. */
    this.turn = -1
    this.first = randomInt(2)
    this.rolled = [false, false]
    this.aimAt = 0
    /** The roll in flight / just landed: { seat, aim, seed, cup, hurt, kind }. */
    this.roll = null
    /** Each seat did something itself this round (picked a cup or dropped). */
    this.acted = [false, false]
    this.idle = [0, 0]
    /** Per seat: hearts lost, opponents poisoned. */
    this.lost = [0, 0]
    this.poisonedThem = [0, 0]
    /** Seat index of the winner once the duel has ended, else -1. */
    this.winner = -1
    // Invalidates any setTimeout scheduled for the previous match.
    this.token += 1
    this.waitingSince = Date.now()
  }

  seatOf(session) {
    return this.seats.indexOf(session)
  }

  /**
   * The player waiting here asked to play a bot (only ever on request: a bot never
   * sits down by itself). Returns an error message, or null.
   */
  addBot(session, now) {
    if (this.seatOf(session) < 0) return null
    if (this.phase !== 'waiting' || !this.seats.includes(null)) return 'This table is already playing'
    return this.sit(this.room.createBot(this), now)
  }

  /** The spot beside the board where seat `index` stands (as client/src/game/layout.js). */
  seatSpot(index) {
    const lx = DATA.table.seatX
    const lz = (index === 0 ? 1 : -1) * DATA.table.seatZ
    const c = Math.cos(this.ry)
    const s = Math.sin(this.ry)
    return { x: this.x + lx * c + lz * s, z: this.z - lx * s + lz * c, ry: this.ry + (index === 0 ? Math.PI : 0) }
  }

  /** Seats filled by people (not bots). */
  humans() {
    return this.seats.filter((s) => s && !s.isBot).length
  }

  sit(session, now) {
    if (this.phase !== 'waiting') return 'This table is already playing'
    const free = this.seats.indexOf(null)
    if (free < 0) return 'This table is full'

    this.seats[free] = session
    session.seat = { table: this, index: free }
    // Where they stand now, for everyone (and for Quick Play's distances).
    const spot = this.seatSpot(free)
    session.player.x = spot.x
    session.player.z = spot.z
    session.player.ry = spot.ry

    if (this.seats[0] && this.seats[1]) {
      this.phase = 'countdown'
      this.endsAt = now + T.countdown * 1000
    } else {
      this.waitingSince = now
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
      // The remaining player (if any) keeps their seat and waits for someone new; a
      // bot never waits on its own.
      this.reset()
      if (other?.isBot) this.unseat(1 - i)
      else if (other) this.room.bubble(other, '')
    }
    this.sync(now)
  }

  unseat(i) {
    const session = this.seats[i]
    if (!session) return
    this.seats[i] = null
    session.seat = null
    if (session.isBot) session.dispose()
    else session.send('match', { match: null })
  }

  /* ---- Rounds ---------------------------------------------------------------------- */

  startRound(now) {
    this.round += 1
    this.poisons = poisonsFor(this.round)
    // Last round's picks stay selected (the player can change them).
    this.traps = this.traps.map((t) => t.slice(0, this.poisons))
    this.ready = [false, false]
    this.rolled = [false, false]
    this.acted = [false, false]
    this.turn = -1
    this.roll = null
    this.phase = 'poison'
    this.endsAt = now + T.poison * 1000
    this.sync(now)
  }

  /** A player's poison picks (and whether they've locked them in). */
  setTraps(session, cups, ready, now) {
    const i = this.seatOf(session)
    if (i < 0 || this.phase !== 'poison') return
    this.traps[i] = cleanCups(cups, this.poisons)
    this.acted[i] = true
    this.ready[i] = Boolean(ready) && this.traps[i].length === this.poisons
    if (this.ready[0] && this.ready[1]) this.startTurns(now)
    else this.sync(now)
  }

  /** Poison is set (missing picks are made at random): the first player aims. */
  startTurns(now) {
    for (const traps of this.traps) {
      while (traps.length < this.poisons) {
        const c = randomInt(CUPS)
        if (!traps.includes(c)) traps.push(c)
      }
    }
    // Who goes first alternates every round.
    if (this.round > 1) this.first = 1 - this.first
    this.turn = this.first
    this.startAim(now)
  }

  startAim(now) {
    this.phase = 'aim'
    this.aimAt = now
    this.endsAt = now + T.aim * 1000
    this.roll = null
    this.sync(now)
  }

  /** The player whose turn it is lets go of their cookie at `aim` (board u). */
  drop(session, aim, now) {
    const i = this.seatOf(session)
    if (i < 0 || this.phase !== 'aim' || this.turn !== i) return
    this.acted[i] = true
    this.doRoll(this.checkedAim(Number(aim), now), now)
  }

  /**
   * The aim the server accepts: the client's own (so its animation, already under
   * way, carries on unchanged) if the launcher really passed there within the last
   * AIM_LAG_MS, otherwise the nearest place it did pass. A modified client can't
   * drop anywhere it likes, only where the cookie actually was.
   */
  checkedAim(aim, now) {
    const { aimAt, clampAim } = plinko()
    const claimed = clampAim(aim)
    const elapsed = now - this.aimAt
    let nearest = aimAt(elapsed, this.round)
    let error = Math.abs(nearest - claimed)
    for (let e = Math.max(0, elapsed - AIM_LAG_MS); e <= elapsed && error > AIM_SLACK; e += 5) {
      const a = aimAt(e, this.round)
      const d = Math.abs(a - claimed)
      if (d < error) {
        error = d
        nearest = a
      }
    }
    return error <= AIM_SLACK ? claimed : nearest
  }

  doRoll(aim, now) {
    const { roll, clampAim } = plinko()
    const seat = this.turn
    const x = clampAim(aim)
    const seed = (Math.random() * 4294967296) >>> 0
    const result = roll(x, seed)
    const trap = this.traps[1 - seat].indexOf(result.cup)
    const hurt = trap >= 0
    this.roll = { seat, aim: x, seed, cup: result.cup, hurt, kind: hurt ? trap % KINDS : -1 }
    this.phase = 'rolling'
    this.endsAt = now + result.seconds * 1000 + LAND_PAD_MS

    const roller = this.seats[seat]
    this.room.broadcast('roll', {
      table: this.id,
      seat,
      id: roller?.id ?? '',
      aim: x,
      seed,
      cup: result.cup,
      hurt,
      kind: this.roll.kind,
      cookie: roller?.profile.equippedCookie || 'classic',
    })
    this.room.broadcast('fx', { kind: 'drop', id: roller?.id ?? '' })
    this.sync(now)
  }

  /** The cookie is in its cup: milk, or the other player's poison. */
  land(now) {
    const { seat, hurt } = this.roll
    const roller = this.seats[seat]
    const poisoner = this.seats[1 - seat]
    if (hurt) {
      this.hearts[seat] = Math.max(0, this.hearts[seat] - 1)
      this.lost[seat] += 1
      this.poisonedThem[1 - seat] += 1
      if (poisoner && !poisoner.isBot) this.room.questEvent(poisoner, 'poisoned', now)
      this.room.bubble(roller, this.hearts[seat] > 0 ? 'Bleh! 🤢' : 'NOOO! 😵')
      this.room.bubble(poisoner, 'Gotcha! 😈')
    } else {
      if (roller && !roller.isBot) {
        this.room.questEvent(roller, 'milk', now)
        if (D.milkBonus && !poisoner?.isBot) this.room.bonusCash(roller, D.milkBonus, now)
      }
      this.room.bubble(roller, 'Yum! 🥛')
    }
    this.phase = 'reveal'
    this.endsAt = now + T.reveal * 1000
    this.sync(now)
  }

  /** After a reveal: someone is out of hearts, the other player's turn, or a new round. */
  afterReveal(now) {
    const seat = this.roll.seat
    this.rolled[seat] = true
    if (this.hearts[seat] <= 0) {
      this.finish(1 - seat, seat, 'hearts', now)
      return
    }
    if (!this.rolled[1 - seat]) {
      this.turn = 1 - seat
      this.startAim(now)
      return
    }
    this.endRound(now)
  }

  endRound(now) {
    this.idle = this.idle.map((n, i) => (this.acted[i] ? 0 : n + 1))
    // Nobody is playing any more: call the duel off rather than run it forever.
    if (this.idle[0] >= AFK_ROUNDS && this.idle[1] >= AFK_ROUNDS) {
      for (const s of this.seats) s?.toast('Nobody was playing: duel cancelled')
      this.unseat(0)
      this.unseat(1)
      this.reset()
      this.sync(now)
      return
    }
    const asleep = this.idle.findIndex((n) => n >= AFK_ROUNDS)
    if (asleep >= 0) {
      this.finish(1 - asleep, asleep, 'afk', now)
      return
    }
    if (this.round >= D.maxRounds) {
      // Out of rounds: more hearts left wins, then more poisonings, then a coin toss.
      const [a, b] = this.hearts
      const [pa, pb] = this.poisonedThem
      let w
      if (a !== b) w = a > b ? 0 : 1
      else if (pa !== pb) w = pa > pb ? 0 : 1
      else w = randomInt(2)
      this.finish(w, 1 - w, 'hearts', now)
      return
    }
    this.startRound(now)
  }

  /**
   * Ends the duel. A quitter (`reason` 'forfeit') pays DATA.forfeit.penalty, which
   * goes to the winner on top of the prize. The loser, if still there, is launched
   * away from the table, then respawns in the lobby while the winner dances.
   */
  finish(w, l, reason, now) {
    this.phase = 'ended'
    this.endsAt = now + T.results * 1000
    this.winner = w

    const winner = this.seats[w]
    const loser = this.seats[l]
    const vsBot = Boolean(winner?.isBot || loser?.isBot)
    let reward = 0

    const played = reason === 'hearts'
    const human = (s) => s && !s.isBot
    const penalty =
      reason === 'forfeit' && human(loser) && human(winner) ? this.room.takeCash(loser, DATA.forfeit.penalty, now) : 0
    if (human(winner)) {
      reward = this.room.recordWin(winner, { flawless: played && this.lost[w] === 0, vsBot }, now)
      if (penalty) reward += this.room.bonusCash(winner, penalty, now)
    }
    let consolation = 0
    if (human(loser)) consolation = this.room.recordLoss(loser, now, reason, vsBot)
    if (loser && played) this.room.bubble(loser, 'I got cooked! 😭')
    if (winner) this.room.bubble(winner, reason === 'forfeit' ? 'GG 👍' : 'Too easy! 😎')

    this.room.broadcast('result', {
      table: this.id,
      winner: winner?.id ?? null,
      loser: loser?.id ?? null,
      hearts: [...this.hearts],
      reward,
      consolation,
      penalty,
      reason,
      vsBot,
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
      if (!loser.isBot) loser.respawn()
      this.sync(Date.now())
    }, T.loserRespawn * 1000)
  }

  tick(now) {
    for (let i = 0; i < 2; i += 1) {
      const s = this.seats[i]
      if (s?.isBot) s.think(this, i, now)
    }

    if (this.phase === 'waiting') return
    if (now < this.endsAt) return

    if (this.phase === 'countdown') {
      this.startRound(now)
    } else if (this.phase === 'poison') {
      this.startTurns(now)
    } else if (this.phase === 'aim') {
      // Out of time: the cookie drops wherever the launcher has got to.
      this.doRoll(plinko().aimAt(now - this.aimAt, this.round), now)
    } else if (this.phase === 'rolling') {
      this.land(now)
    } else if (this.phase === 'reveal') {
      this.afterReveal(now)
    } else if (this.phase === 'ended') {
      this.unseat(0)
      this.unseat(1)
      this.reset()
      this.sync(now)
    }
  }

  privateState(i, now) {
    const o = 1 - i
    const ended = this.phase === 'ended'
    const opponent = this.seats[o]
    return {
      table: this.id,
      seat: i,
      phase: this.phase,
      endsInMs: Math.max(0, this.endsAt - now),
      round: this.round,
      poisons: this.poisons,
      hearts: [...this.hearts],
      maxHearts: D.hearts,
      /** Only your own poison: theirs stays on the server. */
      myTraps: [...this.traps[i]],
      ready: [...this.ready],
      turn: this.turn,
      /** How long ago the current aim started (the launcher's sweep), in ms. */
      aimElapsedMs: this.phase === 'aim' ? now - this.aimAt : 0,
      roll: this.roll ? { seat: this.roll.seat, cup: this.roll.cup, hurt: this.roll.hurt, kind: this.roll.kind } : null,
      won: ended && this.winner === i,
      opponent: opponent?.id ?? null,
      vsBot: Boolean(opponent?.isBot),
    }
  }

  /**
   * Publishes the table: the public part through the synced state (Colyseus sends
   * only fields that changed), the private part to each seated player.
   */
  sync(now = Date.now()) {
    const st = this.state
    st.phase = this.phase
    st.seat0 = this.seats[0]?.id ?? ''
    st.seat1 = this.seats[1]?.id ?? ''
    st.cookie0 = this.seats[0]?.profile.equippedCookie ?? ''
    st.cookie1 = this.seats[1]?.profile.equippedCookie ?? ''
    st.winner = this.phase === 'ended' ? (this.seats[this.winner]?.id ?? '') : ''
    st.endsAt = this.phase === 'waiting' ? 0 : this.endsAt
    st.aimAt = this.phase === 'aim' ? this.aimAt : 0
    st.round = this.round
    st.poisons = this.poisons
    st.hearts0 = this.hearts[0]
    st.hearts1 = this.hearts[1]
    st.turn = this.turn
    st.ready0 = this.ready[0]
    st.ready1 = this.ready[1]
    const landed = this.phase === 'reveal' && this.roll
    st.lastCup = landed ? this.roll.cup : -1
    st.lastKind = landed ? this.roll.kind : -1
    this.seats.forEach((s, i) => s?.send('match', { match: this.privateState(i, now) }))
  }
}

module.exports = Table
