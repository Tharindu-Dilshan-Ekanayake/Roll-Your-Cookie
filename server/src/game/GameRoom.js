const { Room, ServerError } = require('@colyseus/core')

const { resolveIdentity } = require('../bloxity/identity')
const Bot = require('./Bot')
const { flushScores, submitScore } = require('../bloxity/leaderboards')
const DATA = require('./data')
const profiles = require('./profiles')
const { GameState, PlayerState, TableState } = require('./schema')
const { cleanName, Session } = require('./Session')
const Table = require('./Table')

const TICK_MS = 100
/** 10 Hz state patches: positions are interpolated client-side, so more buys nothing. */
const PATCH_MS = 100
/** How long a dropped player keeps their place (and table seat) while reconnecting. */
const RECONNECT_SECONDS = 20
const LEADERBOARD_PUSH_MS = 15000
/** How often time in the game is counted for everyone connected. */
const PLAYTIME_TICK_MS = 30000
/** Close code for a session replaced by the same account joining from elsewhere. */
const REPLACED = 4100
/** Close code for a player moved out of the lobby for being away (see checkAway). */
const AWAY = 4101
/** How often everyone's last activity is checked. */
const AWAY_CHECK_MS = 5000
const AWAY_WARN_MS = DATA.afk.warnSec * 1000
const AWAY_KICK_MS = DATA.afk.kickSec * 1000

/** profile id -> live session, across every room in this process. */
const liveByProfile = new Map()

/**
 * One game server: up to DATA.roomSize (30) players sharing the island and its
 * fifteen cookie tables: every one of them can be playing at once.
 *
 * Colyseus matchmaking fills a room to `maxClients`, locks it, and `joinOrCreate`
 * then opens a new one, so "a new lobby when this one is full" is just this cap.
 * Bots (see Bot.js) are synced players but not connections: they never take a place.
 */
class GameRoom extends Room {
  maxClients = DATA.roomSize
  patchRate = PATCH_MS
  /** Clients over this are disconnected; normal play sends ~12/s. */
  maxMessagesPerSecond = 40

  onCreate() {
    this.state = new GameState()
    /** session id -> Session, including players mid-reconnect. */
    this.sessions = new Map()
    this.lastBoard = ''

    this.tables = DATA.tables.map((def) => {
      const state = new TableState()
      this.state.tables.set(String(def.id), state)
      const table = new Table(def, this, state)
      table.sync()
      return table
    })

    this.onMessage('*', (client, type, message) => {
      this.sessions.get(client.sessionId)?.handle(type, message, Date.now())
    })

    this.clock.setInterval(() => {
      const now = Date.now()
      for (const table of this.tables) table.tick(now)
    }, TICK_MS)
    this.clock.setInterval(() => this.pushLeaderboard(), LEADERBOARD_PUSH_MS)
    this.lastPlaytimeTick = Date.now()
    this.clock.setInterval(() => this.tickPlaytime(), PLAYTIME_TICK_MS)
    this.clock.setInterval(() => this.checkAway(Date.now()), AWAY_CHECK_MS)
  }

  /**
   * Nobody holds a place in a full lobby without playing: a player with no activity
   * at all (no movement, no input, no game action) for DATA.afk.warnSec is asked
   * "Still there?", and at DATA.afk.kickSec is moved out, so the place goes to
   * someone who wants to play. Mid-duel that is a forfeit, as if they had left.
   * Players mid-reconnect are left to the reconnection window.
   */
  checkAway(now) {
    for (const session of this.sessions.values()) {
      if (session.reconnection || session.kicked) continue
      const idle = now - session.lastActiveAt
      if (!session.awayWarned) {
        if (idle < AWAY_WARN_MS) continue
        // Always the whole warning window, however the checks fall.
        session.awayWarned = true
        session.awayWarnedAt = now
        session.send('afk', { inMs: AWAY_KICK_MS - AWAY_WARN_MS })
      } else if (now - session.awayWarnedAt >= AWAY_KICK_MS - AWAY_WARN_MS) {
        console.log(`[game] room ${this.roomId}: ${session.player.name} was away ${Math.round(idle / 1000)}s, freeing their place`)
        this.kick(session, AWAY)
      }
    }
  }

  /**
   * Runs before a seat is granted: verifies the Bloxity token, then loads the
   * profile. The result becomes `client.auth`.
   */
  async onAuth(_client, options) {
    const identity = await resolveIdentity(options, cleanName)
    if (!identity) throw new ServerError(400, 'Missing player identity')
    const profile = await profiles.loadProfile(identity.profileId, identity.name, {
      carriedFrom: identity.carriedFrom,
    })
    return { identity, profile }
  }

  onJoin(client, options) {
    const now = Date.now()
    const { identity, profile } = client.auth

    // One account, one place: a second tab replaces the first.
    const previous = liveByProfile.get(identity.profileId)
    if (previous) {
      previous.toast('You joined from another window')
      previous.room.kick(previous)
    }

    const player = new PlayerState()
    const session = new Session(client, this, player, identity, profile, options, now)
    this.sessions.set(client.sessionId, session)
    liveByProfile.set(identity.profileId, session)
    this.state.players.set(client.sessionId, player)
    // Puts players who levelled up before the Level board existed on it (it keeps each player's best).
    if (profile.level > 1) submitScore(session.userId, 'level', profile.level)
    this.sendWelcome(session, now)
    // Chairs became cookies: tell anyone whose old chairs were refunded (once the
    // loading screen is out of the way).
    if (profile.chairRefund > 0) {
      const refund = profile.chairRefund
      profile.chairRefund = 0
      profiles.markDirty(profile)
      this.clock.setTimeout(() => {
        if (this.sessions.get(client.sessionId) === session) {
          session.toast(`🍪 Chairs are now cookies! Your chairs were refunded: +$${refund.toLocaleString('en-US')}`)
        }
      }, 6000)
    }
  }

  onDrop(client) {
    const session = this.sessions.get(client.sessionId)
    // A kicked session must not get a reconnection window (it would linger as a
    // ghost for RECONNECT_SECONDS); without one, Colyseus goes straight to onLeave.
    if (session && !session.kicked) {
      session.reconnection = this.allowReconnection(client, RECONNECT_SECONDS)
    }
  }

  onReconnect(client) {
    const session = this.sessions.get(client.sessionId)
    if (!session) return
    session.client = client
    session.reconnection = null
    session.touch(Date.now())
    // Private messages sent while they were away are lost; resend what matters.
    this.sendWelcome(session, Date.now())
  }

  onLeave(client) {
    const session = this.sessions.get(client.sessionId)
    if (!session) return
    const now = Date.now()
    session.seat?.table.leave(session, now, { gone: true })
    session.close(now)
    profiles.release(session.profile)
    this.sessions.delete(client.sessionId)
    this.state.players.delete(client.sessionId)
    if (liveByProfile.get(session.profile.id) === session) liveByProfile.delete(session.profile.id)
  }

  onUncaughtException(error, methodName) {
    console.error(`[game] room ${this.roomId} ${methodName} failed:`, error)
  }

  /**
   * Disconnects a session, including one that is mid-reconnect, with no
   * reconnection window: its place in the room is free at once.
   */
  kick(session, code = REPLACED) {
    session.kicked = true
    if (session.reconnection) session.reconnection.reject(new Error('replaced'))
    else session.client.leave(code)
  }

  sendWelcome(session, now) {
    session.send('welcome', {
      capacity: DATA.roomSize,
      // Lets clients turn the state's server-clock deadlines into local ones.
      serverNow: now,
      profile: session.profileView(now),
      lb: profiles.leaderboards(),
    })
    // Always the current table state: messages sent while a player was dropped are
    // lost, so one who left their table meanwhile must hear they're not at it any more.
    if (session.seat) session.seat.table.sync(now)
    else session.send('match', { match: null })
  }

  pushLeaderboard() {
    const board = profiles.leaderboards()
    const json = JSON.stringify(board)
    if (json === this.lastBoard) return
    this.lastBoard = json
    this.broadcast('lb', board)
  }

  /** Counts time played for everyone here; whole minutes go to the Bloxity board. */
  tickPlaytime() {
    const now = Date.now()
    const seconds = Math.min(60, (now - this.lastPlaytimeTick) / 1000)
    this.lastPlaytimeTick = now
    for (const session of this.sessions.values()) {
      const minutes = profiles.addPlaytime(session.profile, seconds)
      if (minutes > 0) submitScore(session.userId, 'playtime', minutes)
    }
  }

  flushScores() {
    void flushScores()
  }

  /** Extra cash outside the win/loss rewards (a dunk in the milk, a quitter's penalty). Returns it. */
  bonusCash(session, amount, now) {
    session.profile.cash += amount
    profiles.markDirty(session.profile)
    session.pushProfile(now)
    return amount
  }

  /** Takes up to `amount` from a player (never below $0). Returns what was taken. */
  takeCash(session, amount, now) {
    const taken = Math.min(amount, session.profile.cash)
    if (taken <= 0) return 0
    session.profile.cash -= taken
    profiles.markDirty(session.profile)
    session.pushProfile(now)
    return taken
  }

  questEvent(session, event, now) {
    profiles.addQuestEvent(session.profile, event, 1, now)
    session.pushProfile(now)
  }

  bubble(session, text) {
    if (session) this.broadcast('bubble', { id: session.id, text })
  }

  table(id) {
    return this.tables.find((t) => t.id === id) || null
  }

  /** A computer opponent for `table` (it sits down itself). */
  createBot(table) {
    return new Bot(this, table)
  }

  /**
   * Quick Play: the best free seat for this player. Someone already waiting for an
   * opponent comes first (a real duel straight away), then the nearest empty table.
   */
  quickTable(session) {
    const waiting = this.tables.filter((t) => t.phase === 'waiting' && t.seats.includes(null) && t.humans() === 1)
    if (waiting.length) return waiting.reduce((a, b) => (b.waitingSince < a.waitingSince ? b : a))
    return this.emptyTable(session)
  }

  /** The nearest table nobody is at (Quick Play, when nobody is waiting for an opponent). */
  emptyTable(session) {
    const { x, z } = session.player
    let best = null
    let bestD = Infinity
    for (const t of this.tables) {
      if (t.phase !== 'waiting' || t.seats[0] || t.seats[1]) continue
      const d = Math.hypot(t.x - x, t.z - z)
      if (d < bestD) {
        best = t
        bestD = d
      }
    }
    return best
  }

  /**
   * Awards a win. `flawless`: won a finished duel without losing a heart. `vsBot`:
   * the opponent was a bot: less cash and XP, and nothing for the win count, the
   * streak or the leaderboards (so they can't be farmed). Returns the cash granted.
   */
  recordWin(session, { flawless = false, vsBot = false } = {}, now) {
    const p = session.profile
    const has = (pass) => p.passes.includes(pass)
    const scale = vsBot ? DATA.bot.rewardScale : 1
    const cash = Math.round(DATA.winReward * scale) * (profiles.isWeekend(now) ? 2 : 1) * (has('cash2x') ? 2 : 1)

    if (vsBot) {
      p.cash += cash
      profiles.addQuestEvent(p, 'play', 1, now)
      profiles.addQuestEvent(p, 'win', 1, now)
      if (flawless) profiles.addQuestEvent(p, 'flawless', 1, now)
      profiles.markDirty(p)
      this.giveXp(session, Math.round(DATA.xp.win * scale))
      session.pushProfile(now)
      return cash
    }

    const streakBefore = p.streak
    p.cash += cash
    p.wins += has('wins2x') ? 2 : 1
    p.streak += has('streak2x') ? 2 : 1
    p.bestStreak = Math.max(p.bestStreak, p.streak)
    profiles.addQuestEvent(p, 'play', 1, now)
    profiles.addQuestEvent(p, 'win', 1, now)
    if (flawless) profiles.addQuestEvent(p, 'flawless', 1, now)
    if (p.streak >= 3) profiles.addQuestEvent(p, 'streak3', 1, now)

    // Win-streak milestones pay a bonus, announced to the whole server.
    for (const [milestone, bonus] of Object.entries(DATA.streakBonuses)) {
      const m = Number(milestone)
      if (streakBefore < m && p.streak >= m) {
        p.cash += bonus
        session.toast(`🔥 ${m} win streak! +$${bonus}`)
        this.broadcast('toast', { text: `🔥 ${session.player.name} is on a ${m} win streak!` }, { except: session.client })
      }
    }
    profiles.markDirty(p)

    // Bloxity leaderboards, from server-owned state only.
    submitScore(session.userId, 'wins', has('wins2x') ? 2 : 1)
    submitScore(session.userId, 'best_streak', p.bestStreak)

    session.player.streak = p.streak
    this.giveXp(session, DATA.xp.win)
    session.pushProfile(now)
    return cash
  }

  /** XP for a duel; a level-up is celebrated for the player and shown to the room. */
  giveXp(session, amount) {
    const reached = profiles.addXp(session.profile, amount)
    session.player.level = session.profile.level
    if (reached.length) submitScore(session.userId, 'level', session.profile.level)
    for (const level of reached) {
      const reward = Math.min(DATA.xp.rewardCap, DATA.xp.rewardPerLevel * level)
      const title = DATA.titles.find((t) => t.level === level)
      session.send('levelUp', { level, reward, title: title?.name ?? null })
    }
  }

  /**
   * A lost duel still pays a little (and XP), so every game moves you forward.
   * Quitting or falling asleep pays nothing. Losing to a bot keeps your streak.
   * Returns the cash given.
   */
  recordLoss(session, now, reason = 'hearts', vsBot = false) {
    const p = session.profile
    if (!vsBot) p.streak = 0
    profiles.addQuestEvent(p, 'play', 1, now)
    const finished = reason === 'hearts'
    const scale = vsBot ? DATA.bot.rewardScale : 1
    const cash = finished ? Math.round(DATA.lossReward * scale) * (profiles.isWeekend(now) ? 2 : 1) : 0
    p.cash += cash
    profiles.markDirty(p)
    session.player.streak = p.streak
    if (finished) this.giveXp(session, Math.round(DATA.xp.loss * scale))
    session.pushProfile(now)
    return cash
  }
}

module.exports = GameRoom
