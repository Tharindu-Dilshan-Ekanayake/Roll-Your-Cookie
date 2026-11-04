import { SEATED_BACK } from './layout'

/** Hop height and side-to-side wiggle of the winner's dance, in units / radians. */
const HOP_HEIGHT = 0.35
const WIGGLE = 0.35
/** Dropping the cookie: the hand goes up and flicks it forward. */
const PRESS_MS = 420

/**
 * Poisoned: the player's head spins right round (twice, fast at first, slowing to a
 * stop facing front again) while the body jolts aside and eases back upright.
 */
const HIT_MS = 800
const HIT_PEAK = 0.12
const HIT_TILT = 0.3
const HIT_TURN = 0.35
const HEAD_SPINS = 2

/**
 * Losing the duel: the player is launched away from the table, spinning, lands
 * flat on their back, bounces once and lies there until the server sends them to
 * the lobby.
 */
const FLY_MS = 820
const FLY_DIST = 2.3
const FLY_HEIGHT = 1.1
const BOUNCE_MS = 260
const BOUNCE = 0.14
/** Lying on the floor: the body's middle sits this far up. */
const LIE_Y = 0.2

const smooth = (x) => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}
const easeOutCubic = (t) => 1 - (1 - t) ** 3

/** 0..1 progress of an action that started at `at` (epoch ms) and lasts `ms`, or -1. */
function progress(at, ms, now) {
  if (!at) return -1
  const t = (now - at) / ms
  return t >= 0 && t <= 1 ? t : -1
}

/** Knock envelope: snaps to 1 at the hit, then eases back with no wobble. */
function hitEnvelope(t) {
  if (t < HIT_PEAK) return Math.sin((t / HIT_PEAK) * (Math.PI / 2))
  return 1 - smooth((t - HIT_PEAK) / (1 - HIT_PEAK))
}

/**
 * Launched after losing (`ms` since it fired): position, spin and tilt of the
 * avatar's group, flying from standing at the table to lying on the floor. Writes `out`.
 */
function flight(ms, fx, seat, out) {
  const t = Math.min(1, ms / FLY_MS)
  const d = FLY_DIST * easeOutCubic(t)
  out.x = -Math.sin(seat.ry) * SEATED_BACK + fx.ax * d
  out.z = -Math.cos(seat.ry) * SEATED_BACK + fx.az * d
  out.y = LIE_Y * t + FLY_HEIGHT * 4 * t * (1 - t)
  if (t >= 1) {
    const b = (ms - FLY_MS) / BOUNCE_MS
    if (b < 1) out.y += BOUNCE * Math.sin(b * Math.PI)
  }
  // One full twist in the air, ending square to the table again, and tipping over
  // onto their back.
  out.yaw = seat.ry + (fx.side || 1) * Math.PI * 2 * easeOutCubic(t)
  out.pitch = -(Math.PI / 2) * smooth(t * 1.15)
  out.landed = t >= 1
}
const _flight = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, landed: false }

/**
 * Poses a player who is at a table: standing at their spot facing the board, or,
 * for a duel's winner (`seat.dancing`), dancing on the spot until the result
 * clears. Shared by the local player and remote players so both look identical.
 *
 * Players at a table also act out the duel, from liveState.actionFx (epoch ms):
 *   `press`   - dropping the cookie: the hand flicks it onto the board
 *   `zap`     - landed in poison: a jolt and a head spin (`side`: which way)
 *   `fly`     - lost the duel: launched away from the table (`ax`, `az`: which way)
 *   `danceAt` - the winner waits until then to start dancing
 *
 * @param {import('three').Object3D} visual the avatar's group (feet at its origin)
 * @param {import('three').Object3D|null} tag the name tag's group, lifted with them
 * @param {{ ry: number, dancing?: boolean }} seat
 * @param {object} motion the avatar's motion state (see animateRig)
 * @param {number} delta frame time in seconds
 * @param {object} [fx]
 */
export function poseAtSeat(visual, tag, seat, motion, delta, fx) {
  motion.speed = 0
  // Pitch and roll in the avatar's own frame, then the yaw: leaning and tilting
  // work the same at every table.
  if (visual.rotation.order !== 'YXZ') visual.rotation.order = 'YXZ'
  const fx0 = Math.sin(seat.ry)
  const fz0 = Math.cos(seat.ry)
  const now = Date.now()
  // The winner starts dancing once the loser's launch has had its moment.
  const dancing = seat.dancing && now >= (fx?.danceAt || 0)

  if (!dancing) {
    const press = progress(fx?.press, PRESS_MS, now)
    const hit = progress(fx?.zap, HIT_MS, now)
    const flying = fx?.fly && now >= fx.fly ? now - fx.fly : -1
    motion.danceT = null
    motion.dancing = false
    motion.seated = true
    motion.grounded = true
    motion.down = false

    let x = -fx0 * SEATED_BACK
    let y = 0
    let z = -fz0 * SEATED_BACK
    let yaw = seat.ry
    let pitch = 0
    let roll = 0

    // Hand up, then a flick forward over the board, with a little lean into it.
    motion.press = press < 0 ? 0 : press < 0.45 ? smooth(press / 0.45) : 1 - smooth((press - 0.45) / 0.55) * 1.15
    pitch += Math.max(0, motion.press) * 0.08

    // Poisoned: the head spins round, the body is knocked away then back upright.
    const k = hit < 0 ? 0 : hitEnvelope(hit)
    motion.zap = k
    motion.headSpin = hit < 0 ? 0 : (fx.side || 1) * Math.PI * 2 * HEAD_SPINS * easeOutCubic(hit)
    if (k > 0) {
      roll += fx.side * HIT_TILT * k
      yaw -= fx.side * HIT_TURN * k
    }

    // Lost: off the floor, through the air and flat on their back.
    if (flying >= 0) {
      flight(flying, fx, seat, _flight)
      x = _flight.x
      y = _flight.y
      z = _flight.z
      yaw = _flight.yaw
      pitch = _flight.pitch
      roll = 0
      motion.seated = false
      motion.grounded = _flight.landed
      motion.down = _flight.landed
      motion.press = 0
    }

    visual.position.set(x, y, z)
    visual.rotation.set(pitch, yaw, roll)
    if (tag) {
      if (flying >= 0) tag.position.set(x, Math.max(0, y - LIE_Y) - (_flight.landed ? 1.1 : 0), z)
      else tag.position.set(0, 0, 0)
    }
    return
  }

  motion.press = 0
  motion.zap = 0
  motion.headSpin = 0
  motion.down = false
  motion.danceT = (motion.danceT ?? 0) + delta
  motion.seated = false
  motion.grounded = true
  motion.dancing = true
  // Bouncing on the spot, wiggling, still facing the board.
  const hop = Math.abs(Math.sin(motion.danceT * 4)) * HOP_HEIGHT
  visual.position.set(-fx0 * SEATED_BACK, hop, -fz0 * SEATED_BACK)
  visual.rotation.set(0, seat.ry + Math.sin(motion.time * 4) * WIGGLE, 0)
  if (tag) tag.position.set(0, hop, 0)
}

/** Back to a normal standing pose after leaving the table. */
export function clearSeatPose(visual, tag, motion) {
  motion.seated = false
  motion.dancing = false
  motion.danceT = null
  motion.press = 0
  motion.zap = 0
  motion.headSpin = 0
  motion.down = false
  visual.position.set(0, 0, 0)
  visual.rotation.x = 0
  visual.rotation.z = 0
  if (tag) tag.position.set(0, 0, 0)
}
