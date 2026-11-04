import {
  COOKIE_R,
  CUP_W,
  CUPS,
  cupU,
  DIVIDER_TOP,
  DIVIDERS,
  HALF_W,
  LENGTH,
  PEGS,
  RISE,
  SURFACE_Y,
} from '../../../shared/plinko.mjs'
import { rotateXZ } from './layout'

/**
 * Where the cookie board (shared/plinko.mjs) sits in a table's own frame, and the
 * conversions from board space (u across, v down the slope) to the table frame and
 * the world.
 *
 * Table frame: the board runs along local X, its top (the launcher) at -X and the
 * cups at +X; u runs along -Z, so cup 1 is on the +Z side (seat 0's side), which is
 * the left of the screen in the duel view from behind the cups.
 */

export { COOKIE_R, CUP_W, CUPS, cupU, DIVIDER_TOP, DIVIDERS, HALF_W, LENGTH, PEGS, RISE, SURFACE_Y }

/** The slope: the board drops RISE over its LENGTH towards the cups. */
const HYP = Math.sqrt(LENGTH * LENGTH + RISE * RISE)
export const SLOPE_COS = LENGTH / HYP
export const SLOPE_SIN = RISE / HYP
export const SLOPE_ANGLE = Math.atan2(RISE, LENGTH)

/** Table-local X of board position v. */
export const boardX = (v) => v - LENGTH / 2
/** Height of the board's surface at v. */
export const surfaceY = (v) => SURFACE_Y + RISE * (1 - v / LENGTH)

/** The cups: centred this far along X, their rim and how tall they are. */
export const CUP_X = LENGTH / 2 + 0.18
export const CUP_RIM_Y = SURFACE_Y - 0.04
export const CUP_HEIGHT = 0.3
export const CUP_RADIUS = 0.135
/** Top of the liquid in a cup. */
export const LIQUID_Y = CUP_RIM_Y - 0.07

/**
 * The centre of a cookie standing on its edge at board point (u, v), in the table
 * frame: on the surface, lifted by its radius along the surface's normal.
 * Writes [x, y, z] into `out`.
 */
export function cookieLocal(u, v, out) {
  out[0] = boardX(v) + COOKIE_R * SLOPE_SIN
  out[1] = surfaceY(v) + COOKIE_R * SLOPE_COS
  out[2] = -u
  return out
}

/** Table frame -> world, for a table { x, z, ry }. Writes [x, y, z] into `out`. */
export function toWorld(table, lx, ly, lz, out) {
  const [dx, dz] = rotateXZ(lx, lz, table.ry || 0)
  out[0] = table.x + dx
  out[1] = ly
  out[2] = table.z + dz
  return out
}

/** World position of cup `i`'s liquid surface at a table. */
export function cupWorld(table, i, out = [0, 0, 0]) {
  return toWorld(table, CUP_X, LIQUID_Y, -cupU(i), out)
}
