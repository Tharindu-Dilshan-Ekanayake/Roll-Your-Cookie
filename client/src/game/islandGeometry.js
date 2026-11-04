import {
  BufferAttribute,
  CanvasTexture,
  Color,
  LatheGeometry,
  OctahedronGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { GEARS } from './layout'
import { BRASS, CLOUD_SEA, ROCK } from './sceneStyle'

/**
 * Geometry and textures for the floating island: its rocky underside (shared with
 * the little islands in the sky), the brass railing, the crystals, the stands of the
 * giant cookies and the sea of clouds below.
 */

/** Deterministic 0..1 noise, so the rocks look the same on every load. */
const hash = (a, b) => {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return v - Math.floor(v)
}

/** Depth of the underside, as a fraction of the island's radius: [radius, height]. */
const ROCK_PROFILE = [
  [0.001, 0], [1, 0], [1, -0.035], [0.95, -0.11], [0.86, -0.2], [0.73, -0.31],
  [0.56, -0.44], [0.38, -0.57], [0.21, -0.68], [0.08, -0.77], [0.01, -0.82],
]
const ROCK_SEGMENTS = 48

/**
 * The underside of an island of radius 1: an upside-down, jagged cone of rock, flat
 * shaded (faceted), coloured by depth in vertex colours. The top cap at y = 0 is a
 * stone disc (hidden under the paving on the main island). Scale it per instance.
 */
export function createIslandRockGeometry() {
  const lathe = new LatheGeometry(
    ROCK_PROFILE.map(([r, y]) => new Vector2(r, y)),
    ROCK_SEGMENTS,
  )
  const position = lathe.getAttribute('position')
  const points = ROCK_PROFILE.length
  // Push each vertex in or out a little (not the rim, which meets the paving), the
  // same for both copies of the seam so the rock stays closed.
  for (let i = 0; i < position.count; i += 1) {
    const seg = Math.floor(i / points) % ROCK_SEGMENTS
    const ring = i % points
    if (ring < 3) continue
    const k = 1 + (hash(seg, ring) - 0.5) * 0.28
    position.setX(i, position.getX(i) * k)
    position.setZ(i, position.getZ(i) * k)
    position.setY(i, position.getY(i) + (hash(ring, seg) - 0.5) * 0.04)
  }
  const geometry = lathe.toNonIndexed()
  lathe.dispose()
  geometry.computeVertexNormals()

  const rim = new Color(ROCK.rim)
  const mid = new Color(ROCK.mid)
  const deep = new Color(ROCK.deep)
  const c = new Color()
  const pos = geometry.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i += 3) {
    // One colour per face, from its lowest corner: bands of strata down the rock.
    const y = Math.min(pos.getY(i), pos.getY(i + 1), pos.getY(i + 2))
    const t = Math.min(1, -y / 0.8)
    if (t < 0.12) c.copy(rim)
    else if (t < 0.5) c.copy(rim).lerp(mid, (t - 0.12) / 0.38)
    else c.copy(mid).lerp(deep, (t - 0.5) / 0.5)
    // A little variation per face so the facets read.
    c.multiplyScalar(0.9 + hash(i, 3) * 0.2)
    for (let v = 0; v < 3; v += 1) colors.set([c.r, c.g, c.b], (i + v) * 3)
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return geometry
}

/** Two brass rails round the island at `radius`, lying flat, in one geometry. */
export function createRailGeometry(radius) {
  const rings = [0.62, 1.12].map((y) => new TorusGeometry(radius, y > 1 ? 0.075 : 0.055, 6, 128).rotateX(Math.PI / 2).translate(0, y, 0))
  const merged = mergeGeometries(rings)
  for (const g of rings) g.dispose()
  return merged
}

/** Rail posts every ~3 units round the circle. */
export function railPosts(radius) {
  const count = Math.round((Math.PI * 2 * radius) / 3)
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2
    return { p: [Math.sin(a) * radius, 0.6, Math.cos(a) * radius], ry: a }
  })
}

/**
 * A crystal: a stretched octahedron with each face's shade baked into vertex colours,
 * so it reads as faceted while staying unlit (it glows). Instance colour tints it.
 */
export function createCrystalGeometry() {
  const geometry = new OctahedronGeometry(1, 0).scale(0.45, 1.2, 0.45)
  geometry.computeVertexNormals()
  const pos = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i += 1) {
    const s = 0.62 + 0.38 * Math.max(0, normal.getY(i) * 0.6 + normal.getX(i) * 0.5)
    colors.set([s, s, s], i * 3)
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return geometry
}

/** Crystals of a cluster round [x, z]: offsets, heights and tilts, per size. */
const CLUSTER = [
  [0, 0, 1, 0, 0],
  [0.48, 0.18, 0.66, 0.35, 0.1],
  [-0.42, -0.24, 0.72, -0.1, -0.42],
  [0.08, 0.5, 0.52, 0.45, 0.3],
]
export const CRYSTAL_COLORS = ['#5ff3ff', '#c27bff', '#ff7ad9']

/** Every crystal of every cluster: { p, s, rx, rz, c }. */
export function crystalItems(clusters, y = 0) {
  const items = []
  clusters.forEach(([x, z, size, cy = y], k) => {
    for (const [dx, dz, h, rx, rz] of CLUSTER) {
      const s = h * size
      items.push({ p: [x + dx * size, cy + 1.1 * s, z + dz * size], s, rx, rz, c: CRYSTAL_COLORS[k % CRYSTAL_COLORS.length] })
    }
  })
  return items
}

/** Soft puffs of cloud on a pale lavender sea, tiling. 256 px. */
export function createCloudSeaTexture() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = CLOUD_SEA.base
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 40; i += 1) {
    const x = hash(i, 1) * size
    const y = hash(i, 2) * size
    const r = 14 + hash(i, 3) * 34
    // Drawn at every wrap offset so the texture tiles without seams.
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r)
        g.addColorStop(0, `${CLOUD_SEA.puff}e6`)
        g.addColorStop(1, `${CLOUD_SEA.puff}00`)
        ctx.fillStyle = g
        ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2)
      }
    }
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.repeat.set(26, 26)
  return texture
}

/** The giant cookies face the island's middle; each rolls in its own plane (see Island). */
export const GEAR_ITEMS = GEARS.map(([x, z, r]) => ({ x, z, r, y: r + 0.55, ry: Math.atan2(-x, -z) }))

/** Stone blocks the giant cookies stand on, with a post holding each axle. */
export function gearStandBoxes() {
  const boxes = []
  for (const { x, z, r, y, ry } of GEAR_ITEMS) {
    const nx = Math.sin(ry)
    const nz = Math.cos(ry)
    boxes.push({ p: [x, 0.28, z], s: [r * 1.3, 0.56, 1.3], c: '#5b5476', ry })
    boxes.push({ p: [x, 0.62, z], s: [r * 1.1, 0.12, 1.1], c: BRASS.rail, ry })
    // The axle's post stands behind the cookie (away from the square), out of its face.
    boxes.push({ p: [x - nx * 0.34, y / 2 + 0.3, z - nz * 0.34], s: [0.26, y - 0.4, 0.26], c: BRASS.post, ry })
    boxes.push({ p: [x, y, z], s: [0.42, 0.42, 0.86], c: '#2c2840', ry })
  }
  return boxes
}
