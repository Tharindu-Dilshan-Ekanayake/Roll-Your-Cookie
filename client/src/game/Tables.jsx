import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  BoxGeometry,
  BufferAttribute,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Matrix4,
  MeshLambertMaterial,
  MeshPhongMaterial,
  Object3D,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { DIVIDER_TOP, DIVIDERS, LAUNCH_V } from '../../../shared/plinko.mjs'
import { useGame } from '../net/gameStore'
import Auras from './Aura'
import {
  boardX,
  CUP_HEIGHT,
  CUP_RADIUS,
  CUP_RIM_Y,
  CUP_X,
  CUPS,
  cupU,
  HALF_W,
  LENGTH,
  LIQUID_Y,
  PEGS,
  RISE,
  SLOPE_ANGLE,
  SLOPE_COS,
  SURFACE_Y,
  surfaceY,
} from './board'
import { useCulled } from './culling'
import { Label } from './labels'
import { cookieById, DATA, FLOOR, RARITY_AURA, RARITY_COLORS, rotateXZ, seatPosition } from './layout'
import { useSettings } from './quality'
import { toggleTrap } from './duelActions'
import RollingCookies from './RollingCookies'
import { rolls } from './rolls'
import { useDisposable } from './useDisposable'

/**
 * All fifteen cookie tables: a sloped wooden board with candy pegs, seven glass cups
 * at its foot (milk, or poison only the player who poured it can see) and a glowing
 * pad on each side where the two players stand. No chairs: the cookies are what
 * players collect now.
 *
 * Everything is instanced across every table: the woodwork (1 draw call), the pegs
 * (1), the cups' liquid (1) and glass (1) and the pads (1), whatever is going on at
 * them. The cookies themselves are drawn by RollingCookies + CookieInstances.
 */

const TABLES = DATA.tables
const TABLE_COUNT = TABLES.length
const CUP_COUNT = TABLE_COUNT * CUPS
const SEATS = TABLES.flatMap((t) => [0, 1].map((i) => ({ table: t, index: i, ...seatPosition(t.id, i) })))

const WOOD_LIGHT = '#f0c58c'
const WOOD_DARK = '#8a5530'
const WOOD_RAIL = '#a86a3c'
const CREAM = '#fff1d6'
const CANDY = '#ff5a7a'

/** Liquid colours: milk, a landed-in milk cup (brighter), then each poison kind. */
const MILK = new Color('#f2f7ff')
const MILK_HIT = new Color('#ffffff').multiplyScalar(1.25)
const KIND_COLORS = DATA.poisonKinds.map((k) => new Color(k.color))
const MILK_CODE = -1
const MILK_HIT_CODE = -2

/** Pad colours: free (step on to play), taken, your own. */
const PAD_FREE = '#7dff9a'
const PAD_TAKEN = '#ffcf4a'
const PAD_MINE = '#5ff3ff'

/** Wooden planks with a little grain: 256 px, tinted per part by vertex colour. */
function createWoodTexture() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#f4eadc'
  ctx.fillRect(0, 0, size, size)
  const planks = 4
  for (let p = 0; p < planks; p += 1) {
    const y0 = (p * size) / planks
    ctx.fillStyle = p % 2 ? '#efe2d0' : '#f7eee2'
    ctx.fillRect(0, y0, size, size / planks)
    // Grain: long, soft wavy lines.
    ctx.strokeStyle = 'rgba(150,100,60,0.16)'
    ctx.lineWidth = 1.5
    for (let g = 0; g < 6; g += 1) {
      ctx.beginPath()
      const gy = y0 + 6 + g * (size / planks / 6)
      for (let x = 0; x <= size; x += 16) ctx.lineTo(x, gy + Math.sin(x * 0.05 + p * 2 + g) * 2.5)
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(90,55,30,0.35)'
    ctx.fillRect(0, y0, size, 2)
  }
  const t = new CanvasTexture(canvas)
  t.colorSpace = SRGBColorSpace
  t.wrapS = t.wrapT = RepeatWrapping
  return t
}

const _euler = new Euler()
const _mat = new Matrix4()
const _color = new Color()

/** Boxes in a table's frame, each its own colour, merged into one geometry. */
function coloredBoxes(parts) {
  const geometries = parts.map(({ size, at, rz = 0, color }) => {
    const g = new BoxGeometry(...size)
    g.applyMatrix4(_mat.makeRotationFromEuler(_euler.set(0, 0, rz)))
    g.translate(...at)
    const count = g.getAttribute('position').count
    const colors = new Float32Array(count * 3)
    _color.set(color)
    for (let i = 0; i < count; i += 1) colors.set([_color.r, _color.g, _color.b], i * 3)
    g.setAttribute('color', new BufferAttribute(colors, 3))
    return g
  })
  const merged = mergeGeometries(geometries)
  for (const g of geometries) g.dispose()
  return merged
}

/** A table's woodwork in its own frame: board, rails, launcher, dividers, cup shelf, legs. */
function createFrameGeometry() {
  const tilt = -SLOPE_ANGLE
  const midY = SURFACE_Y + RISE / 2
  const width = HALF_W * 2
  // The shelf's top sits 1 cm under the cups' bottoms: never in the same plane.
  const shelfY = CUP_RIM_Y - CUP_HEIGHT - 0.04
  const legs = []
  // Legs at both ends of the board, up to its underside, and two under the cup shelf.
  for (const z of [-HALF_W + 0.03, HALF_W - 0.03]) {
    for (const v of [0.12, LENGTH - 0.12]) {
      const h = surfaceY(v) - 0.09
      legs.push({ size: [0.11, h, 0.11], at: [boardX(v), h / 2, z], color: WOOD_DARK })
    }
    legs.push({ size: [0.09, shelfY, 0.09], at: [CUP_X + 0.15, shelfY / 2, z * 1.05], color: WOOD_DARK })
  }
  return coloredBoxes([
    // The board: its top face is the surface the cookie rolls on.
    { size: [LENGTH + 0.1, 0.08, width + 0.04], at: [0, midY - 0.04 / SLOPE_COS, 0], rz: tilt, color: WOOD_LIGHT },
    // Side rails, standing proud of the surface.
    ...[-1, 1].map((s) => ({
      size: [LENGTH + 0.14, 0.2, 0.08],
      at: [0, midY + 0.05, s * (HALF_W + 0.04)],
      rz: tilt,
      color: WOOD_RAIL,
    })),
    // The top end and its candy-red launcher track.
    { size: [0.1, 0.22, width + 0.16], at: [boardX(0) - 0.05, SURFACE_Y + RISE + 0.04, 0], color: WOOD_RAIL },
    { size: [0.05, 0.035, width], at: [boardX(LAUNCH_V - 0.13), surfaceY(LAUNCH_V - 0.13) + 0.02, 0], rz: tilt, color: CANDY },
    // Dividers between the cups.
    ...DIVIDERS.map((u) => {
      const v = (DIVIDER_TOP + LENGTH) / 2
      return { size: [LENGTH - DIVIDER_TOP, 0.1, 0.036], at: [boardX(v), surfaceY(v) + 0.05, -u], rz: tilt, color: CREAM }
    }),
    // The shelf the cups stand on, with a lip.
    { size: [0.44, 0.06, width + 0.16], at: [CUP_X, shelfY, 0], color: WOOD_DARK },
    { size: [0.05, 0.12, width + 0.16], at: [CUP_X + 0.22, shelfY + 0.06, 0], color: WOOD_RAIL },
    // Crossbars between the legs.
    ...[0.2, LENGTH - 0.2].map((v) => ({ size: [0.06, 0.06, width], at: [boardX(v), 0.28, 0], color: WOOD_DARK })),
    ...legs,
  ])
}

/** A peg: a candy stick standing out of the board, base at the origin. */
const createPegGeometry = () => new CylinderGeometry(0.034, 0.038, 0.15, 10).translate(0, 0.075, 0)

/** An open glass cup with a base, rim at y = 0. */
function createGlassGeometry() {
  const wall = new CylinderGeometry(CUP_RADIUS, CUP_RADIUS * 0.86, CUP_HEIGHT, 16, 1, true).translate(0, -CUP_HEIGHT / 2, 0)
  const base = new CircleGeometry(CUP_RADIUS * 0.86, 16).rotateX(-Math.PI / 2).translate(0, -CUP_HEIGHT, 0)
  const merged = mergeGeometries([wall.toNonIndexed(), base.toNonIndexed()])
  wall.dispose()
  base.dispose()
  return merged
}

/** The liquid in a cup, its surface at y = 0. */
const createLiquidGeometry = () =>
  new CylinderGeometry(CUP_RADIUS * 0.9, CUP_RADIUS * 0.8, CUP_HEIGHT - 0.1, 16).translate(0, -(CUP_HEIGHT - 0.1) / 2, 0)

/** Lambert lit, plus a glow of its own colour: milk and poison look bright and wet. */
function createLiquidMaterial() {
  const m = new MeshLambertMaterial({ color: '#ffffff' })
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.35;',
    )
  }
  return m
}

const _obj = new Object3D()

/** Places `mesh` instance `i` at table-local (lx, ly, lz), tilted with the board if `tilted`. */
function place(mesh, i, table, lx, ly, lz, tilted = false) {
  const [dx, dz] = rotateXZ(lx, lz, table.ry)
  _obj.position.set(table.x + dx, ly, table.z + dz)
  _obj.rotation.set(0, table.ry, tilted ? -SLOPE_ANGLE : 0, 'YXZ')
  _obj.scale.set(1, 1, 1)
  _obj.updateMatrix()
  mesh.setMatrixAt(i, _obj.matrix)
}

/**
 * What cup `c` of `table` shows the local player: their own poison while it waits
 * for the opponent's cookie, the cup a cookie just landed in, otherwise milk.
 */
function cupCode(table, c, state, anim) {
  // The cup a cookie just landed in shows what was in it, until the next turn.
  const phase = state.tables[table.id]?.phase
  if (anim?.landed && anim.cup === c && (phase === 'rolling' || phase === 'reveal')) {
    return anim.hurt ? anim.kind : MILK_HIT_CODE
  }
  const m = state.match
  if (!m || m.table !== table.id) return MILK_CODE
  let traps = null
  if (m.phase === 'poison') traps = state.trapDraft?.round === m.round ? state.trapDraft.cups : m.myTraps
  else if ((m.phase === 'aim' || m.phase === 'rolling' || m.phase === 'reveal') && m.turn !== m.seat) traps = m.myTraps
  const k = traps ? traps.indexOf(c) : -1
  return k >= 0 ? k % KIND_COLORS.length : MILK_CODE
}

function Cups() {
  const glassRef = useRef(null)
  const liquidRef = useRef(null)
  const gl = useThree((s) => s.gl)
  const shown = useMemo(() => new Int16Array(CUP_COUNT).fill(-99), [])
  const res = useDisposable(
    () => ({
      glass: createGlassGeometry(),
      glassMaterial: new MeshPhongMaterial({
        color: '#e8f6ff',
        transparent: true,
        opacity: 0.4,
        shininess: 110,
        specular: '#ffffff',
        depthWrite: false,
        side: DoubleSide,
      }),
      liquid: createLiquidGeometry(),
      liquidMaterial: createLiquidMaterial(),
    }),
    [],
  )

  useLayoutEffect(() => {
    TABLES.forEach((t, ti) => {
      for (let c = 0; c < CUPS; c += 1) {
        const i = ti * CUPS + c
        place(glassRef.current, i, t, CUP_X, CUP_RIM_Y, -cupU(c))
        place(liquidRef.current, i, t, CUP_X, LIQUID_Y, -cupU(c))
        liquidRef.current.setColorAt(i, MILK)
      }
    })
    for (const mesh of [glassRef.current, liquidRef.current]) {
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    }
    liquidRef.current.instanceColor.needsUpdate = true
  }, [])

  // Repaints only the cups whose contents changed: no allocation, no React.
  useFrame(() => {
    const liquid = liquidRef.current
    if (!liquid) return
    const state = useGame.getState()
    let changed = false
    for (let ti = 0; ti < TABLE_COUNT; ti += 1) {
      const t = TABLES[ti]
      const anim = rolls.get(t.id)
      for (let c = 0; c < CUPS; c += 1) {
        const i = ti * CUPS + c
        const code = cupCode(t, c, state, anim)
        if (code === shown[i]) continue
        shown[i] = code
        liquid.setColorAt(i, code === MILK_CODE ? MILK : code === MILK_HIT_CODE ? MILK_HIT : KIND_COLORS[code])
        changed = true
      }
    }
    if (changed) liquid.instanceColor.needsUpdate = true
  })

  /** Your own table's cup, while you're choosing where the poison goes. */
  const pickable = (e) => {
    const { match } = useGame.getState()
    if (!match || match.phase !== 'poison' || e.instanceId === undefined) return -1
    const ti = Math.floor(e.instanceId / CUPS)
    return TABLES[ti]?.id === match.table ? e.instanceId % CUPS : -1
  }

  return (
    <>
      <instancedMesh ref={liquidRef} args={[res.liquid, res.liquidMaterial, CUP_COUNT]} />
      <instancedMesh
        ref={glassRef}
        args={[res.glass, res.glassMaterial, CUP_COUNT]}
        renderOrder={2}
        onPointerOver={(e) => {
          if (pickable(e) >= 0) gl.domElement.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          gl.domElement.style.cursor = 'grab'
        }}
        onClick={(e) => {
          // A camera drag that happens to end on a cup is not a tap.
          if (e.delta > 8) return
          const cup = pickable(e)
          if (cup < 0) return
          e.stopPropagation()
          toggleTrap(cup)
        }}
      />
    </>
  )
}

function Pads() {
  const ref = useRef(null)
  const res = useDisposable(
    () => ({
      pad: new CylinderGeometry(0.46, 0.5, 0.05, 24).translate(0, 0.025, 0),
      material: createLiquidMaterial(),
    }),
    [],
  )
  useLayoutEffect(() => {
    SEATS.forEach((s, i) => {
      _obj.position.set(s.x, FLOOR.rug + 0.005, s.z)
      _obj.rotation.set(0, 0, 0)
      _obj.updateMatrix()
      ref.current.setMatrixAt(i, _obj.matrix)
      ref.current.setColorAt(i, _color.set(PAD_FREE))
    })
    ref.current.instanceMatrix.needsUpdate = true
    ref.current.instanceColor.needsUpdate = true
    ref.current.computeBoundingSphere()
  }, [])

  // Seats change colour with who stands there. A subscription, not a frame loop.
  useEffect(() => {
    const paint = ({ tables, selfId }) => {
      const mesh = ref.current
      if (!mesh) return
      SEATS.forEach((s, i) => {
        const id = tables[s.table.id]?.seats[s.index]?.id
        mesh.setColorAt(i, _color.set(!id ? PAD_FREE : id === selfId ? PAD_MINE : PAD_TAKEN))
      })
      mesh.instanceColor.needsUpdate = true
    }
    paint(useGame.getState())
    return useGame.subscribe((state, prev) => {
      if (state.tables !== prev.tables || state.selfId !== prev.selfId) paint(state)
    })
  }, [])

  return <instancedMesh ref={ref} args={[res.pad, res.material, SEATS.length]} receiveShadow />
}

function Pegs() {
  const ref = useRef(null)
  const res = useDisposable(
    () => ({ peg: createPegGeometry(), material: new MeshLambertMaterial({ color: '#ffffff' }) }),
    [],
  )
  useLayoutEffect(() => {
    const mesh = ref.current
    let i = 0
    TABLES.forEach((t) => {
      for (const [u, v] of PEGS) {
        place(mesh, i, t, boardX(v), surfaceY(v), -u, true)
        // Candy-striped rows: white and strawberry.
        mesh.setColorAt(i, _color.set(Math.round((v - 0.6) / 0.33) % 2 ? '#ffb3cf' : '#ffffff'))
        i += 1
      }
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [])
  const { shadows } = useSettings()
  return <instancedMesh ref={ref} args={[res.peg, res.material, TABLE_COUNT * PEGS.length]} castShadow={shadows} />
}

export function Tables() {
  const { shadows, particles } = useSettings()
  const frameRef = useRef(null)
  const res = useDisposable(() => {
    const wood = createWoodTexture()
    return {
      wood,
      frame: createFrameGeometry(),
      woodMaterial: new MeshLambertMaterial({ map: wood, vertexColors: true }),
    }
  }, [])

  useLayoutEffect(() => {
    TABLES.forEach((t, i) => place(frameRef.current, i, t, 0, 0, 0))
    frameRef.current.instanceMatrix.needsUpdate = true
    frameRef.current.computeBoundingSphere()
  }, [])

  return (
    <>
      <instancedMesh
        ref={frameRef}
        args={[res.frame, res.woodMaterial, TABLE_COUNT]}
        castShadow={shadows}
        receiveShadow
      />
      <Pegs />
      <Cups />
      <Pads />
      <RollingCookies />
      {TABLES.map((t) => (
        <TableLabel key={t.id} table={t} />
      ))}
      {/* Cookie auras are a nice-to-have: off on the LOW preset (which has no particles). */}
      {particles && <SeatAuras />}
    </>
  )
}

/**
 * A rarity aura under every player at a table who rolls a bought cookie.
 * The selector returns a string, so React only re-renders when that set changes.
 */
function SeatAuras() {
  const key = useGame((s) =>
    SEATS.map((seat) => {
      const cookie = s.tables[seat.table.id]?.seats[seat.index]?.cookie
      return cookie && cookie !== 'classic' ? cookie : ''
    }).join(','),
  )
  const items = useMemo(
    () =>
      key
        .split(',')
        .map((id, i) => {
          if (!id) return null
          const cookie = cookieById(id)
          const seat = SEATS[i]
          return {
            x: seat.x,
            y: FLOOR.aura - 0.02,
            z: seat.z,
            color: RARITY_COLORS[cookie.rarity],
            strength: RARITY_AURA[cookie.rarity] * 0.7,
          }
        })
        .filter(Boolean),
    [key],
  )
  if (items.length === 0) return null
  return <Auras items={items} />
}

const hearts = (n, max) => '❤️'.repeat(Math.max(0, n)) + '🖤'.repeat(Math.max(0, max - n))

function tableLines(table, weekend, now) {
  const reward = DATA.winReward * (weekend ? 2 : 1)
  const prize = weekend
    ? { text: `Win $${reward} (x2)`, size: 34, rainbow: true }
    : { text: `Win $${reward}`, size: 34, color: '#5cff5c' }
  if (!table || table.phase === 'waiting') {
    const n = table ? table.seats.filter(Boolean).length : 0
    return [{ text: `${n}/2 Players`, size: 40 }, prize]
  }
  if (table.phase === 'countdown') {
    return [{ text: `Starting in ${Math.max(1, Math.ceil((table.endsAt - now) / 1000))}`, size: 40 }]
  }
  if (table.phase === 'ended') return []
  const max = DATA.duel.hearts
  return [
    table.phase === 'poison'
      ? { text: '☠️ Poisoning cups…', size: 30, color: '#9dff6a' }
      : { text: `🍪 Round ${table.round}`, size: 30, color: '#ffcf4a' },
    { text: `${hearts(table.hearts[0], max)}  vs  ${hearts(table.hearts[1], max)}`, size: 30 },
  ]
}

/**
 * "0/2 Players / Win $150" above a table, or the duel's round and hearts while it
 * plays. Polled, since the countdown ticks. Hidden at the player's own table, where
 * the HUD shows the same thing.
 */
function TableLabel({ table }) {
  const label = useDisposable(() => new Label({ height: 0.42 }), [])

  useEffect(() => {
    const update = () => {
      const s = useGame.getState()
      label.set(s.match?.table === table.id ? [] : tableLines(s.tables[table.id], s.profile?.weekend, Date.now()))
    }
    update()
    const id = setInterval(update, 250)
    return () => clearInterval(id)
  }, [label, table.id])

  useCulled(label.sprite, table.x, table.z, { label, group: 'tables' })
  return <primitive object={label.sprite} position={[table.x, 3.1, table.z]} />
}

export default Tables
