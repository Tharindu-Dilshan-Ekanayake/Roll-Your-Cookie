/**
 * The cookie board: its shape and its physics, shared by the game server (which
 * decides where every cookie lands) and the client (which animates the very same
 * roll, so nothing about the motion has to travel over the network).
 *
 * Board space, in world units:
 *   u  across the board, -HALF_W (cup 1's side) .. +HALF_W (cup 7's side)
 *   v  down the slope, 0 at the launcher rail at the top .. LENGTH at the cups
 *
 * A roll is a pure function of (aim, seed): the same inputs give the same path on
 * every machine. The simulation therefore only uses + - * /, Math.sqrt / floor / min /
 * max / abs (all exactly specified by IEEE 754), a fixed time step and a seeded
 * integer generator; never Math.sin, Math.hypot or Math.random.
 *
 * The seed is only drawn on at a collision. The cookie's fall from the launcher to
 * the first peg therefore depends on the aim alone, which lets the player who drops
 * it animate that part at once, before the server has answered with the seed.
 */

export const CUPS = 7
export const CUP_W = 0.32
export const HALF_W = (CUPS * CUP_W) / 2
export const LENGTH = 3
/** Board surface height at the cups' end, and how much higher its top end is. */
export const SURFACE_Y = 0.95
export const RISE = 0.55
export const COOKIE_R = 0.1
export const PEG_R = 0.034
/** Where the cookie sits on the launcher rail before it drops. */
export const LAUNCH_V = 0.16
/** How far either side of the middle the launcher slides. */
export const AIM_MAX = 0.9
/** The dividers between the cups start this far down the board. */
export const DIVIDER_TOP = 2.68
const DIVIDER_R = 0.018

/** Simulation step, and the longest roll simulated (a stuck cookie is nudged long before). */
export const DT = 1 / 120
const MAX_STEPS = 1200
/** After it leaves the board the cookie drops into its cup: added to every roll. */
export const FALL_S = 0.4

const GRAVITY = 7.5
const DAMPING = 0.12
const MAX_SPEED = 4.8
const E_PEG = 0.34
const E_WALL = 0.4
const E_DIVIDER = 0.3
const FRICTION = 0.9
/** Approach speed below which a contact is a roll round the obstacle, not a bounce. */
const IMPACT = 0.33
/** Random sideways kick on a peg, as a fraction of the impact speed. */
const JITTER = 0.55

/**
 * Peg rows: 5 pegs, then 6 offset by half a cup, alternately. [u, v] of every peg.
 * The 5-peg rows also have a half peg set into each rail, so a cookie can't just
 * slide down a rail into an end cup. Every gap (between pegs, and between a peg and
 * the rail) is wider than a cookie, so one can never wedge itself in.
 */
/** The rail pegs stand just proud of the rail. */
const RAIL_PEG_U = HALF_W - 0.02
const ROW_V0 = 0.6
const ROW_GAP = 0.33
const ROWS = 6
export const PEG_ROWS = Array.from({ length: ROWS }, (_, k) => {
  const v = ROW_V0 + k * ROW_GAP
  const n = k % 2 === 0 ? CUPS - 2 : CUPS - 1
  const offset = (n - 1) / 2
  const row = Array.from({ length: n }, (_, j) => [(j - offset) * CUP_W, v])
  return k % 2 === 0 ? [[-RAIL_PEG_U, v], ...row, [RAIL_PEG_U, v]] : row
})
export const PEGS = PEG_ROWS.flat()
/** u of each divider between neighbouring cups. */
export const DIVIDERS = Array.from({ length: CUPS - 1 }, (_, j) => -HALF_W + (j + 1) * CUP_W)

/** u of cup `i`'s middle (0-based). */
export const cupU = (i) => -HALF_W + (i + 0.5) * CUP_W

/** Which cup a cookie at `u` falls into. */
export function cupAt(u) {
  return Math.min(CUPS - 1, Math.max(0, Math.floor((u + HALF_W) / CUP_W)))
}

/** Seconds for one sweep of the launcher across the board in round `round` (faster each round). */
export function sweepSeconds(round) {
  return Math.max(0.55, 1.05 - 0.08 * (Math.max(1, round) - 1))
}

/**
 * Where the launcher is `ms` after the aim started: it starts in the middle moving
 * towards cup 7 and sweeps from side to side. A triangle wave, so the speed is even.
 */
export function aimAt(ms, round) {
  const period = sweepSeconds(round) * 2000
  let p = (Math.max(0, ms) / period + 0.25) % 1
  if (p < 0) p += 1
  return p < 0.5 ? -AIM_MAX + 4 * AIM_MAX * p : 3 * AIM_MAX - 4 * AIM_MAX * p
}

export const clampAim = (x) => (Number.isFinite(x) ? Math.min(AIM_MAX, Math.max(-AIM_MAX, x)) : 0)

/** mulberry32: a tiny, fast, well-mixed 32-bit generator; integer maths only. */
function generator(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Rolls a cookie dropped at `aim` (u, clamped to the launcher's reach).
 *
 * Returns:
 *   cup       which cup it fell into (0-based), or -1 if `firstHitOnly` stopped it
 *   steps     simulation steps on the board (each DT long)
 *   seconds   total time until it lands in the cup (including FALL_S)
 *   frames    [u0, v0, u1, v1, ...]: its centre at every step (steps + 1 entries)
 *   hits      [step, speed, step, speed, ...]: every bounce, for the sound
 *
 * `seed` may be omitted with `firstHitOnly`: the path up to the first collision
 * doesn't use it.
 */
export function roll(aim, seed = 0, { firstHitOnly = false } = {}) {
  const rand = generator(seed)
  const frames = []
  const hits = []
  let u = clampAim(aim)
  let v = LAUNCH_V
  let vu = 0
  let vv = 0.33
  let best = v
  let stalled = 0
  let step = 0
  frames.push(u, v)

  const R2 = COOKIE_R
  const pegMin = R2 + PEG_R
  const dividerMin = R2 + DIVIDER_R
  let collided = false

  /** Bounces off a round obstacle at (cu, cv): returns true on contact. */
  const bounce = (cu, cv, minDist, e) => {
    const dx = u - cu
    const dy = v - cv
    const d2 = dx * dx + dy * dy
    if (d2 >= minDist * minDist) return false
    if (firstHitOnly) {
      collided = true
      return true
    }
    let nx = 0
    let ny = -1
    let d = 0
    if (d2 > 1e-12) {
      d = Math.sqrt(d2)
      nx = dx / d
      ny = dy / d
    }
    // Out of the obstacle, then deal with the approaching part of the velocity.
    u += nx * (minDist - d)
    v += ny * (minDist - d)
    const vn = vu * nx + vv * ny
    if (vn < 0) {
      const tx = -ny
      const ty = nx
      const vt = vu * tx + vv * ty
      if (-vn > IMPACT) {
        // A real knock: bounce, lose a little speed along the surface, and get a
        // random sideways kick (the only luck in the game).
        const newVn = -vn * e
        const newVt = vt * FRICTION + (rand() - 0.5) * JITTER * -vn
        vu = nx * newVn + tx * newVt
        vv = ny * newVn + ty * newVt
        hits.push(step, -vn)
      } else {
        // Resting against it: roll round its surface without losing speed.
        vu = tx * vt
        vv = ty * vt
      }
    }
    return true
  }

  while (step < MAX_STEPS) {
    step += 1
    vv += GRAVITY * DT
    vu -= vu * DAMPING * DT
    vv -= vv * DAMPING * DT
    const sp2 = vu * vu + vv * vv
    if (sp2 > MAX_SPEED * MAX_SPEED) {
      const k = MAX_SPEED / Math.sqrt(sp2)
      vu *= k
      vv *= k
    }
    u += vu * DT
    v += vv * DT

    // Pegs: only the row(s) the cookie can reach.
    const row = Math.floor((v - ROW_V0) / ROW_GAP + 0.5)
    for (let k = row - 1; k <= row + 1; k += 1) {
      if (k < 0 || k >= ROWS) continue
      const pegs = PEG_ROWS[k]
      for (let j = 0; j < pegs.length; j += 1) bounce(pegs[j][0], pegs[j][1], pegMin, E_PEG)
    }
    // Dividers between the cups: capsules from DIVIDER_TOP to the board's end.
    if (v + R2 > DIVIDER_TOP) {
      const cv = Math.min(LENGTH, Math.max(DIVIDER_TOP, v))
      for (let j = 0; j < DIVIDERS.length; j += 1) bounce(DIVIDERS[j], cv, dividerMin, E_DIVIDER)
    }
    // Side rails and the launcher rail.
    if (u - R2 < -HALF_W) {
      if (firstHitOnly) collided = true
      u = -HALF_W + R2
      if (vu < 0) {
        hits.push(step, -vu)
        vu = -vu * E_WALL
      }
    } else if (u + R2 > HALF_W) {
      if (firstHitOnly) collided = true
      u = HALF_W - R2
      if (vu > 0) {
        hits.push(step, vu)
        vu = -vu * E_WALL
      }
    }
    if (v - R2 < 0) {
      v = R2
      if (vv < 0) vv = -vv * E_WALL
    }
    if (collided) break

    frames.push(u, v)
    if (v >= LENGTH) break

    // No headway down the board for a while (balanced on a peg, say): a nudge to
    // one side, from the seed.
    if (v > best + 0.01) {
      best = v
      stalled = 0
    } else if ((stalled += 1) > 36) {
      vu += rand() < 0.5 ? -0.7 : 0.7
      vv += 0.3
      stalled = 0
    }
  }

  const steps = frames.length / 2 - 1
  const cup = collided ? -1 : cupAt(u)
  return {
    cup,
    steps,
    seconds: steps * DT + (collided ? 0 : FALL_S),
    frames: new Float32Array(frames),
    hits,
  }
}
