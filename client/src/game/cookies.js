import {
  BoxGeometry,
  BufferAttribute,
  CircleGeometry,
  Color,
  CylinderGeometry,
  LatheGeometry,
  MeshPhongMaterial,
  OctahedronGeometry,
  Vector2,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { DATA } from './layout'

/**
 * Every cookie in the shop, built in code from its DATA.cookies entry: a puffy
 * baked disc with darker edges, then its toppings (chips, sprinkles, a glaze, gems,
 * glowing lava cracks) or, for sandwich cookies, two shells round a cream filling.
 * No textures and no model files: a few hundred triangles of vertex colours each,
 * crisp at any size, all drawn with ONE shared material.
 *
 * Geometry is a cookie of radius 1 lying flat (faces up and down, ±Y). Toppings go
 * on both faces: a cookie rolls on its edge, so both sides are on show.
 *
 * Per-vertex `aLook` (x: glow, y: shine) lets that one material make gems and lava
 * glow and gold gleam, while dough stays matt.
 */

export const COOKIES = DATA.cookies
export const cookieIndex = (id) => Math.max(0, COOKIES.findIndex((c) => c.id === id))

/** Deterministic 0..1 noise, so a cookie looks the same every time it's built. */
const hash = (a, b) => {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return v - Math.floor(v)
}

const HALF = 0.13
/** Dough profile, top centre to bottom centre: [radius, height]. */
const PROFILE = [
  [0, HALF], [0.34, HALF + 0.006], [0.62, HALF - 0.006], [0.82, HALF - 0.03], [0.94, 0.065],
  [1, 0], [0.95, -0.065], [0.84, -0.11], [0.55, -HALF], [0, -HALF],
]
const SEGMENTS = 22

/** Height of the top face at radius r (the toppings sit on it). */
const topAt = (r) => HALF * (1 - 0.55 * r * r)

const _c = new Color()

/** Fills colour and look attributes for a geometry: one colour, one look. */
function paint(geometry, hex, glow = 0, shine = 0.15, shade = null) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry
  if (g !== geometry) geometry.dispose()
  const pos = g.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  const look = new Float32Array(pos.count * 2)
  const base = new Color(hex)
  for (let i = 0; i < pos.count; i += 1) {
    _c.copy(base)
    if (shade) _c.multiplyScalar(shade(pos.getX(i), pos.getY(i), pos.getZ(i)))
    colors[i * 3] = _c.r
    colors[i * 3 + 1] = _c.g
    colors[i * 3 + 2] = _c.b
    look[i * 2] = glow
    look[i * 2 + 1] = shine
  }
  g.setAttribute('color', new BufferAttribute(colors, 3))
  g.setAttribute('aLook', new BufferAttribute(look, 2))
  g.deleteAttribute('uv')
  return g
}

/**
 * A lathe of `profile`, its rim wobbled a little (a hand-made shape) and its faces
 * dimpled. `seed` varies the wobble per cookie.
 */
function dough(profile, seed) {
  const lathe = new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    SEGMENTS,
  )
  const pos = lathe.getAttribute('position')
  const points = profile.length
  for (let i = 0; i < pos.count; i += 1) {
    // The seam's two copies share a segment index, so the shape stays closed.
    const seg = Math.floor(i / points) % SEGMENTS
    const ring = i % points
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const r = Math.sqrt(x * x + z * z)
    if (r > 1e-4) {
      const k = 1 + (hash(seg, seed) - 0.5) * 0.06
      pos.setX(i, x * k)
      pos.setZ(i, z * k)
    }
    if (ring > 0 && ring < points - 1) pos.setY(i, pos.getY(i) + (hash(seg + seed, ring) - 0.5) * 0.02)
  }
  lathe.computeVertexNormals()
  return lathe
}

/** Baked look: darker towards the rim and underneath, golden in the middle of the top. */
const bake = (x, y, z) => {
  const r = Math.sqrt(x * x + z * z)
  return (y >= 0 ? 1.06 : 0.9) - 0.24 * Math.max(0, r - 0.55) / 0.45
}

/** Places `count` small pieces on a face: returns [x, y, z, yaw, scale] for each. */
function scatter(count, seed, face, maxR = 0.8) {
  const out = []
  for (let i = 0; i < count; i += 1) {
    // Even spread: a golden-angle spiral, jittered.
    const t = (i + 0.5) / count
    const r = maxR * Math.sqrt(t) * (0.85 + hash(i, seed) * 0.3)
    const a = i * 2.39996 + hash(seed, i) * 0.8
    const y = topAt(Math.min(r, 1)) * face
    out.push([Math.cos(a) * r, y, Math.sin(a) * r, hash(i + 7, seed) * Math.PI * 2, 0.8 + hash(i, seed + 3) * 0.45])
  }
  return out
}

function placed(geometry, [x, y, z, yaw, s], face, tilt = 0) {
  geometry.scale(s, s, s)
  if (tilt) geometry.rotateX(tilt)
  geometry.rotateY(yaw)
  if (face < 0) geometry.rotateX(Math.PI)
  geometry.translate(x, y, z)
  return geometry
}

/** Chocolate chips (or raisins): squashed chunks, half sunk into the dough. */
function chips(def, glow, shine) {
  const parts = []
  for (const face of [1, -1]) {
    scatter(face > 0 ? 10 : 7, face > 0 ? 11 : 23, face).forEach((p, i) => {
      const g = new OctahedronGeometry(0.11, 0).scale(1, 0.6, 1)
      parts.push(paint(placed(g, p, face), def.toppings[i % def.toppings.length], glow * 0.5, Math.max(0.3, shine)))
    })
  }
  return parts
}

function sprinkles(def, glow, [onTop, underneath] = [18, 12], lift = 0.012) {
  const parts = []
  for (const face of [1, -1]) {
    scatter(face > 0 ? onTop : underneath, face > 0 ? 5 : 41, face, 0.82).forEach((p, i) => {
      const g = new BoxGeometry(0.17, 0.035, 0.045).translate(0, lift, 0)
      parts.push(paint(placed(g, p, face), def.toppings[i % def.toppings.length], glow, 0.4))
    })
  }
  return parts
}

function gems(def, glow) {
  const parts = []
  for (const face of [1, -1]) {
    scatter(face > 0 ? 8 : 6, face > 0 ? 17 : 29, face, 0.75).forEach((p, i) => {
      const g = new OctahedronGeometry(0.095, 0).scale(1, 1.3, 1).translate(0, 0.03, 0)
      parts.push(paint(placed(g, p, face), def.toppings[i % def.toppings.length], Math.max(0.55, glow), 1))
    })
  }
  return parts
}

/** Glowing cracks across a dark, scorched cookie. */
function cracks(def) {
  const parts = []
  for (const face of [1, -1]) {
    for (let i = 0; i < 7; i += 1) {
      const a = (i / 7) * Math.PI * 2 + hash(i, face) * 0.6
      const r = 0.25 + hash(face, i) * 0.4
      const len = 0.28 + hash(i, 9) * 0.22
      const g = new BoxGeometry(len, 0.03, 0.045)
      g.rotateY(-a + 0.6 * (hash(i, 4) - 0.5))
      g.translate(Math.cos(a) * r, topAt(r) * face + 0.004 * face, Math.sin(a) * r)
      parts.push(paint(g, def.toppings[i % def.toppings.length], 1, 0.2))
    }
  }
  return parts
}

/** A glaze poured over each face: a disc with a wavy, dripping edge. */
function glaze(def, glow) {
  const parts = []
  for (const face of [1, -1]) {
    const g = new CircleGeometry(0.8, SEGMENTS * 2)
    const pos = g.getAttribute('position')
    for (let i = 1; i < pos.count; i += 1) {
      const a = Math.atan2(pos.getY(i), pos.getX(i))
      const k = 1 + 0.07 * Math.sin(a * 5 + face) + 0.04 * Math.sin(a * 11)
      pos.setX(i, pos.getX(i) * k)
      pos.setY(i, pos.getY(i) * k)
    }
    g.rotateX(-Math.PI / 2)
    // Bulged to follow the cookie's dome, just above it.
    for (let i = 0; i < pos.count; i += 1) {
      const r = Math.min(1, Math.hypot(pos.getX(i), pos.getZ(i)))
      pos.setY(i, topAt(r) + 0.012)
    }
    g.computeVertexNormals()
    if (face < 0) g.rotateX(Math.PI)
    parts.push(paint(g, def.glaze, glow * 0.6, 0.6))
  }
  return parts
}

/** Two domed shells round a band of cream: a macaron / sandwich cookie. */
function sandwich(def, seed, glow, shine) {
  const shell = [[0, 0.11], [0.4, 0.108], [0.72, 0.09], [0.92, 0.055], [1, 0.012], [0.97, -0.012], [0, -0.012]]
  const top = dough(shell, seed).translate(0, 0.07, 0)
  const bottom = dough(shell, seed + 5).rotateX(Math.PI).translate(0, -0.07, 0)
  const cream = new CylinderGeometry(0.93, 0.93, 0.11, SEGMENTS, 1, false)
  const creamShade = (x, y, z) => 1 + 0.06 * Math.sin(Math.atan2(z, x) * 9)
  return [
    paint(top, def.dough, glow * 0.3, shine, bake),
    paint(bottom, def.dough, glow * 0.3, shine, bake),
    paint(cream, def.cream, 0, 0.3, creamShade),
  ]
}

/** One cookie's geometry (radius 1, faces ±Y). */
export function createCookieGeometry(def) {
  const seed = def.id.length * 7 + def.id.charCodeAt(0)
  const glow = def.glow || 0
  const shine = def.shine ? 1 : 0.12
  let parts
  if (def.style === 'sandwich') {
    parts = sandwich(def, seed, glow, shine)
  } else {
    const doughShade = def.style === 'lava' ? (x, y, z) => bake(x, y, z) * 0.85 : bake
    parts = [paint(dough(PROFILE, seed), def.dough, def.style === 'gems' ? glow * 0.15 : 0, shine, doughShade)]
    if (def.style === 'chips') parts.push(...chips(def, glow, shine))
    else if (def.style === 'sprinkles') parts.push(...sprinkles(def, glow))
    else if (def.style === 'gems') parts.push(...gems(def, glow))
    else if (def.style === 'lava') parts.push(...cracks(def))
    else if (def.style === 'glaze') {
      parts.push(...glaze(def, glow))
      if (def.toppings?.length) parts.push(...sprinkles(def, glow * 0.5, [10, 8], 0.03))
    }
  }
  const merged = mergeGeometries(parts)
  for (const p of parts) p.dispose()
  merged.computeBoundingSphere()
  return merged
}

/**
 * The material every cookie shares: Phong with vertex colours, plus each vertex's
 * glow (lights it from within) and shine (scales the highlight) from `aLook`.
 */
export function createCookieMaterial() {
  const material = new MeshPhongMaterial({ vertexColors: true, specular: '#ffffff', shininess: 60 })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aLook;\nvarying vec2 vLook;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLook = aLook;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vLook;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vLook.x;',
      )
      .replace(
        '#include <lights_phong_fragment>',
        '#include <lights_phong_fragment>\nmaterial.specularStrength *= vLook.y;',
      )
  }
  return material
}
