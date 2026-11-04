import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { BoxGeometry, CanvasTexture, MeshLambertMaterial, Object3D, RepeatWrapping, SRGBColorSpace } from 'three'

import { useGame } from '../net/gameStore'
import { localPlayer } from '../net/liveState'
import Auras from './Aura'
import { COOKIE_PRODUCER, drawCookie } from './cookieBatch'
import { cookieIndex } from './cookies'
import { useCulled } from './culling'
import Instanced from './Instanced'
import { Label } from './labels'
import { cookieById, RARITY_AURA, RARITY_COLORS, SHOWROOM, SHOWROOM_COOKIES, STORE, STORE_STATUE } from './layout'
import { STORE_ROOF_Y } from './lobby'
import { getSettings, useSettings } from './quality'
import { useDisposable } from './useDisposable'

/** Pink-and-cream awning stripes, 16 px tall: tiny on the GPU. */
function createStripeTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 16
  const ctx = canvas.getContext('2d')
  for (let i = 0; i < 8; i += 1) {
    ctx.fillStyle = i % 2 ? '#fff4e0' : '#ff6f9f'
    ctx.fillRect(i * 16, 0, 16, 16)
  }
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.wrapS = tex.wrapT = RepeatWrapping
  return tex
}

function cookieLines(cookie, profile) {
  const owned = profile?.ownedCookies.includes(cookie.id)
  const equipped = profile?.equippedCookie === cookie.id
  const color = RARITY_COLORS[cookie.rarity]
  return [
    { text: cookie.rarity.toUpperCase(), size: 24, color },
    { text: cookie.name, size: 38, color },
    equipped
      ? { text: 'EQUIPPED', size: 30, color: '#ffe23d' }
      : owned
        ? { text: 'OWNED', size: 30, color: '#ffe23d' }
        : { text: `$${cookie.price.toLocaleString('en-US')}`, size: 32, color: '#5cff5c' },
  ]
}

function CookieLabel({ cookie }) {
  const label = useDisposable(() => new Label({ height: 0.34 }), [])
  const profile = useGame((s) => s.profile)
  useEffect(() => label.set(cookieLines(cookie, profile)), [label, cookie, profile])
  useCulled(label.sprite, cookie.shop[0], cookie.shop[1], { label })
  return <primitive object={label.sprite} position={[cookie.shop[0], 3.4, cookie.shop[1]]} />
}

/** A fixed world sign, culled with the other labels. */
export function Sign({ lines, position, height = 0.6, scale = 1.6 }) {
  const label = useDisposable(() => new Label({ height }), [height])
  const key = JSON.stringify(lines)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => label.set(lines), [label, key])
  useCulled(label.sprite, position[0], position[2], { scale })
  return <primitive object={label.sprite} position={position} />
}

const PEDESTAL_TOP = 0.5
const DISPLAY_SCALE = 0.62
const STATUE_SCALE = 1.5

/**
 * Every display cookie: the showroom's, each standing on its edge, turning and
 * floating over its pedestal, then the giant one on the shop's roof, facing the square.
 */
const DISPLAYS = [
  ...SHOWROOM_COOKIES.map((c, i) => ({ type: cookieIndex(c.id), x: c.shop[0], y: 1.55, z: c.shop[1], spin: true, i })),
  { type: cookieIndex(STORE_STATUE), x: STORE.x - 0.3, y: STORE_ROOF_Y + STATUE_SCALE + 0.15, z: STORE.z, spin: false, i: 0 },
]

const _obj = new Object3D()

/** The display cookies, drawn with every other cookie (see CookieInstances). */
function DisplayCookies() {
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    // Out of sight distance, the showroom costs nothing.
    const p = localPlayer.position
    const far = Math.hypot(SHOWROOM.x - p.x, SHOWROOM.z - p.z) > getSettings().viewDistance * 0.5
    for (let k = 0; k < DISPLAYS.length; k += 1) {
      const d = DISPLAYS[k]
      if (far && d.spin) continue
      _obj.position.set(d.x, d.y + Math.sin(t * 1.6 + d.i) * (d.spin ? 0.1 : 0.05), d.z)
      // On its edge (axle along the turning direction), turning about the vertical.
      if (d.spin) _obj.rotation.set(Math.PI / 2, t * 0.7 + d.i * 1.3, Math.sin(t * 0.9 + d.i) * 0.2, 'YZX')
      else _obj.rotation.set(Math.PI / 2, Math.PI / 2, t * 0.25, 'YZX')
      _obj.scale.setScalar(d.spin ? DISPLAY_SCALE : STATUE_SCALE)
      _obj.updateMatrix()
      drawCookie(d.type, _obj.matrix)
    }
  }, COOKIE_PRODUCER)
  return null
}

const SHOWROOM_AURAS = SHOWROOM_COOKIES.map((c) => ({
  x: c.shop[0],
  y: PEDESTAL_TOP,
  z: c.shop[1],
  color: RARITY_COLORS[c.rarity],
  strength: RARITY_AURA[c.rarity],
}))

/**
 * The cookie showroom (a horseshoe of pedestals on the east side of the square,
 * each with a turning cookie in a glowing rarity aura: walk up and press E to buy or
 * equip it) and the Cookie Shop on the west side (press E at its counter to open the
 * shop, where every cookie is on sale, including some you won't find in the
 * showroom).
 */
export function Shops() {
  const { shadows, particles } = useSettings()

  const res = useDisposable(() => {
    const stripes = createStripeTexture()
    stripes.repeat.set(5, 1)
    return {
      stripes,
      box: new BoxGeometry(1, 1, 1),
      tinted: new MeshLambertMaterial({ color: '#ffffff' }),
      awning: new MeshLambertMaterial({ map: stripes }),
      awningGeometry: new BoxGeometry(2.2, 0.16, 8.6),
    }
  }, [])

  // Two tiers: a cream base and a slab trimmed in the cookie's rarity colour, each
  // turned to face the middle of the horseshoe.
  const pedestals = useMemo(
    () =>
      SHOWROOM_COOKIES.flatMap((c) => [
        { p: [c.shop[0], 0.19, c.shop[1]], s: [2, 0.38, 2], c: '#f6e3c8', ry: c.ry },
        { p: [c.shop[0], 0.44, c.shop[1]], s: [1.7, 0.12, 1.7], c: RARITY_COLORS[c.rarity], ry: c.ry },
      ]),
    [],
  )
  const statue = cookieById(STORE_STATUE)

  return (
    <>
      <Instanced geometry={res.box} material={res.tinted} items={pedestals} castShadow={shadows} receiveShadow />
      <DisplayCookies />
      <Auras items={SHOWROOM_AURAS} sparkles={particles} />
      {SHOWROOM_COOKIES.map((c) => (
        <CookieLabel key={c.id} cookie={c} />
      ))}
      <Sign
        lines={[
          { text: 'COOKIE SHOWROOM 🍪', size: 52, color: '#ffcf4a' },
          { text: 'Walk up & press E', size: 26 },
          { text: 'Even more cookies in the 🛒 SHOP', size: 24, color: '#ff9ad5' },
        ]}
        position={[SHOWROOM.x + SHOWROOM.radius + 1.2, 5.4, SHOWROOM.z]}
        height={0.7}
        scale={2.2}
      />

      <mesh
        geometry={res.awningGeometry}
        material={res.awning}
        position={[STORE.x + 2.95, STORE_ROOF_Y - 0.45, STORE.z]}
        rotation={[0, 0, -0.32]}
        castShadow={shadows}
      />
      <Sign
        lines={[
          { text: 'COOKIE SHOP 🛒', size: 60, color: '#ffcf4a' },
          { text: `Cookies · Auras · Titles · Emotes`, size: 24 },
          { text: `${statue.name} inside!`, size: 22, color: RARITY_COLORS[statue.rarity] },
        ]}
        // Above the roof cookie.
        position={[STORE.x + 1, STORE_ROOF_Y + 4.6, STORE.z]}
        height={0.75}
        scale={2.2}
      />
    </>
  )
}

export default Shops
