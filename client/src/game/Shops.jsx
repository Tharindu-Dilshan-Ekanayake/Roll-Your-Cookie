import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three'

import { useGame } from '../net/gameStore'
import Auras from './Aura'
import { useCulled } from './culling'
import Instanced from './Instanced'
import { Label } from './labels'
import {
  addFinishAttribute,
  createChairCushionGeometry,
  createChairFrameGeometry,
  createChairMaterial,
  createSnowGeometry,
  createSnowMaterial,
  createThroneGemGeometry,
  createThroneGeometry,
  cushionColor,
  setFinish,
} from './furniture'
import {
  chairById,
  RARITY_AURA,
  RARITY_COLORS,
  SHOWROOM,
  SHOWROOM_CHAIRS,
  STORE,
  STORE_STATUE,
} from './layout'
import { STORE_ROOF_Y } from './lobby'
import { useSettings } from './quality'
import { useDisposable } from './useDisposable'

/** Purple-and-white awning stripes, 16 px tall: tiny on the GPU. */
function createStripeTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 16
  const ctx = canvas.getContext('2d')
  for (let i = 0; i < 8; i += 1) {
    ctx.fillStyle = i % 2 ? '#ffffff' : '#9b5cff'
    ctx.fillRect(i * 16, 0, 16, 16)
  }
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.wrapS = tex.wrapT = RepeatWrapping
  return tex
}

function chairLines(chair, profile) {
  const owned = profile?.ownedChairs.includes(chair.id)
  const equipped = profile?.equippedChair === chair.id
  const color = RARITY_COLORS[chair.rarity]
  return [
    { text: chair.rarity.toUpperCase(), size: 24, color },
    { text: chair.name, size: 38, color },
    equipped
      ? { text: 'EQUIPPED', size: 30, color: '#ffe23d' }
      : owned
        ? { text: 'OWNED', size: 30, color: '#ffe23d' }
        : { text: `$${chair.price.toLocaleString('en-US')}`, size: 32, color: '#5cff5c' },
  ]
}

function ChairLabel({ chair }) {
  const label = useDisposable(() => new Label({ height: 0.34 }), [])
  const profile = useGame((s) => s.profile)
  useEffect(() => label.set(chairLines(chair, profile)), [label, chair, profile])
  useCulled(label.sprite, chair.shop[0], chair.shop[1], { label })
  return <primitive object={label.sprite} position={[chair.shop[0], 3.4, chair.shop[1]]} />
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
const DISPLAY_SCALE = 1.35
const STATUE_SCALE = 2.1

/**
 * Every display chair: the showroom's, each turning and floating over its pedestal,
 * then the big one on the Store's roof, facing the square.
 */
const DISPLAYS = [
  ...SHOWROOM_CHAIRS.map((c, i) => ({ chair: c, x: c.shop[0], y: PEDESTAL_TOP + 0.15, z: c.shop[1], spin: true, i })),
  { chair: chairById(STORE_STATUE), x: STORE.x - 0.3, y: STORE_ROOF_Y, z: STORE.z, spin: false, i: 0 },
]

const _obj = new Object3D()
const _color = new Color()

/** The display chairs, in one draw call per part (frame, cushion, throne, jewels, snow). */
function DisplayChairs() {
  const frameRef = useRef(null)
  const cushionRef = useRef(null)
  const throneRef = useRef(null)
  const gemRef = useRef(null)
  const snowRef = useRef(null)
  const res = useDisposable(
    () => ({
      frame: addFinishAttribute(createChairFrameGeometry(), DISPLAYS.length),
      cushion: createChairCushionGeometry(),
      throne: addFinishAttribute(createThroneGeometry(), DISPLAYS.length),
      gems: createThroneGemGeometry(),
      snow: createSnowGeometry(),
      material: createChairMaterial(),
      cushionMaterial: new MeshLambertMaterial({ color: '#ffffff' }),
      gemMaterial: new MeshBasicMaterial({ color: '#ffffff' }),
      snowMaterial: createSnowMaterial(),
    }),
    [],
  )

  useLayoutEffect(() => {
    DISPLAYS.forEach(({ chair: c }, i) => {
      frameRef.current.setColorAt(i, _color.set(c.color))
      cushionRef.current.setColorAt(i, _color.set(`#${cushionColor(c.color)}`))
      throneRef.current.setColorAt(i, _color.set(c.color))
      gemRef.current.setColorAt(i, _color.set(RARITY_COLORS[c.rarity]))
      setFinish([res.frame, res.throne], i, c)
    })
    for (const r of [frameRef, cushionRef, throneRef, gemRef]) r.current.instanceColor.needsUpdate = true
  }, [res])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    DISPLAYS.forEach(({ chair: c, x, y, z, spin, i: k }, i) => {
      _obj.position.set(x, y + Math.sin(t * 1.6 + k) * (spin ? 0.08 : 0.04), z)
      // The roof chair faces the square (+X); a chair is modelled facing -Z.
      _obj.rotation.set(0, spin ? t * 0.5 + k * 1.3 : -Math.PI / 2, 0)
      _obj.scale.setScalar(spin ? DISPLAY_SCALE : STATUE_SCALE)
      _obj.updateMatrix()
      frameRef.current.setMatrixAt(i, _obj.matrix)
      cushionRef.current.setMatrixAt(i, _obj.matrix)
      const s = _obj.scale.x
      _obj.scale.setScalar(c.style === 'throne' ? s : 0)
      _obj.updateMatrix()
      throneRef.current.setMatrixAt(i, _obj.matrix)
      gemRef.current.setMatrixAt(i, _obj.matrix)
      _obj.scale.setScalar(c.style === 'snow' ? s : 0)
      _obj.updateMatrix()
      snowRef.current.setMatrixAt(i, _obj.matrix)
    })
    for (const r of [frameRef, cushionRef, throneRef, gemRef, snowRef]) r.current.instanceMatrix.needsUpdate = true
  })

  const n = DISPLAYS.length
  return (
    <>
      <instancedMesh ref={frameRef} args={[res.frame, res.material, n]} castShadow frustumCulled={false} />
      <instancedMesh ref={cushionRef} args={[res.cushion, res.cushionMaterial, n]} frustumCulled={false} />
      <instancedMesh ref={throneRef} args={[res.throne, res.material, n]} castShadow frustumCulled={false} />
      <instancedMesh ref={gemRef} args={[res.gems, res.gemMaterial, n]} frustumCulled={false} />
      <instancedMesh ref={snowRef} args={[res.snow, res.snowMaterial, n]} frustumCulled={false} />
    </>
  )
}

const SHOWROOM_AURAS = SHOWROOM_CHAIRS.map((c) => ({
  x: c.shop[0],
  y: PEDESTAL_TOP,
  z: c.shop[1],
  color: RARITY_COLORS[c.rarity],
  strength: RARITY_AURA[c.rarity],
}))

/**
 * The chair showroom (a horseshoe of pedestals on the east side of the square, each
 * with a turning chair in a glowing rarity aura: walk up and press E to buy or equip
 * it) and the Store on the west side (press E at its counter to open the shop, where
 * every chair is on sale, including many you won't find in the showroom).
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

  // Two tiers: a stone base and a slab trimmed in the chair's rarity colour, each
  // turned to face the middle of the horseshoe.
  const pedestals = useMemo(
    () =>
      SHOWROOM_CHAIRS.flatMap((c) => [
        { p: [c.shop[0], 0.19, c.shop[1]], s: [2, 0.38, 2], c: '#b9bec6', ry: c.ry },
        { p: [c.shop[0], 0.44, c.shop[1]], s: [1.7, 0.12, 1.7], c: RARITY_COLORS[c.rarity], ry: c.ry },
      ]),
    [],
  )

  return (
    <>
      <Instanced geometry={res.box} material={res.tinted} items={pedestals} castShadow={shadows} receiveShadow />
      <DisplayChairs />
      <Auras items={SHOWROOM_AURAS} sparkles={particles} />
      {SHOWROOM_CHAIRS.map((c) => (
        <ChairLabel key={c.id} chair={c} />
      ))}
      <Sign
        lines={[
          { text: 'CHAIR SHOWROOM 🪑', size: 52, color: '#4fd8ff' },
          { text: 'Walk up & press E', size: 26 },
          { text: 'Even more chairs in the 🛒 STORE', size: 24, color: '#ffcf4a' },
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
          { text: 'STORE 🛒', size: 60, color: '#ffcf4a' },
          { text: 'Chairs · Auras · Titles · Emotes', size: 24 },
        ]}
        // Above the roof chair's crest.
        position={[STORE.x + 1, STORE_ROOF_Y + 5.7, STORE.z]}
        height={0.75}
        scale={2.2}
      />
    </>
  )
}

export default Shops
