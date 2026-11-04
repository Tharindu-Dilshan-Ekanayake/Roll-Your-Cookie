import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import {
  Color,
  CylinderGeometry,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
} from 'three'

import { useGame } from '../net/gameStore'
import { mergedBoxes } from './instancing'
import { BUTTON_Z, DATA, DEVICE, rotateXZ, seatSide, TABLE } from './layout'
import { pressStop } from './timerActions'
import { useDisposable } from './useDisposable'

/**
 * The timer on every table: a dark housing with a seven-segment display facing each
 * seat, and a big dome button in front of each player. Five draw calls for all ten
 * tables: housings, screens, segments, button bases and domes, all instanced.
 *
 * Each display is 5 digits ("SS.mmm": seconds and milliseconds) of 7 segments plus a
 * decimal point, as
 * instances of one small quad whose colour switches them on and off. The frame loop
 * works out what every display should read from the table state (the clock while it
 * shows, "??.???" once it goes blind, "--.---" after a stop, the revealed times) and
 * repaints a display only when that changes: no allocation, no React.
 */

const TABLES = DATA.tables
const SCREEN_Y = TABLE.height + DEVICE.height * 0.52
const SCREEN = [DEVICE.width - 0.08, DEVICE.height * 0.62]
/** Digit height and width, segment thickness, and where the four digits sit across the screen. */
const DH = 0.15
const DW = 0.066
const ST = 0.016
/** Two digits of seconds, the point, three digits of milliseconds. */
const DIGIT_X = [-0.18, -0.1, 0.02, 0.1, 0.18]
const POINT_X = -0.04
const DIGITS = DIGIT_X.length
const SEGS_PER_FACE = DIGITS * 7 + 1
const SEGS = TABLES.length * 2 * SEGS_PER_FACE

/** Segment positions in a digit (a..g): [x, y, horizontal]. */
const SEGMENT_LAYOUT = [
  [0, DH / 2, true],
  [DW / 2, DH / 4, false],
  [DW / 2, -DH / 4, false],
  [0, -DH / 2, true],
  [-DW / 2, -DH / 4, false],
  [-DW / 2, DH / 4, false],
  [0, 0, true],
]
/** Lit segments per glyph, bit k = segment a..g: digits 0-9, then '-', '?', blank. */
const DASH = 10
const QUESTION = 11
const GLYPHS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x40, 0x53, 0x00]

/** Display palettes: [lit, unlit] segment colours. */
const IDLE = 0
const AMBER = 1
const RED = 2
const GREEN = 3
const PALETTES = [
  ['#8a2a2a', '#1c0808'],
  ['#ffb21e', '#2a1a04'],
  ['#ff3030', '#2a0808'],
  ['#3dff6a', '#082a10'],
].map(([on, off]) => [new Color(on), new Color(off)])

/** Button dome colours. */
const BUTTON = {
  idle: new Color('#6b7280'),
  ready: new Color('#ffb21e'),
  armed: new Color('#22ff55'),
  pressed: new Color('#ff3030'),
  gold: new Color('#ffd23d'),
}
const PRESS_MS = 260

const _obj = new Object3D()

/** Per display: what it shows now (its glyphs, then its palette), to repaint only on change. */
const STRIDE = DIGITS + 1
const shown = new Int8Array(TABLES.length * 2 * STRIDE).fill(-1)
const next = new Int8Array(STRIDE)
/** Per seat: last known "has stopped", and when its button went down (epoch ms). */
const stopped = new Uint8Array(TABLES.length * 2)
const pressedAt = new Float64Array(TABLES.length * 2)

/**
 * The local player's own table, read once per frame: its clock comes from their
 * private match state (the one the HUD shows) and their stop shows before the server
 * confirms it.
 */
const own = { table: -1, seat: -1, startAt: 0, pressed: false }

/** Writes a time in ms as "SS.mmm" glyphs into `next` (capped at 99.999). */
function writeTime(ms) {
  let t = Math.min(99999, Math.max(0, Math.floor(ms)))
  for (let g = DIGITS - 1; g >= 0; g -= 1) {
    next[g] = t % 10
    t = Math.floor(t / 10)
  }
}
function writeGlyph(glyph) {
  for (let g = 0; g < DIGITS; g += 1) next[g] = glyph
}
/** Sets the palette `next` is drawn in. */
const setPalette = (palette) => {
  next[DIGITS] = palette
}
/** Does display `d` need repainting to show `next`? */
function changed(d) {
  const o = d * STRIDE
  for (let k = 0; k < STRIDE; k += 1) if (next[k] !== shown[o + k]) return true
  return false
}

/**
 * What display `f` (facing seat f) of a table reads now: fills `next` and returns
 * the button colour for that seat.
 */
function readDisplay(t, f, mine, now) {
  // `mine`: this is the local player's table (see `own`).
  const phase = t?.phase
  if (!phase || phase === 'waiting' || phase === 'countdown') {
    writeTime(0)
    setPalette(IDLE)
    return BUTTON.idle
  }
  if (phase === 'target') {
    writeTime(t.target)
    setPalette(AMBER)
    return BUTTON.ready
  }
  if (phase === 'running') {
    const elapsed = now - (mine ? own.startAt : t.startAt)
    const stop = t.stops[f] || (mine && own.seat === f && own.pressed)
    setPalette(RED)
    if (stop) writeGlyph(DASH)
    else if (elapsed < t.show) writeTime(elapsed)
    else writeGlyph(QUESTION)
    return stop ? BUTTON.pressed : BUTTON.armed
  }
  const time = t.times[f]
  if (time >= 0) writeTime(time)
  else writeGlyph(DASH)
  if (phase === 'reveal') {
    setPalette(t.roundWinner === f ? GREEN : t.roundWinner < 0 ? AMBER : RED)
    return t.roundWinner === f ? BUTTON.armed : t.roundWinner < 0 ? BUTTON.ready : BUTTON.pressed
  }
  const won = t.winner && t.seats[f]?.id === t.winner
  setPalette(won ? GREEN : RED)
  return won ? BUTTON.gold : BUTTON.idle
}

/** Static placement of every segment, housing, screen and button. */
function place(mesh, i, table, lx, ly, lz, yaw, sx = 1, sy = 1, sz = 1) {
  const [dx, dz] = rotateXZ(lx, lz, table.ry)
  _obj.position.set(table.x + dx, ly, table.z + dz)
  _obj.rotation.set(0, table.ry + yaw, 0)
  _obj.scale.set(sx, sy, sz)
  _obj.updateMatrix()
  mesh.setMatrixAt(i, _obj.matrix)
}

function placeSegments(mesh) {
  TABLES.forEach((t, ti) => {
    for (let f = 0; f < 2; f += 1) {
      const side = seatSide(f)
      const base = (ti * 2 + f) * SEGS_PER_FACE
      // In the face's own frame (the table's, turned round for seat 1), so both
      // displays read left to right for the player facing them.
      const yaw = f === 0 ? 0 : Math.PI
      const out = side * (DEVICE.depth / 2 + 0.006)
      DIGIT_X.forEach((x, d) => {
        SEGMENT_LAYOUT.forEach(([sx, sy, horizontal], k) => {
          const lx = side * (x + sx)
          const w = horizontal ? DW - ST : ST
          const h = horizontal ? ST : DH / 2 - ST
          place(mesh, base + d * 7 + k, t, lx, SCREEN_Y + sy, out, yaw, w, h)
        })
      })
      place(mesh, base + SEGS_PER_FACE - 1, t, side * POINT_X, SCREEN_Y - DH / 2, out, yaw, ST * 1.3, ST * 1.3)
    }
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
}

function paintDisplay(mesh, d) {
  const o = d * STRIDE
  const palette = PALETTES[next[DIGITS]]
  for (let g = 0; g < DIGITS; g += 1) {
    const bits = GLYPHS[next[g]]
    for (let k = 0; k < 7; k += 1) mesh.setColorAt(d * SEGS_PER_FACE + g * 7 + k, palette[(bits >> k) & 1 ? 0 : 1])
  }
  // The decimal point is lit whenever digits are.
  mesh.setColorAt(d * SEGS_PER_FACE + SEGS_PER_FACE - 1, palette[next[0] < DASH ? 0 : 1])
  for (let k = 0; k < STRIDE; k += 1) shown[o + k] = next[k]
}

export function TimerDevices() {
  const segRef = useRef(null)
  const housingRef = useRef(null)
  const screenRef = useRef(null)
  const baseRef = useRef(null)
  const domeRef = useRef(null)
  const gl = useThree((s) => s.gl)

  const res = useDisposable(
    () => ({
      housing: mergedBoxes([
        { size: [DEVICE.width, DEVICE.height, DEVICE.depth], at: [0, DEVICE.height / 2, 0] },
        { size: [DEVICE.width + 0.06, 0.05, DEVICE.depth + 0.06], at: [0, DEVICE.height + 0.025, 0] },
        { size: [DEVICE.width + 0.08, 0.04, DEVICE.depth + 0.1], at: [0, 0.02, 0] },
        // A stubby antenna on top.
        { size: [0.03, 0.12, 0.03], at: [DEVICE.width * 0.32, DEVICE.height + 0.11, 0] },
      ]),
      housingMaterial: new MeshLambertMaterial({ color: '#2a2d40' }),
      screen: new PlaneGeometry(SCREEN[0], SCREEN[1]),
      screenMaterial: new MeshBasicMaterial({ color: '#07070b' }),
      segment: new PlaneGeometry(1, 1),
      segmentMaterial: new MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
      base: new CylinderGeometry(0.14, 0.16, 0.06, 18).translate(0, 0.03, 0),
      baseMaterial: new MeshLambertMaterial({ color: '#1d2030' }),
      // A dome whose bottom sits on the base; the press squashes it down.
      dome: new SphereGeometry(0.105, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1),
      domeMaterial: new MeshPhongMaterial({ color: '#ffffff', shininess: 90, specular: '#ffffff' }),
    }),
    [],
  )

  useEffect(() => {
    TABLES.forEach((t, ti) => {
      place(housingRef.current, ti, t, 0, TABLE.height, 0, 0)
      for (let f = 0; f < 2; f += 1) {
        const side = seatSide(f)
        place(screenRef.current, ti * 2 + f, t, 0, SCREEN_Y, side * (DEVICE.depth / 2 + 0.003), f === 0 ? 0 : Math.PI)
        place(baseRef.current, ti * 2 + f, t, 0, TABLE.height, side * BUTTON_Z, 0)
        place(domeRef.current, ti * 2 + f, t, 0, TABLE.height + 0.06, side * BUTTON_Z, 0)
        domeRef.current.setColorAt(ti * 2 + f, BUTTON.idle)
      }
    })
    for (const r of [housingRef, screenRef, baseRef, domeRef]) {
      r.current.instanceMatrix.needsUpdate = true
      r.current.computeBoundingSphere()
    }
    domeRef.current.instanceColor.needsUpdate = true
    placeSegments(segRef.current)
    shown.fill(-1)
  }, [])

  useFrame(() => {
    const seg = segRef.current
    const domes = domeRef.current
    if (!seg || !domes) return
    const { tables, match, localPress } = useGame.getState()
    const now = Date.now()
    let segsChanged = false
    let domesChanged = false
    own.table = match ? match.table : -1
    own.seat = match ? match.seat : -1
    own.startAt = match ? match.startAt : 0
    own.pressed = Boolean(match && localPress?.round === match.round)

    for (let ti = 0; ti < TABLES.length; ti += 1) {
      const t = tables[TABLES[ti].id]
      const mine = own.table === TABLES[ti].id
      for (let f = 0; f < 2; f += 1) {
        const d = ti * 2 + f
        const color = readDisplay(t, f, mine, now)
        if (changed(d)) {
          paintDisplay(seg, d)
          segsChanged = true
          domes.setColorAt(d, color)
          domesChanged = true
        }

        // The button goes down when its player stops the clock, and pops back up.
        const isStopped = t?.phase === 'running' && (t.stops[f] || (mine && own.seat === f && own.pressed)) ? 1 : 0
        if (isStopped && !stopped[d]) pressedAt[d] = now
        stopped[d] = isStopped
        const p = (now - pressedAt[d]) / PRESS_MS
        if (p >= 0 && p <= 1.2) {
          const side = seatSide(f)
          const squash = 1 - 0.5 * Math.sin(Math.min(1, p) * Math.PI)
          place(domes, d, TABLES[ti], 0, TABLE.height + 0.06, side * BUTTON_Z, 0, 1, squash, 1)
          domesChanged = true
        }
      }
    }
    if (segsChanged) seg.instanceColor.needsUpdate = true
    if (domesChanged) {
      domes.instanceMatrix.needsUpdate = true
      domes.instanceColor.needsUpdate = true
    }
  })

  /** Your own button, tapped on the table: the same as the STOP button. */
  const isMine = (e) => {
    const { match } = useGame.getState()
    if (!match || e.instanceId === undefined) return false
    const ti = Math.floor(e.instanceId / 2)
    return TABLES[ti]?.id === match.table && e.instanceId % 2 === match.seat
  }

  return (
    <>
      <instancedMesh ref={housingRef} args={[res.housing, res.housingMaterial, TABLES.length]} />
      <instancedMesh ref={screenRef} args={[res.screen, res.screenMaterial, TABLES.length * 2]} />
      <instancedMesh ref={segRef} args={[res.segment, res.segmentMaterial, SEGS]} />
      <instancedMesh ref={baseRef} args={[res.base, res.baseMaterial, TABLES.length * 2]} />
      <instancedMesh
        ref={domeRef}
        args={[res.dome, res.domeMaterial, TABLES.length * 2]}
        onPointerOver={(e) => {
          if (isMine(e)) gl.domElement.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          gl.domElement.style.cursor = 'grab'
        }}
        onClick={(e) => {
          // A camera drag that happens to end on the button is not a tap.
          if (e.delta > 8 || !isMine(e)) return
          if (pressStop()) e.stopPropagation()
        }}
      />
    </>
  )
}

export default TimerDevices
