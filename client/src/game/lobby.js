import { BufferAttribute, BufferGeometry, Color } from 'three'

import {
  DATA,
  FLOOR,
  GUIDE_BOARD,
  HOURGLASS,
  LAMPS,
  PLANTERS,
  PLAZA,
  rotateXZ,
  SHOWROOM,
  SPAWN,
  STORE,
  TABLE,
  TOWER,
} from './layout'

/**
 * The town square's build: the paving (one mesh) and every box-built prop (lamp
 * posts, string lights, crystal planters, the clock tower's body, the giant
 * hourglass, the Store and the guide board's frame), which join the world's shared
 * scenery instanced mesh: no draw calls of their own.
 */

/** Polar -> [x, z] about (cx, cz), angles measured from +Z (south) towards +X (east). */
const polar = (cx, cz, r, a) => [cx + r * Math.sin(a), cz + r * Math.cos(a)]

/* ---- Paving ---------------------------------------------------------------------- */

const PAVE = {
  tileA: '#fbf1dc',
  tileB: '#ead8b5',
  trim: '#9c6b43',
  towerRing: '#ffcf4a',
  avenue: '#d6ecff',
  path: '#fff3dc',
  band: '#ec7a5c',
  showroomPad: '#ffe1f0',
  storePad: '#efe2ff',
  boardPad: '#dff7e4',
  walk: '#fff3dc',
}

/**
 * The square's floor as one flat geometry: a big checker of warm stone tiles with a
 * trim round it, a gold ring round the clock tower, pale blue avenues under the two
 * rows of tables, the entrance path and paved pads (and the spokes joining them)
 * under the showroom, the Store and the leaderboards. Colours are vertex colours over
 * one shared tile texture (UVs in world units / `tile`).
 *
 * Pieces that overlap are stacked in layers (the field, then pads, then paths), each
 * FLOOR.plazaStep higher, so overlapping tiles never flicker against each other.
 */
export function createPlazaGeometry(tile) {
  const positions = []
  const colors = []
  const color = new Color()
  let y = 0
  const layer = (n) => {
    y = n * FLOOR.plazaStep
  }

  const tri = (a, b, c) => {
    // Every triangle faces up (+Y), whatever order the corners came in.
    const cross = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1])
    const pts = cross >= 0 ? [a, b, c] : [a, c, b]
    for (const [x, z] of pts) {
      positions.push(x, y, z)
      colors.push(color.r, color.g, color.b)
    }
  }
  const quad = (a, b, c, d) => {
    tri(a, b, c)
    tri(a, c, d)
  }
  /** A ring segment about (cx, cz) from angle a0 to a1 (radians), in `segments` steps. */
  const arc = (cx, cz, r0, r1, a0, a1, segments, hex) => {
    color.set(hex)
    for (let i = 0; i < segments; i += 1) {
      const t0 = a0 + ((a1 - a0) * i) / segments
      const t1 = a0 + ((a1 - a0) * (i + 1)) / segments
      if (r0 > 0) quad(polar(cx, cz, r0, t0), polar(cx, cz, r1, t0), polar(cx, cz, r1, t1), polar(cx, cz, r0, t1))
      else tri([cx, cz], polar(cx, cz, r1, t0), polar(cx, cz, r1, t1))
    }
  }
  const rect = (x, z, w, d, hex, ry = 0) => {
    color.set(hex)
    const corner = (sx, sz) => {
      const [dx, dz] = rotateXZ((sx * w) / 2, (sz * d) / 2, ry)
      return [x + dx, z + dz]
    }
    quad(corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1))
  }

  const { x0, x1, z0, z1 } = PLAZA
  // Layer 0: the field, a checker of 8 x 9 big tiles, and the trim round it.
  layer(0)
  const cols = 8
  const rows = 9
  const tw = (x1 - x0) / cols
  const td = (z1 - z0) / rows
  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      rect(x0 + tw * (c + 0.5), z0 + td * (r + 0.5), tw, td, (c + r) % 2 ? PAVE.tileA : PAVE.tileB)
    }
  }
  const trim = 0.6
  rect((x0 + x1) / 2, z0 - trim / 2, x1 - x0 + trim * 2, trim, PAVE.trim)
  rect((x0 + x1) / 2, z1 + trim / 2, x1 - x0 + trim * 2, trim, PAVE.trim)
  rect(x0 - trim / 2, (z0 + z1) / 2, trim, z1 - z0, PAVE.trim)
  rect(x1 + trim / 2, (z0 + z1) / 2, trim, z1 - z0, PAVE.trim)
  // Pads outside the field: the showroom's half-disc (east), the Store (west) and the
  // leaderboards' strip (north).
  arc(SHOWROOM.x, SHOWROOM.z, 0, SHOWROOM.radius + 2.2, 0, Math.PI, 30, PAVE.showroomPad)
  rect(STORE.x + 0.5, STORE.z, 7.4, 10.4, PAVE.storePad)
  // Narrow enough that its corners stay on the round island.
  rect(0, -22.5, 34, 3.8, PAVE.boardPad)
  rect(GUIDE_BOARD.x, GUIDE_BOARD.z, 6.6, 2.6, PAVE.walk, GUIDE_BOARD.ry)
  rect(HOURGLASS.x, HOURGLASS.z, 3.6, 3.6, PAVE.walk)

  // Layer 1: on the field, the tower's ring and the two avenues of tables.
  layer(1)
  arc(TOWER.x, TOWER.z, TOWER.size * 0.62, TOWER.size * 0.62 + 1, 0, Math.PI * 2, 40, PAVE.towerRing)
  for (const x of [...new Set(DATA.tables.map((t) => t.x))]) {
    const zs = DATA.tables.filter((t) => t.x === x).map((t) => t.z)
    const top = Math.min(...zs) - 2.4
    const bottom = Math.max(...zs) + 2.4
    rect(x, (top + bottom) / 2, TABLE.depth + TABLE.seatZ * 2 + 2.4, bottom - top, PAVE.avenue)
  }

  // Layer 2: the entrance path from the spawn point (its terracotta edges beside
  // it, not over it) and the spokes joining the pads to the square.
  layer(2)
  const pathStart = z1 + trim - 0.2
  const pathEnd = SPAWN[2] + 3
  const pathMid = (pathStart + pathEnd) / 2
  const pathLen = pathEnd - pathStart
  rect(0, pathMid, 4.8, pathLen, PAVE.path)
  rect(-2.6, pathMid, 0.4, pathLen, PAVE.band)
  rect(2.6, pathMid, 0.4, pathLen, PAVE.band)
  rect((x1 + SHOWROOM.x) / 2, 0, SHOWROOM.x - x1 + 1, 3.4, PAVE.walk)
  rect((x0 + STORE.x + 3.2) / 2, 0, x0 - STORE.x - 3.2 + 1, 3.4, PAVE.walk)
  rect(0, (z0 - 20.5) / 2, 3.4, z0 - -20.5 + 1, PAVE.walk)

  const position = new Float32Array(positions)
  const uv = new Float32Array((position.length / 3) * 2)
  const normal = new Float32Array(position.length)
  for (let i = 0; i < position.length / 3; i += 1) {
    uv[i * 2] = position[i * 3] / tile
    uv[i * 2 + 1] = position[i * 3 + 2] / tile
    normal[i * 3 + 1] = 1
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('normal', new BufferAttribute(normal, 3))
  geometry.setAttribute('uv', new BufferAttribute(uv, 2))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  geometry.computeBoundingSphere()
  return geometry
}

/* ---- Props ----------------------------------------------------------------------- */

const LAMP_METAL = '#4a4560'
const LAMP_GLOW = '#ffe2a0'
const STRING_LIGHTS = ['#ffd27a', '#7ff6ff', '#ff9ad5', '#c6a0ff']
const LAMP_TOP = 3.98
const ROPE_Y = 3.62
const SAG = 0.5
const GOLD = '#ffc93d'
const BLUE = '#2f5bd8'
const BRASS = '#e2ad45'

/** Strings of little coloured bulbs hung between neighbouring lamp posts, sagging a little. */
function stringLights() {
  const rope = []
  const bulbs = []
  for (let k = 0; k + 1 < LAMPS.length; k += 1) {
    const [ax, az] = LAMPS[k]
    const [bx, bz] = LAMPS[k + 1]
    const dx = bx - ax
    const dz = bz - az
    const len = Math.hypot(dx, dz)
    const ry = Math.atan2(-dz, dx)
    const at = (s) => [ax + dx * s, ROPE_Y - SAG * 4 * s * (1 - s), az + dz * s]
    const ropeSegments = 8
    for (let i = 0; i < ropeSegments; i += 1) {
      const [x, y, z] = at((i + 0.5) / ropeSegments)
      rope.push({ p: [x, y, z], s: [len / ropeSegments + 0.05, 0.03, 0.03], c: '#2c2840', ry })
    }
    const count = Math.max(6, Math.round(len / 1.1))
    for (let i = 0; i < count; i += 1) {
      const [x, y, z] = at((i + 0.5) / count)
      bulbs.push({ p: [x, y - 0.1, z], s: [0.13, 0.17, 0.13], c: STRING_LIGHTS[(i + k) % STRING_LIGHTS.length], ry })
    }
  }
  return { rope, bulbs }
}
const STRINGS = stringLights()

/** The glowing parts, drawn unlit in their own mesh (see World): lamp globes and string lights. */
export const LAMP_BULBS = [
  ...LAMPS.map(([x, z]) => ({ p: [x, LAMP_TOP, z], s: [0.34, 0.42, 0.34], c: LAMP_GLOW })),
  ...STRINGS.bulbs,
]

/** Lamp posts: a dark iron post on a brass foot, a lantern frame and a pointed cap. */
function lampBoxes() {
  const boxes = []
  for (const [x, z] of LAMPS) {
    boxes.push(
      { p: [x, 0.18, z], s: [0.6, 0.36, 0.6], c: '#5b5476' },
      { p: [x, 0.42, z], s: [0.36, 0.14, 0.36], c: BRASS },
      { p: [x, 2.0, z], s: [0.14, 3.3, 0.14], c: LAMP_METAL },
      { p: [x, LAMP_TOP - 0.27, z], s: [0.48, 0.07, 0.48], c: BRASS },
      { p: [x, LAMP_TOP + 0.27, z], s: [0.56, 0.08, 0.56], c: BRASS },
      { p: [x, LAMP_TOP + 0.4, z], s: [0.3, 0.18, 0.3], c: LAMP_METAL, ry: Math.PI / 4 },
      { p: [x, LAMP_TOP + 0.56, z], s: [0.12, 0.14, 0.12], c: BRASS, ry: Math.PI / 4 },
    )
    // Four thin posts framing the lantern.
    for (const cx of [-1, 1]) {
      for (const cz of [-1, 1]) boxes.push({ p: [x + cx * 0.2, LAMP_TOP, z + cz * 0.2], s: [0.05, 0.5, 0.05], c: LAMP_METAL })
    }
  }
  return boxes
}

/** Stone planters by the entrance, rimmed in brass; their crystals are drawn by Island. */
function planterBoxes() {
  const boxes = []
  for (const [x, z, w, d] of PLANTERS) {
    boxes.push({ p: [x, 0.28, z], s: [w, 0.56, d], c: '#4f4868' })
    boxes.push({ p: [x, 0.6, z], s: [w + 0.12, 0.08, d + 0.12], c: BRASS })
    // A dark bed inside the rim, just proud of it, for the crystals to grow from.
    boxes.push({ p: [x, 0.655, z], s: [w - 0.24, 0.03, d - 0.24], c: '#2c2840' })
  }
  return boxes
}

/**
 * The clock tower's dimensions: a stepped base, a banded shaft, and the clock room
 * whose four faces (and hands, and roof) ClockTower.jsx draws.
 */
export const CLOCK = {
  shaftTop: 7.35,
  roomSize: 3.6,
  roomHeight: 3.4,
  /** Centre height of the clock faces. */
  y: 7.35 + 1.7,
  faceSize: 2.9,
}

function towerBoxes() {
  const { x, z } = TOWER
  const half = CLOCK.roomSize / 2
  const boxes = [
    { p: [x, 0.2, z], s: [TOWER.size, 0.4, TOWER.size], c: '#a7aeb8' },
    { p: [x, 0.575, z], s: [TOWER.size - 0.7, 0.35, TOWER.size - 0.7], c: GOLD },
    { p: [x, 4.05, z], s: [3, 6.6, 3], c: '#fff1d6' },
    { p: [x, CLOCK.y, z], s: [CLOCK.roomSize, CLOCK.roomHeight, CLOCK.roomSize], c: BLUE },
    { p: [x, CLOCK.shaftTop, z], s: [CLOCK.roomSize + 0.3, 0.3, CLOCK.roomSize + 0.3], c: GOLD },
    { p: [x, CLOCK.y + CLOCK.roomHeight / 2, z], s: [CLOCK.roomSize + 0.3, 0.3, CLOCK.roomSize + 0.3], c: GOLD },
  ]
  // Blue corner pillars and gold bands up the shaft.
  for (const cx of [-1, 1]) {
    for (const cz of [-1, 1]) boxes.push({ p: [x + cx * 1.4, 4.05, z + cz * 1.4], s: [0.5, 6.6, 0.5], c: BLUE })
  }
  for (const y of [2.5, 5]) boxes.push({ p: [x, y, z], s: [3.2, 0.25, 3.2], c: GOLD })
  // Corner posts framing the clock faces.
  for (const cx of [-1, 1]) {
    for (const cz of [-1, 1]) {
      boxes.push({ p: [x + cx * half, CLOCK.y, z + cz * half], s: [0.32, CLOCK.roomHeight, 0.32], c: GOLD })
    }
  }
  // A door on the side facing the entrance.
  boxes.push({ p: [x, 1.65, z + 1.52], s: [1.3, 2.1, 0.08], c: GOLD })
  boxes.push({ p: [x, 1.6, z + 1.55], s: [1.05, 1.9, 0.08], c: '#5b3520' })
  return boxes
}

/** A giant hourglass by the entrance: two heaps of sand tip to tip between wooden plates. */
function hourglassBoxes() {
  const { x, z } = HOURGLASS
  const WOOD = '#8a4f2a'
  const SAND = '#f3c75a'
  const boxes = [
    { p: [x, 0.15, z], s: [2.4, 0.3, 2.4], c: WOOD },
    { p: [x, 0.36, z], s: [2.1, 0.12, 2.1], c: GOLD },
    { p: [x, 4.05, z], s: [2.4, 0.3, 2.4], c: WOOD },
    { p: [x, 3.84, z], s: [2.1, 0.12, 2.1], c: GOLD },
    { p: [x, 2.1, z], s: [0.24, 0.5, 0.24], c: '#bfe9ff' },
  ]
  for (const cx of [-1, 1]) {
    for (const cz of [-1, 1]) boxes.push({ p: [x + cx * 1.0, 2.1, z + cz * 1.0], s: [0.2, 3.5, 0.2], c: WOOD })
  }
  // Most of the sand has run through: a big heap below, a little left above.
  ;[[1.6, 0.6], [1.2, 0.95], [0.8, 1.28], [0.4, 1.58]].forEach(([w, y]) => boxes.push({ p: [x, y, z], s: [w, 0.34, w], c: SAND }))
  ;[[0.45, 2.5], [0.8, 2.78], [1.1, 3.1]].forEach(([w, y]) => boxes.push({ p: [x, y, z], s: [w, 0.3, w], c: SAND }))
  return boxes
}

/**
 * The Store: a booth on the west side, open towards the square, with a counter, a
 * till and shelves of little chair-coloured blocks. Its striped awning, sign and the
 * chair on its roof are drawn in Shops.jsx.
 */
export const STORE_ROOF_Y = 4.08

function storeBoxes() {
  const { x, z } = STORE
  const at = (lx, ly, lz) => [x + lx, ly, z + lz]
  const PURPLE = '#7b4dff'
  const boxes = [
    { p: at(0.3, 0.125, 0), s: [5, 0.25, 8], c: '#e8d9c0' },
    { p: at(-2, 2.05, 0), s: [0.4, 3.6, 8], c: PURPLE },
    ...[-1, 1].map((side) => ({ p: at(-0.3, 2.05, side * 3.85), s: [3.8, 3.6, 0.3], c: '#6a3dff' })),
    ...[-1, 1].map((side) => ({ p: at(1.95, 2.05, side * 3.85), s: [0.3, 3.6, 0.3], c: GOLD })),
    { p: at(0, STORE_ROOF_Y - 0.13, 0), s: [4.6, 0.26, 8.3], c: '#5b2fd8' },
    { p: at(1.2, 0.8, 0), s: [1.2, 1.1, 6], c: '#ffcf4a' },
    { p: at(1.2, 1.41, 0), s: [1.4, 0.12, 6.2], c: '#ffffff' },
    // The till.
    { p: at(1.2, 1.65, 2), s: [0.55, 0.36, 0.65], c: '#3c3f52' },
    { p: at(1.49, 1.72, 2), s: [0.04, 0.2, 0.44], c: '#5cff5c' },
  ]
  // Two shelves on the back wall, stocked with blocks in the Store's chair colours.
  const stock = DATA.chairs.filter((c) => !c.lobby && c.id !== 'basic').map((c) => c.color)
  for (const [k, y] of [1.35, 2.45].entries()) {
    boxes.push({ p: at(-1.55, y, 0), s: [0.55, 0.08, 7.2], c: '#5b3520' })
    for (let i = 0; i < 9; i += 1) {
      boxes.push({
        p: at(-1.55, y + 0.23, -3.1 + i * 0.775),
        s: [0.38, 0.38, 0.38],
        c: stock[(i + k * 5) % stock.length],
        ry: (i % 3) * 0.3,
      })
    }
  }
  return boxes
}

/** The guide board's posts and frame; its face is drawn by GuideBoard. */
export const GUIDE = { width: 4.8, height: 3.3, y: 2.55 }

function guideFrameBoxes() {
  const { x, z, ry } = GUIDE_BOARD
  const at = (lx, lz) => {
    const [dx, dz] = rotateXZ(lx, lz, ry)
    return [x + dx, z + dz]
  }
  const boxes = []
  for (const side of [-1, 1]) {
    const [px, pz] = at(side * (GUIDE.width / 2 + 0.12), 0)
    boxes.push({ p: [px, GUIDE.y / 2 + 0.9, pz], s: [0.28, GUIDE.y + 1.8, 0.28], c: '#4a4560', ry })
  }
  const [fx, fz] = at(0, -0.06)
  boxes.push({ p: [fx, GUIDE.y, fz], s: [GUIDE.width + 0.3, GUIDE.height + 0.3, 0.16], c: '#2c2840', ry })
  const [rx, rz] = at(0, 0)
  boxes.push({ p: [rx, GUIDE.y + GUIDE.height / 2 + 0.28, rz], s: [GUIDE.width + 0.8, 0.22, 0.6], c: BRASS, ry })
  return boxes
}

/** Every prop box of the square, for the scenery mesh. */
export function lobbyBoxes() {
  return [
    ...lampBoxes(),
    ...STRINGS.rope,
    ...planterBoxes(),
    ...towerBoxes(),
    ...hourglassBoxes(),
    ...storeBoxes(),
    ...guideFrameBoxes(),
  ]
}

/** Rug colours cycled down the avenues of tables. */
export const RUG_COLORS = ['#e85d5d', '#f2a93b', '#4aa3df', '#9b6bd6', '#3cb878']

/** A rug under each table and its two chairs, turned with it. */
export const RUG_ITEMS = DATA.tables.map((t, i) => ({
  p: [t.x, FLOOR.rug, t.z],
  s: [TABLE.width + 1.4, 1, TABLE.depth + 2.2 * TABLE.seatZ],
  ry: t.ry,
  c: RUG_COLORS[i % RUG_COLORS.length],
}))
