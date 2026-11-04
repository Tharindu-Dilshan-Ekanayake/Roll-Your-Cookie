import { useFrame } from '@react-three/fiber'
import { Matrix4, Vector3 } from 'three'

import { aimAt, DT, FALL_S, LAUNCH_V } from '../../../shared/plinko.mjs'
import { sfx } from '../audio/sfx'
import { useGame } from '../net/gameStore'
import { localPlayer } from '../net/liveState'
import { boardX, COOKIE_R, CUP_X, cupU, LIQUID_Y, SLOPE_COS, SLOPE_SIN, surfaceY } from './board'
import { COOKIE_PRODUCER, drawCookie } from './cookieBatch'
import { cookieIndex } from './cookies'
import { DATA } from './layout'
import { getSettings } from './quality'
import { clearRoll, rolls } from './rolls'

/**
 * The cookies on the tables, every frame: sliding along the launcher while their
 * player aims, skidding down through the pegs (playing back the path from rolls.js)
 * and floating in their cup once they land. Each is a matrix handed to
 * CookieInstances; nothing here allocates or touches React.
 *
 * A cookie slides face up, spinning as it goes, so from the duel camera (behind
 * and above the cups) you always see its face and toppings, never just its edge.
 * Tables out of sight distance are skipped.
 */

/** Drawn a touch bigger than its physics, so it reads well from the camera. */
const VIS_R = COOKIE_R * 1.15
/** Its centre sits this far above the board (half its thickness, toppings included). */
const LIFT = 0.15 * VIS_R
/** Turns per unit of distance travelled, as it skids. */
const SPIN_RATE = 0.65 / COOKIE_R

const _m = new Matrix4()
const _x = new Vector3()
const _y = new Vector3()
const _z = new Vector3()
const _p = [0, 0, 0]
const _q = [0, 0, 0]

const TABLES = DATA.tables

/** Seconds of the launcher sweep since aiming began, for the local or a remote table. */
function aimStart(table, match) {
  if (match?.table === table.id && match.phase === 'aim') return match.aimStart
  return table.aimAt
}

/** Table-local centre of a cookie lying on the board at (u, v). */
function onBoard(u, v, out) {
  out[0] = boardX(v) + LIFT * SLOPE_SIN
  out[1] = surfaceY(v) + LIFT * SLOPE_COS
  out[2] = -u
  return out
}

/**
 * Writes into _m the world matrix of a cookie at table-local `p`, lying with its
 * face along normal (nx, ny, 0) (the board's, or straight up), turned `spin`
 * about it, tipped `tip` radians towards the cups.
 */
function compose(table, p, nx, ny, spin, tip = 0) {
  // Face normal, tipped towards +X.
  const ct = Math.cos(tip)
  const st = Math.sin(tip)
  const yx = nx * ct + ny * st
  const yy = ny * ct - nx * st
  // In-plane axes: "down the slope" a = (yy, -yx, 0) and across b = (0, 0, 1).
  const c = Math.cos(spin)
  const s = Math.sin(spin)
  const xx = yy * c
  const xy = -yx * c
  const xz = s
  // z = x cross y (y has no z part).
  const zx = -xz * yy
  const zy = xz * yx
  const zz = xx * yy - xy * yx
  // Turned with the table (yaw about world Y), then placed.
  const ry = table.ry || 0
  const cr = Math.cos(ry)
  const sr = Math.sin(ry)
  _x.set(xx * cr + xz * sr, xy, -xx * sr + xz * cr).multiplyScalar(VIS_R)
  _y.set(yx * cr, yy, -yx * sr).multiplyScalar(VIS_R)
  _z.set(zx * cr + zz * sr, zy, -zx * sr + zz * cr).multiplyScalar(VIS_R)
  _m.makeBasis(_x, _y, _z)
  _m.setPosition(table.x + p[0] * cr + p[2] * sr, p[1], table.z - p[0] * sr + p[2] * cr)
}

/** A cookie on its way down (or in its cup), `elapsed` seconds after it was dropped. */
function drawRoll(anim, elapsed, time, myTable) {
  const { frames, steps, table } = anim
  const s = Math.min(elapsed / DT, steps)
  const i = Math.min(Math.max(0, steps - 1), Math.floor(s))
  const f = steps > 0 ? s - i : 0
  const a = i * 2
  const b = Math.min(steps, i + 1) * 2
  const distAt = anim.dist[i] + (anim.dist[Math.min(steps, i + 1)] - anim.dist[i]) * f

  if (elapsed <= steps * DT || !anim.confirmed) {
    // On the board (or, unconfirmed, held at the end of the prediction).
    const u = frames[a] + (frames[b] - frames[a]) * f
    const v = frames[a + 1] + (frames[b + 1] - frames[a + 1]) * f
    onBoard(u, v, _p)
    compose(table, _p, SLOPE_SIN, SLOPE_COS, distAt * SPIN_RATE)
    drawCookie(anim.type, _m)

    // Bounce sounds, at your own table only.
    if (anim.confirmed && table.id === myTable) {
      while (anim.hitNext < anim.hits.length && anim.hits[anim.hitNext] <= s) {
        sfx.peg(anim.hits[anim.hitNext + 1])
        anim.hitNext += 2
      }
    }
    return
  }

  // Off the end of the board and down into the cup, then floating in it.
  const end = steps * 2
  onBoard(frames[end], frames[end + 1], _p)
  _q[0] = CUP_X
  _q[1] = LIQUID_Y + 0.004
  _q[2] = -cupU(anim.cup)
  const t = Math.min(1, (elapsed - steps * DT) / FALL_S)
  const spinEnd = anim.dist[steps] * SPIN_RATE
  if (t < 1) {
    for (let k = 0; k < 3; k += 1) _p[k] += (_q[k] - _p[k]) * t
    _p[1] += 0.08 * 4 * t * (1 - t)
    // It tips over the edge of the board and levels out in the cup.
    const tip = Math.sin(t * Math.PI) * 0.9
    compose(table, _p, SLOPE_SIN * (1 - t), SLOPE_COS * (1 - t) + t, spinEnd + t * 3, tip)
  } else {
    // Dunked: bobbing in the milk (or the poison), turning slowly.
    _q[1] += Math.sin(time * 3 + table.id) * 0.006
    compose(table, _q, 0, 1, spinEnd + 3 + time * 0.8, Math.sin(time * 2.1 + table.id) * 0.08)
  }
  drawCookie(anim.type, _m)
}

export function RollingCookies() {
  useFrame(({ clock }) => {
    const { tables, match } = useGame.getState()
    const now = Date.now()
    const pnow = performance.now()
    const time = clock.elapsedTime
    const reach = getSettings().labelDistance * 1.8
    const myTable = match?.table ?? -1
    const p = localPlayer.position

    for (let k = 0; k < TABLES.length; k += 1) {
      const def = TABLES[k]
      if (def.id !== myTable && Math.hypot(def.x - p.x, def.z - p.z) > reach) continue
      const t = tables[def.id]
      const anim = rolls.get(def.id)
      if (anim) {
        // Done with: the next turn has begun (or the duel is over).
        const over = anim.landed && t && t.phase !== 'rolling' && t.phase !== 'reveal'
        if (!over) {
          drawRoll(anim, (pnow - anim.start) / 1000, time, myTable)
          continue
        }
        clearRoll(def.id)
      }
      if (t?.phase !== 'aim' || t.turn < 0) continue
      // Aiming: the cookie sweeps along the launcher rail, spinning as it slides.
      const u = aimAt(now - aimStart(t, match), t.round)
      onBoard(u, LAUNCH_V, _p)
      compose(def, _p, SLOPE_SIN, SLOPE_COS, u * SPIN_RATE)
      drawCookie(cookieIndex(t.seats[t.turn]?.cookie), _m)
    }
  }, COOKIE_PRODUCER)
  return null
}

export default RollingCookies
