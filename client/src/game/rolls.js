import { DT, roll as simulate } from '../../../shared/plinko.mjs'
import { sfx } from '../audio/sfx'
import { useGame } from '../net/gameStore'
import { actionFx, effectQueue, localPlayer, SELF_ANCHOR } from '../net/liveState'
import { cupWorld } from './board'
import { cookieIndex } from './cookies'
import { DATA, tableById } from './layout'
import { getSettings } from './quality'

/**
 * Cookies rolling down the tables, as animation state. Every client simulates each
 * roll itself from the aim and seed the server broadcasts (shared/plinko.mjs is
 * deterministic), so the motion is smooth whatever the network does; only the
 * start of a roll travels.
 *
 * The player who drops a cookie doesn't wait for the server: the fall to the first
 * peg needs no seed, so it starts the moment they let go (`predictRoll`) and the
 * full path takes over when the server's 'roll' message arrives (`startRoll`).
 *
 * Landing is timed with setTimeout from here, never from a frame loop: that's
 * where the store is told (the reveal popup) and the splash is queued.
 * RollingCookies.jsx reads this map every frame to draw them.
 *
 * tableId -> {
 *   table, seat, type, aim, frames, steps, dist, hits, hitNext,
 *   start (performance.now() of frame 0), confirmed, cup, hurt, kind,
 *   seconds, landed, landedAt, mine, timer
 * }
 */
export const rolls = new Map()

/** An unconfirmed drop is given up after this long (the server never answered). */
const PREDICTION_TIMEOUT_MS = 4000
/** Sounds and splashes only for rolls this close to the player (or their own table). */
const HEAR_DISTANCE = 12

/** Cumulative distance along a path, for the cookie's spin. */
function distances(frames, steps) {
  const dist = new Float32Array(steps + 1)
  for (let i = 1; i <= steps; i += 1) {
    const du = frames[i * 2] - frames[i * 2 - 2]
    const dv = frames[i * 2 + 1] - frames[i * 2 - 1]
    dist[i] = dist[i - 1] + Math.sqrt(du * du + dv * dv)
  }
  return dist
}

const myTable = () => useGame.getState().match?.table ?? -1

function nearPlayer(table) {
  const p = localPlayer.position
  return Math.hypot(table.x - p.x, table.z - p.z) < HEAR_DISTANCE
}

/** The local player let go of their cookie: animate the seed-free start at once. */
export function predictRoll(tableId, seat, cookieId, aim) {
  const table = tableById(tableId)
  if (!table) return
  const r = simulate(aim, 0, { firstHitOnly: true })
  clearRoll(tableId)
  rolls.set(tableId, {
    table,
    seat,
    type: cookieIndex(cookieId),
    aim,
    frames: r.frames,
    steps: r.steps,
    dist: distances(r.frames, r.steps),
    hits: [],
    hitNext: 0,
    start: performance.now(),
    predictedAt: performance.now(),
    confirmed: false,
    cup: -1,
    hurt: false,
    kind: -1,
    seconds: r.seconds,
    landed: false,
    landedAt: 0,
    mine: true,
    timer: 0,
  })
  sfx.drop()
}

/** The server's roll: { table, seat, id, aim, seed, cup, hurt, kind, cookie }. */
export function startRoll(msg) {
  const table = tableById(msg.table)
  if (!table) return
  const full = simulate(msg.aim, msg.seed)
  const now = performance.now()
  const prev = rolls.get(msg.table)
  let start = now
  if (prev && !prev.confirmed && prev.seat === msg.seat && prev.aim === msg.aim) {
    // Our own drop: keep going from wherever the prediction got to. If it already
    // ran out (reached the first peg before the seed arrived), carry on from there.
    start = Math.max(prev.start, now - prev.steps * DT * 1000)
  } else {
    clearRoll(msg.table)
  }
  if (full.cup !== msg.cup) console.warn('[rolls] simulation disagrees with the server', full.cup, msg.cup)
  const mine = msg.table === myTable()
  const anim = {
    table,
    seat: msg.seat,
    type: cookieIndex(msg.cookie),
    aim: msg.aim,
    frames: full.frames,
    steps: full.steps,
    dist: distances(full.frames, full.steps),
    hits: full.hits,
    hitNext: 0,
    start,
    confirmed: true,
    // The server's cup is the truth: the animation ends in it even if a browser's
    // maths ever disagreed.
    cup: msg.cup,
    hurt: msg.hurt,
    kind: msg.kind,
    seconds: full.seconds,
    landed: false,
    landedAt: 0,
    mine,
    rollerId: msg.id,
    timer: 0,
  }
  // Skip the bounce sounds we've already passed.
  const elapsedSteps = (now - start) / 1000 / DT
  while (anim.hitNext < anim.hits.length && anim.hits[anim.hitNext] <= elapsedSteps) anim.hitNext += 2
  anim.timer = setTimeout(() => land(anim), Math.max(0, start + full.seconds * 1000 - now))
  rolls.set(msg.table, anim)
}

const _cup = [0, 0, 0]

/** The cookie is in its cup: splash, sound, and (at your own table) the reveal popup. */
function land(anim) {
  if (rolls.get(anim.table.id) !== anim) return
  anim.landed = true
  anim.landedAt = performance.now()
  const { selfId, match } = useGame.getState()
  const mine = match?.table === anim.table.id
  const near = mine || nearPlayer(anim.table)

  if (near && getSettings().particles) {
    cupWorld(anim.table, anim.cup, _cup)
    const color = anim.hurt ? DATA.poisonKinds[anim.kind]?.color || '#7dff3a' : '#ffffff'
    effectQueue.push({ kind: anim.hurt ? 'poison' : 'splash', x: _cup[0], y: _cup[1], z: _cup[2], color })
  }
  // The roller winces when it was poison.
  if (anim.hurt && anim.rollerId) {
    const key = anim.rollerId === selfId ? SELF_ANCHOR : anim.rollerId
    actionFx.set(key, { ...actionFx.get(key), zap: Date.now(), side: Math.random() < 0.5 ? -1 : 1 })
  }
  if (!mine) {
    if (near) anim.hurt ? sfx.poisonFar() : sfx.splashFar()
    return
  }
  const mineRoll = anim.seat === match.seat
  if (anim.hurt) {
    if (mineRoll) sfx.poisoned()
    else sfx.gotcha()
  } else {
    sfx.splash()
    if (!mineRoll) sfx.dodged()
  }
  useGame.setState({
    landing: { table: anim.table.id, seat: anim.seat, cup: anim.cup, hurt: anim.hurt, kind: anim.kind, at: Date.now() },
    flash: anim.hurt && mineRoll ? { kind: 'poison', at: Date.now(), delay: 0, until: Date.now() + 900 } : useGame.getState().flash,
  })
}

export function clearRoll(tableId) {
  const anim = rolls.get(tableId)
  if (!anim) return
  clearTimeout(anim.timer)
  rolls.delete(tableId)
}

export function clearRolls() {
  for (const id of [...rolls.keys()]) clearRoll(id)
}

/** A prediction the server never confirmed (a dropped message): let it go. */
function expirePredictions() {
  const now = performance.now()
  rolls.forEach(expireOne, now)
}
function expireOne(anim, id) {
  if (!anim.confirmed && this - anim.predictedAt > PREDICTION_TIMEOUT_MS) clearRoll(id)
}
// Checked once a second, not every frame: there is rarely anything to expire.
if (typeof window !== 'undefined') setInterval(expirePredictions, 1000)
