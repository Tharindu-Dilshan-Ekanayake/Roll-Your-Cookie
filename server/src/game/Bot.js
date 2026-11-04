const DATA = require('./data')
const { plinko } = require('./plinko')
const { PlayerState } = require('./schema')

let counter = 0

const randomInt = (n) => Math.floor(Math.random() * n)
const between = (lo, hi) => lo + Math.random() * (hi - lo)

/**
 * How much a bot likes poisoning each cup: the two end cups and the middle catch
 * the most cookies (see the distribution test of shared/plinko.mjs).
 */
const CUP_WEIGHTS = [1.3, 0.8, 1.1, 1.3, 1.1, 0.8, 1.3]

/** Bots show off cookies from the shop, cheap ones most often. */
const BOT_COOKIES = DATA.cookies.filter((c) => c.rarity !== 'mythic')
const COOKIE_WEIGHTS = BOT_COOKIES.map((c) => 1 / Math.sqrt(c.price + 150))

function weightedPick(items, weights) {
  let total = 0
  for (const w of weights) total += w
  let r = Math.random() * total
  for (let i = 0; i < items.length; i += 1) {
    r -= weights[i]
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

/**
 * A computer opponent, only ever on request and only in a quiet lobby (see
 * Session.onBot): PLAY VS BOT, while waiting alone at a table, seats one opposite the player, so
 * nobody has to wait when the server is quiet. It quacks like a Session as far as the Table
 * is concerned (id, profile, seat, send, toast) and is visible to everyone as a
 * synced player (flagged `bot`), but it isn't a connection: it never takes one of
 * the room's places, and it leaves with its match.
 *
 * It plays like a casual human: picks poison cups with a little sense (ends and
 * middle) and a lot of randomness, and drops its cookie anywhere after a moment's
 * "thought". Duels against bots pay less and don't count on the leaderboards (see
 * GameRoom.recordWin).
 */
class Bot {
  constructor(room, table) {
    counter += 1
    this.isBot = true
    this.room = room
    this.id = `bot-${table.id}-${counter}`
    const name = DATA.bot.names[randomInt(DATA.bot.names.length)]
    this.profile = { name, equippedCookie: weightedPick(BOT_COOKIES, COOKIE_WEIGHTS).id }
    this.seat = null
    /** What it last reacted to, and when it acts on it. */
    this.key = ''
    this.actAt = 0

    const p = new PlayerState()
    p.name = name
    p.bot = true
    p.level = 1 + randomInt(18)
    p.avatar = JSON.stringify({ equipped: null, proportions: null })
    p.x = table.x
    p.z = table.z
    p.g = true
    this.player = p
    room.state.players.set(this.id, p)
  }

  send() {}

  toast() {}

  /** Gone from the room with its match. */
  dispose() {
    if (this.room.state.players.has(this.id)) this.room.state.players.delete(this.id)
  }

  /** Called on every table tick while seated: acts once per phase, after a human-ish pause. */
  think(table, seat, now) {
    const key = `${table.phase}:${table.round}:${table.turn}`
    if (key !== this.key) {
      this.key = key
      this.actAt = now + (table.phase === 'poison' ? between(1500, 5000) : between(900, 3200))
    }
    if (now < this.actAt) return
    if (table.phase === 'poison' && !table.ready[seat]) {
      table.setTraps(this, this.pickCups(table.poisons), true, now)
    } else if (table.phase === 'aim' && table.turn === seat) {
      table.drop(this, between(-1, 1) * plinko().AIM_MAX, now)
    }
  }

  pickCups(n) {
    const cups = CUP_WEIGHTS.map((_, i) => i)
    const weights = CUP_WEIGHTS.map((w) => w * between(0.5, 1.5))
    const picked = []
    while (picked.length < n && cups.length) {
      const c = weightedPick(cups, weights)
      const k = cups.indexOf(c)
      cups.splice(k, 1)
      weights.splice(k, 1)
      picked.push(c)
    }
    return picked
  }
}

module.exports = Bot
