import { BufferAttribute, CanvasTexture, CircleGeometry, RepeatWrapping, SRGBColorSpace } from 'three'

/**
 * Procedural textures and geometry for the island's flagstone look.
 *
 * The tiles are drawn on a canvas at runtime rather than shipped as an image, so
 * recolouring the world is just a matter of editing sceneStyle.js.
 */

/** Blends a '#rrggbb' colour towards white (amount > 0) or black (amount < 0). */
function shade(hex, amount) {
  const value = parseInt(hex.slice(1), 16)
  const target = amount > 0 ? 255 : 0
  const t = Math.abs(amount)
  const channel = (shift) => {
    const c = (value >> shift) & 0xff
    return Math.round(c + (target - c) * t)
  }
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`
}

/** Small seeded PRNG, so the stones look the same on every load. */
function seeded(seed) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A tileable flagstone texture: `tiles` x `tiles` square stones alternating `base` /
 * `alt`, each a slightly different shade, with bevelled edges (lit top-left like
 * the scene), a few speckles, and grout lines between them.
 *
 * @param {{ base: string, alt?: string, tiles?: number, size?: number, seed?: number }} options
 */
export function createTileTexture({ base, alt = base, tiles = 2, size = 256, seed = 7 }) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const rand = seeded(seed)

  ctx.fillStyle = shade(base, -0.3)
  ctx.fillRect(0, 0, size, size)

  const cell = size / tiles
  const gap = Math.max(2, Math.round(size * 0.012))
  const bevel = Math.max(2, Math.round(cell * 0.05))
  for (let ty = 0; ty < tiles; ty += 1) {
    for (let tx = 0; tx < tiles; tx += 1) {
      const color = (tx + ty) % 2 === 0 ? base : alt
      const x = tx * cell + gap / 2
      const y = ty * cell + gap / 2
      const w = cell - gap
      const jitter = (rand() - 0.5) * 0.08
      ctx.fillStyle = shade(color, jitter)
      ctx.fillRect(x, y, w, w)
      // Bevel: light top and left edges, dark bottom and right.
      ctx.fillStyle = shade(color, 0.2 + jitter)
      ctx.fillRect(x, y, w, bevel)
      ctx.fillRect(x, y, bevel, w)
      ctx.fillStyle = shade(color, -0.16 + jitter)
      ctx.fillRect(x, y + w - bevel, w, bevel)
      ctx.fillRect(x + w - bevel, y, bevel, w)
      // Speckles in the stone.
      for (let i = 0; i < 9; i += 1) {
        ctx.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'
        const r = cell * (0.015 + rand() * 0.025)
        ctx.beginPath()
        ctx.arc(x + bevel * 2 + rand() * (w - bevel * 4), y + bevel * 2 + rand() * (w - bevel * 4), r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  const texture = new CanvasTexture(canvas)
  // Canvas pixels are sRGB; without this the colours render washed out.
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  // three clamps this to what the GPU supports. Keeps the stones crisp at grazing
  // angles instead of smearing into a blur.
  texture.anisotropy = 16
  return texture
}

/**
 * A flat disc of radius `radius` lying on the ground (facing up), with UVs in world
 * units divided by `tileSize` so the flagstones stay the same size everywhere.
 */
export function createWorldDiscGeometry(radius, tileSize, segments = 72) {
  const geometry = new CircleGeometry(radius, segments).rotateX(-Math.PI / 2)
  const position = geometry.getAttribute('position')
  const uv = new Float32Array(position.count * 2)
  for (let i = 0; i < position.count; i += 1) {
    uv[i * 2] = position.getX(i) / tileSize
    uv[i * 2 + 1] = position.getZ(i) / tileSize
  }
  geometry.setAttribute('uv', new BufferAttribute(uv, 2))
  return geometry
}
