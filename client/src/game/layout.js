import DATA from '../../../shared/gameData.json'

/**
 * World layout derived from shared/gameData.json, which the server also reads, so
 * table positions and seat checks can never disagree between the two.
 *
 * The map is a round island floating above a sea of clouds at sunset, fenced by a
 * brass railing, with giant gears and glowing crystals round its edge.
 *
 * The lobby is a paved town square with a clock tower in the middle. The ten duel
 * tables stand in two avenues either side of it (five down the west, five down the
 * east), each with its two players facing each other across a timer. Around the
 * square: the leaderboards in a row along the north, the chair showroom in a horseshoe
 * on the east, the Store on the west and the entrance arch on the south.
 */

export { DATA }
export const TABLE = DATA.table
export const TIMER = DATA.timer
export const WORLD_HALF = DATA.world.half
/** The island is a disc this big round the origin; the railing runs just inside its rim. */
export const ISLAND_RADIUS = WORLD_HALF
export const RAIL_RADIUS = ISLAND_RADIUS - 0.4
export const SPAWN = DATA.world.spawn

export const PLAYER_HEIGHT = 1.8
/** How far a seated avatar's hips drop and slide back onto the chair. */
export const SEATED_DROP = -0.36
export const SEATED_BACK = 0.12
/**
 * Where a duel's winner dances: up on the tabletop, this far in front of their
 * seat (towards the table's middle).
 */
export const DANCE_FORWARD = 0.75

/** World offset of a point given in an object's own frame (yaw `ry`, three.js convention). */
export function rotateXZ(lx, lz, ry) {
  const c = Math.cos(ry)
  const s = Math.sin(ry)
  return [lx * c + lz * s, -lx * s + lz * c]
}

/** A point in a table's own frame (seat 0 sits on its +Z end) -> world [x, z]. */
export function tableLocal(table, lx, lz) {
  const [dx, dz] = rotateXZ(lx, lz, table.ry || 0)
  return [table.x + dx, table.z + dz]
}

export const tableById = (id) => DATA.tables.find((t) => t.id === id) || null

/** Which end of the table seat `index` is at: +1 for its +Z end (seat 0), -1 for -Z. */
export const seatSide = (index) => (index === 0 ? 1 : -1)

/**
 * A seat: its chair position and the way the seated player faces (across the table,
 * at the other seat). A yaw `ry` faces the direction (sin ry, cos ry).
 */
export function seatPosition(tableId, index) {
  const t = tableById(tableId)
  if (!t) return null
  const [x, z] = tableLocal(t, 0, seatSide(index) * TABLE.seatZ)
  return { x, z, ry: (t.ry || 0) + (index === 0 ? Math.PI : 0) }
}

/** Chairs are modelled facing -Z: the yaw that turns one to face where its seat faces. */
export const chairYaw = (seat) => seat.ry + Math.PI

/* ---- The timer on every table ------------------------------------------------------ */

/** The clock housing in the middle of the table; a display faces each seat. */
export const DEVICE = { width: 0.62, height: 0.4, depth: 0.28 }
/** Each seat's big button, this far from the table's middle towards that seat. */
export const BUTTON_Z = 0.56

/* ---- Lobby -------------------------------------------------------------------------- */

/**
 * Heights of everything lying flat on the ground, far enough apart that no two ever
 * z-fight (flicker), even in the distance: the square's paving (in three layers where
 * pieces overlap: the field, pads, paths), rugs, baked shadows, players' blob shadows
 * and aura rings. Polygon offset alone can't separate them: it does nothing for a
 * surface seen straight on.
 */
export const FLOOR = { plaza: 0.012, plazaStep: 0.012, rug: 0.06, shadow: 0.075, blob: 0.09, aura: 0.105 }

/** The paved square: its edges in world units. */
export const PLAZA = { x0: -14, x1: 14, z0: -17, z1: 16 }

/** The clock tower in the middle of the square: a TOWER.size square base. */
export const TOWER = { x: 0, z: -3, size: 5 }

/**
 * Lamp posts round the square's edge, in order (bunting hangs between neighbours),
 * leaving the entrance path (due south) open.
 */
export const LAMPS = [
  [-4, 16], [-14, 16], [-14, 5], [-14, -6], [-14, -17], [0, -17],
  [14, -17], [14, -6], [14, 5], [14, 16], [4, 16],
]

/**
 * The chair showroom: the chairs marked `lobby` stand on pedestals in a horseshoe
 * opening towards the square. Every other chair is sold only in the Store popup.
 */
export const SHOWROOM = { x: 18, z: 0, radius: 9, spread: (162 * Math.PI) / 180 }

export const SHOWROOM_CHAIRS = DATA.chairs
  .filter((c) => c.lobby)
  .map((c, i, all) => {
    const a = -SHOWROOM.spread / 2 + (SHOWROOM.spread * i) / Math.max(1, all.length - 1)
    const x = SHOWROOM.x + Math.cos(a) * SHOWROOM.radius
    const z = SHOWROOM.z + Math.sin(a) * SHOWROOM.radius
    // Each pedestal faces the middle of the horseshoe.
    return { ...c, shop: [x, z], ry: Math.atan2(SHOWROOM.x - x, SHOWROOM.z - z) }
  })

/** The Store: a big stall on the west side, facing the square (+X). */
export const STORE = DATA.store
/** The chair on the Store's roof: a teaser for what's inside. */
export const STORE_STATUE = 'plat_throne'

/** The "how to play" board beside the entrance path, turned towards the walk in. */
export const GUIDE_BOARD = { x: -10.5, z: 21.5, ry: 1.25 }
/** A giant hourglass on the other side of the entrance. */
export const HOURGLASS = { x: 10.5, z: 21.5 }

/**
 * Giant brass gears standing round the island's edge, each turned to face the middle:
 * [x, z, radius]. Each stands on a stone block.
 */
export const GEARS = [
  [-21.5, -18, 3.4], [21.5, -18, 3.4], [-21.5, 18.5, 3], [21.5, 18.5, 3],
  [-27.4, -9, 1.9], [-27.4, 9, 1.9],
]

/** Clusters of glowing crystals: [x, z, size]. */
export const CRYSTALS = [
  [-12.5, 26.5, 1], [12.5, 26.5, 1], [-25.5, -14.5, 0.9], [25.5, -13.5, 0.9],
  [-17, 24, 0.8], [17, 24, 0.8], [0, -28, 1.1], [-28.5, 1, 0.7],
]

/** Crystal planters lining the walk in from the spawn point: [x, z, width, depth]. */
export const PLANTERS = [
  [-4.6, 25, 1.3, 4.4],
  [4.6, 25, 1.3, 4.4],
]

/**
 * The welcome arch over the spawn path: pillars at ±ARCH.halfWidth. Tall enough
 * that the follow camera (~5 units up by default) passes under the beam.
 */
export const ARCH = { z: 20.4, halfWidth: 3.4, height: 6 }

/** Little islands floating in the sky round the main one: [x, y, z, scale]. */
export const SKY_ISLANDS = [
  [-70, -6, -95, 0.32], [95, 4, -120, 0.26], [-140, 12, 30, 0.42], [130, -10, 70, 0.36],
  [30, 18, 160, 0.3], [-60, -14, 120, 0.22], [60, 26, -60, 0.16], [-45, 22, -40, 0.12],
]

/**
 * What the player can't walk through, in XZ: turned boxes
 * `{ x, z, hw, hd, c, s }` (half sizes, cos/sin of the yaw) and circles `{ x, z, r }`.
 */
export const COLLIDERS = []

const box = (x, z, w, d, ry = 0) =>
  COLLIDERS.push({ x, z, hw: w / 2, hd: d / 2, c: Math.cos(ry), s: Math.sin(ry) })

for (const t of DATA.tables) box(t.x, t.z, TABLE.width, TABLE.depth, t.ry)
for (const lb of DATA.leaderboards) box(lb.x, lb.z, 6, 0.6, lb.ry)
for (const c of SHOWROOM_CHAIRS) box(c.shop[0], c.shop[1], 2, 2, c.ry)
// The booth, from its back wall to the front of its counter.
box(STORE.x - 0.17, STORE.z, 4.1, 8)
box(TOWER.x, TOWER.z, TOWER.size, TOWER.size)
box(GUIDE_BOARD.x, GUIDE_BOARD.z, 5.4, 0.5, GUIDE_BOARD.ry)
box(HOURGLASS.x, HOURGLASS.z, 2.4, 2.4)
for (const [x, z, w, d] of PLANTERS) box(x, z, w, d)
// Gears turn to face the middle of the island: a thin slab, on a stone block.
for (const [x, z, r] of GEARS) box(x, z, r * 2 + 0.4, 1.2, Math.atan2(-x, -z))
for (const [x, z, size] of CRYSTALS) box(x, z, 1.6 * size, 1.6 * size)
for (const [x, z] of LAMPS) box(x, z, 0.5, 0.5)
for (const side of [-1, 1]) box(side * ARCH.halfWidth, ARCH.z, 1.5, 1.5)

/** What the player can interact with by walking up to it and pressing E. */
export const INTERACTABLES = [
  ...DATA.tables.map((t) => ({ kind: 'table', id: t.id, x: t.x, z: t.z, range: TABLE.sitRange })),
  ...SHOWROOM_CHAIRS.map((c) => {
    // Just in front of the pedestal, on the horseshoe's inside.
    const [x, z] = [c.shop[0] + Math.sin(c.ry) * 1.7, c.shop[1] + Math.cos(c.ry) * 1.7]
    return { kind: 'chair', id: c.id, x, z, range: 2.4 }
  }),
  { kind: 'store', id: 'store', x: STORE.x + 2.2, z: STORE.z, range: 3.8 },
]

export const RARITY_COLORS = {
  common: '#9aa3ad',
  uncommon: '#2fd14f',
  rare: '#3aa0ff',
  epic: '#ff7a1f',
  legendary: '#c04dff',
  mythic: '#ff3dc8',
}

/** How strong a chair's aura is per rarity (scales its size, glow and sparkles). */
export const RARITY_AURA = {
  common: 0.75,
  uncommon: 0.9,
  rare: 1.05,
  epic: 1.2,
  legendary: 1.4,
  mythic: 1.6,
}

/**
 * How a chair's surface catches the light: `shine` scales the specular highlight
 * (metal and gems gleam, wood is dull) and `glow` lights it from within (neon).
 */
export const FINISHES = {
  paint: { shine: 0.25, glow: 0, label: 'Painted' },
  wood: { shine: 0.06, glow: 0, label: 'Wood' },
  metal: { shine: 1, glow: 0.04, label: 'Metal' },
  gem: { shine: 0.85, glow: 0.16, label: 'Gem' },
  frost: { shine: 0.6, glow: 0.1, label: 'Frost' },
  glow: { shine: 0.3, glow: 0.55, label: 'Neon' },
}
export const finishOf = (chair) => FINISHES[chair?.finish] || FINISHES.paint

export const titleById = (id) => DATA.titles.find((t) => t.id === id) || null

export const haloById = (id) => DATA.halos.find((h) => h.id === id) || null

export const chairById = (id) => DATA.chairs.find((c) => c.id === id) || DATA.chairs[0]
export const emoteById = (id) => DATA.emotes.find((e) => e.id === id)
