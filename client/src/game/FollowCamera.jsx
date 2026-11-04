import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Vector3 } from 'three'

import { usePlatform } from '../bloxity/platform'
import { useGame } from '../net/gameStore'
import { actionFx, localPlayer, SELF_ANCHOR } from '../net/liveState'
import { seatSide, TABLE, tableById, tableLocal } from './layout'

/** How high above the player's feet the camera aims. */
const LOOK_HEIGHT = 2
/**
 * Extra height on the aim point only (not the camera): tilts the view up a little so
 * the world sits lower in the frame, below the top HUD, with the player still clear.
 */
const AIM_ABOVE = 0.9

const MIN_DISTANCE = 4
const MAX_DISTANCE = 22
const START_DISTANCE = 10

// Pitch limits, in radians. Stops the camera flipping over the top or sinking
// under the ground.
const MIN_PITCH = -0.1
const MAX_PITCH = 1.25
const START_PITCH = 0.32

const DRAG_SENSITIVITY = 0.005
const TOUCH_SENSITIVITY = 0.008
const ZOOM_SENSITIVITY = 0.01

// Higher = snappier. Framerate-independent via the pow() smoothing below.
const POSITION_SMOOTHING = 4
const LOOK_SMOOTHING = 8
const TABLE_SMOOTHING = 3

/**
 * Seated view: over your shoulder, looking across the timer at your opponent, a
 * little to your right so your own head doesn't hide the display.
 */
const DUEL_CAM_BACK = 2
const DUEL_CAM_HEIGHT = 2.75
const DUEL_CAM_SIDE = 0.6
/** Where the view aims: just past the timer, in the table's frame (towards the opponent). */
const DUEL_LOOK_PAST = 0.45
const DUEL_LOOK_HEIGHT = TABLE.height + 0.38
/** After a win: from the opponent's end, looking at you dancing on the table. */
const WIN_CAM_BACK = 2.9
const WIN_CAM_HEIGHT = 2.5
const WIN_LOOK_HEIGHT = 1.8
/** Extra distance back on portrait screens. */
const PORTRAIT_BACK = 0.9

const _desired = new Vector3()
const _target = new Vector3()

/**
 * Third-person orbit camera that trails the local player.
 * Right-drag (mouse) or one-finger drag (touch) orbits; the wheel zooms.
 *
 * While the player is seated at a table it swings round behind their shoulder, the
 * duel view, and orbiting is disabled.
 */
export function FollowCamera() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)

  // Spherical offset from the player. A ref, not state: pointer events write to it
  // every move and the frame loop reads it.
  const orbit = useRef({ yaw: 0, pitch: START_PITCH, distance: START_DISTANCE })
  const lookAt = useRef(new Vector3())
  const initialised = useRef(false)

  useEffect(() => {
    const el = gl.domElement
    if (!el) return undefined

    let dragId = null
    let lastX = 0
    let lastY = 0

    const onPointerDown = (e) => {
      // Mouse: left or right button (the UI is DOM above the canvas, so a click on
      // the canvas is always meant for the camera). Touch: any finger that lands on
      // the canvas (the joystick and buttons are DOM, above it).
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return
      if (dragId !== null) return
      dragId = e.pointerId
      lastX = e.clientX
      lastY = e.clientY
      el.setPointerCapture?.(e.pointerId)
      if (e.pointerType === 'mouse') el.style.cursor = 'grabbing'
    }

    const onPointerMove = (e) => {
      if (e.pointerId !== dragId) return
      // Bloxity's camera_sensitivity setting scales both.
      const k =
        (e.pointerType === 'touch' ? TOUCH_SENSITIVITY : DRAG_SENSITIVITY) *
        usePlatform.getState().cameraSensitivity
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY

      const o = orbit.current
      o.yaw -= dx * k
      o.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, o.pitch + dy * k))
    }

    const endDrag = (e) => {
      if (e.pointerId !== dragId) return
      dragId = null
      el.releasePointerCapture?.(e.pointerId)
      el.style.cursor = 'grab'
    }

    const onWheel = (e) => {
      // Without this the page scrolls behind the canvas.
      e.preventDefault()
      const o = orbit.current
      o.distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, o.distance + e.deltaY * ZOOM_SENSITIVITY))
    }

    // Right-dragging otherwise opens the browser context menu mid-orbit.
    const onContextMenu = (e) => e.preventDefault()

    el.style.cursor = 'grab'
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', endDrag)
    el.addEventListener('pointercancel', endDrag)
    el.addEventListener('contextmenu', onContextMenu)
    // passive:false is required for preventDefault() on wheel to take effect.
    el.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', endDrag)
      el.removeEventListener('pointercancel', endDrag)
      el.removeEventListener('contextmenu', onContextMenu)
      el.removeEventListener('wheel', onWheel)
    }
  }, [gl])

  useFrame(({ size }, delta) => {
    const match = useGame.getState().match
    const table = match && tableById(match.table)

    if (table) {
      // A winner dancing up on the table: swing round to their front once the dance
      // starts. A portrait screen is narrow: step back so the timer and the opponent fit.
      const won = match.won && Date.now() >= (actionFx.get(SELF_ANCHOR)?.danceAt || 0)
      const portrait = size.height > size.width ? PORTRAIT_BACK : 0
      const side = seatSide(match.seat)
      if (won) {
        const [cx, cz] = tableLocal(table, 0, -side * WIN_CAM_BACK)
        const [lx, lz] = tableLocal(table, 0, side * (TABLE.seatZ - 0.75))
        _desired.set(cx, WIN_CAM_HEIGHT, cz)
        _target.set(lx, WIN_LOOK_HEIGHT, lz)
      } else {
        const [cx, cz] = tableLocal(table, side * DUEL_CAM_SIDE, side * (TABLE.seatZ + DUEL_CAM_BACK + portrait))
        const [lx, lz] = tableLocal(table, 0, -side * DUEL_LOOK_PAST)
        _desired.set(cx, DUEL_CAM_HEIGHT + portrait * 0.5, cz)
        _target.set(lx, DUEL_LOOK_HEIGHT, lz)
      }
      const k = 1 - Math.pow(0.001, delta * (TABLE_SMOOTHING / 10) * 3)
      camera.position.lerp(_desired, k)
      lookAt.current.lerp(_target, k)
      camera.lookAt(lookAt.current)
      // Standing up again: resume orbiting from behind the player.
      orbit.current.yaw = 0
      return
    }

    const pos = localPlayer.position
    _target.copy(pos)

    // Spherical -> cartesian. yaw 0 puts the camera behind the player on +Z.
    const { yaw, pitch, distance } = orbit.current
    const horizontal = Math.cos(pitch) * distance
    _desired.set(
      _target.x + Math.sin(yaw) * horizontal,
      _target.y + Math.sin(pitch) * distance + LOOK_HEIGHT,
      _target.z + Math.cos(yaw) * horizontal,
    )

    if (!initialised.current || localPlayer.snapCamera) {
      // Avoid a long swoop in from wherever the camera was (first frame, respawn).
      localPlayer.snapCamera = false
      camera.position.copy(_desired)
      lookAt.current.copy(_target).setY(_target.y + LOOK_HEIGHT + AIM_ABOVE)
      initialised.current = true
    }

    // 1 - pow(x, delta) keeps the easing rate consistent across framerates.
    camera.position.lerp(_desired, 1 - Math.pow(0.001, delta * (POSITION_SMOOTHING / 10)))

    _target.y += LOOK_HEIGHT + AIM_ABOVE
    lookAt.current.lerp(_target, 1 - Math.pow(0.001, delta * (LOOK_SMOOTHING / 10)))
    camera.lookAt(lookAt.current)
  })

  return null
}

export default FollowCamera
