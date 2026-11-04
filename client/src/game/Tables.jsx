import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { BoxGeometry, MeshBasicMaterial, MeshLambertMaterial } from 'three'

import { useGame } from '../net/gameStore'
import { useCulled } from './culling'
import { Label } from './labels'
import { chairById, chairYaw, DATA, FLOOR, RARITY_AURA, RARITY_COLORS, TABLE, seatPosition } from './layout'
import { useSettings } from './quality'
import Auras from './Aura'
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
import Instanced from './Instanced'
import { mergedBoxes, setInstanceColor, writeInstances } from './instancing'
import TimerDevices from './TimerDevices'
import { useDisposable } from './useDisposable'

/** An unclaimed seat: dark wood frame, cream cushion. */
const EMPTY_CHAIR = '#6b4329'
const EMPTY_CUSHION = '#e9dcc3'

/**
 * Everything of a table below its top, in one geometry: a dark trim under the top's
 * edge, a frame (apron) joining the legs, four legs and a footrest bar.
 */
function createTableBase() {
  const top = TABLE.height - 0.12
  const x = TABLE.width / 2 - 0.16
  const z = TABLE.depth / 2 - 0.16
  return mergedBoxes([
    { size: [TABLE.width + 0.08, 0.06, TABLE.depth + 0.08], at: [0, top - 0.03, 0] },
    { size: [TABLE.width - 0.26, 0.16, 0.06], at: [0, top - 0.14, z] },
    { size: [TABLE.width - 0.26, 0.16, 0.06], at: [0, top - 0.14, -z] },
    { size: [0.06, 0.16, TABLE.depth - 0.26], at: [x, top - 0.14, 0] },
    { size: [0.06, 0.16, TABLE.depth - 0.26], at: [-x, top - 0.14, 0] },
    ...[-x, x].flatMap((lx) => [-z, z].map((lz) => ({ size: [0.13, top, 0.13], at: [lx, top / 2, lz] }))),
    { size: [0.06, 0.06, TABLE.depth - 0.32], at: [0, 0.18, 0] },
  ])
}

const ONE = [1, 1, 1]
const ZERO = [0, 0, 0]

/** Every seat of every table; each chair faces across the table at the other one. */
const SEATS = DATA.tables.flatMap((t) => [0, 1].map((i) => ({ table: t, index: i, ...seatPosition(t.id, i) })))
const placement = () => SEATS.map((s) => ({ p: [s.x, 0, s.z], ry: chairYaw(s), s: ZERO, c: '#ffffff' }))
/** Per-seat placement of the optional parts, rewritten when seats change (scale 0 = hidden). */
const thronePlacement = placement()
const gemPlacement = placement()
const snowPlacement = placement()

/**
 * All ten tables: tops, legs, both chairs each and the timer between them (see
 * TimerDevices), as a handful of instanced meshes. Each seat's chair takes the
 * colour, finish and style of the chair its occupant has equipped.
 */
export function Tables() {
  const { shadows, particles } = useSettings()
  const chairsRef = useRef(null)
  const cushionsRef = useRef(null)
  const thronesRef = useRef(null)
  const gemsRef = useRef(null)
  const snowRef = useRef(null)

  const res = useDisposable(
    () => ({
      top: new BoxGeometry(TABLE.width, 0.12, TABLE.depth),
      legs: createTableBase(),
      chair: addFinishAttribute(createChairFrameGeometry(), SEATS.length),
      cushion: createChairCushionGeometry(),
      throne: addFinishAttribute(createThroneGeometry(), SEATS.length),
      gems: createThroneGemGeometry(),
      snow: createSnowGeometry(),
      chairMaterial: createChairMaterial(),
      snowMaterial: createSnowMaterial(),
      gemMaterial: new MeshBasicMaterial({ color: '#ffffff' }),
      wood: new MeshLambertMaterial({ color: '#d39a62' }),
      darkWood: new MeshLambertMaterial({ color: '#5a3622' }),
      tinted: new MeshLambertMaterial({ color: '#ffffff' }),
    }),
    [],
  )

  const tops = useMemo(() => DATA.tables.map((t) => ({ p: [t.x, TABLE.height - 0.06, t.z], ry: t.ry })), [])
  const legs = useMemo(() => DATA.tables.map((t) => ({ p: [t.x, 0, t.z], ry: t.ry })), [])
  const chairs = useMemo(() => SEATS.map((s) => ({ p: [s.x, 0, s.z], ry: chairYaw(s), c: EMPTY_CHAIR })), [])

  // Seats follow whoever sits there. Subscribing (rather than selecting) means table
  // updates repaint 20 instances without re-rendering React.
  useEffect(() => {
    const paint = (tables) => {
      const frames = chairsRef.current
      const cushions = cushionsRef.current
      if (!frames || !cushions) return
      SEATS.forEach((s, i) => {
        const occupant = tables[s.table.id]?.seats[s.index]
        const chair = occupant ? chairById(occupant.chair) : null
        const color = chair ? chair.color : EMPTY_CHAIR
        setInstanceColor(frames, i, color)
        setInstanceColor(cushions, i, chair ? `#${cushionColor(color)}` : EMPTY_CUSHION)
        setFinish([res.chair, res.throne], i, chair ?? DATA.chairs[0])
        // Thrones get their crest, armrests and jewels, snow chairs their snow; other
        // seats hide them.
        const throne = chair?.style === 'throne'
        thronePlacement[i].s = throne ? ONE : ZERO
        thronePlacement[i].c = color
        gemPlacement[i].s = throne ? ONE : ZERO
        gemPlacement[i].c = RARITY_COLORS[chair?.rarity] ?? '#ffffff'
        snowPlacement[i].s = chair?.style === 'snow' ? ONE : ZERO
      })
      writeInstances(thronesRef.current, thronePlacement)
      writeInstances(gemsRef.current, gemPlacement)
      writeInstances(snowRef.current, snowPlacement)
    }
    paint(useGame.getState().tables)
    return useGame.subscribe((state, prev) => {
      if (state.tables !== prev.tables) paint(state.tables)
    })
  }, [res])

  useLayoutEffect(() => {
    writeInstances(chairsRef.current, chairs)
    writeInstances(cushionsRef.current, chairs)
  }, [chairs])

  return (
    <>
      <Instanced geometry={res.top} material={res.wood} items={tops} castShadow={shadows} receiveShadow />
      <Instanced geometry={res.legs} material={res.darkWood} items={legs} castShadow={shadows} />
      <instancedMesh
        ref={chairsRef}
        args={[res.chair, res.chairMaterial, chairs.length]}
        castShadow={shadows}
        receiveShadow
      />
      <instancedMesh ref={cushionsRef} args={[res.cushion, res.tinted, chairs.length]} receiveShadow />
      <instancedMesh ref={thronesRef} args={[res.throne, res.chairMaterial, chairs.length]} castShadow={shadows} />
      <instancedMesh ref={gemsRef} args={[res.gems, res.gemMaterial, chairs.length]} />
      <instancedMesh ref={snowRef} args={[res.snow, res.snowMaterial, chairs.length]} />
      <TimerDevices />
      {DATA.tables.map((t) => (
        <TableLabel key={t.id} table={t} />
      ))}
      {/* Seat auras are a nice-to-have: off on the LOW preset (which has no particles). */}
      {particles && <SeatAuras />}
    </>
  )
}

/**
 * A rarity aura under every occupied seat whose player has a bought chair equipped.
 * The selector returns a string, so React only re-renders when that set changes.
 */
function SeatAuras() {
  const key = useGame((s) =>
    SEATS.map((seat) => {
      const chair = s.tables[seat.table.id]?.seats[seat.index]?.chair
      return chair && chair !== 'basic' ? chair : ''
    }).join(','),
  )
  const items = useMemo(
    () =>
      key
        .split(',')
        .map((id, i) => {
          if (!id) return null
          const chair = chairById(id)
          const seat = SEATS[i]
          return {
            x: seat.x,
            // The aura's ring lies 0.02 above `y`: clear of the rug under the seat.
            y: FLOOR.aura - 0.02,
            z: seat.z,
            color: RARITY_COLORS[chair.rarity],
            strength: RARITY_AURA[chair.rarity] * 0.7,
          }
        })
        .filter(Boolean),
    [key],
  )
  if (items.length === 0) return null
  return <Auras items={items} />
}

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
  // Spectators get the round and the score.
  return [
    { text: `⏱️ Round ${table.round}`, size: 30, color: '#ffcf4a' },
    { text: `${table.scores[0]}  -  ${table.scores[1]}`, size: 38 },
  ]
}

/**
 * "0/2 Players / Win $200" above a table, or the duel's round and score while it
 * plays. Polled, since the countdown ticks. Hidden at the player's own table, where
 * the HUD shows the same thing.
 */
function TableLabel({ table }) {
  const label = useDisposable(() => new Label({ height: 0.42 }), [])

  useEffect(() => {
    const update = () => {
      const s = useGame.getState()
      label.set(
        s.match?.table === table.id ? [] : tableLines(s.tables[table.id], s.profile?.weekend, Date.now()),
      )
    }
    update()
    const id = setInterval(update, 250)
    return () => clearInterval(id)
  }, [label, table.id])

  useCulled(label.sprite, table.x, table.z, { label, group: 'tables' })
  return <primitive object={label.sprite} position={[table.x, 3.3, table.z]} />
}

export default Tables
