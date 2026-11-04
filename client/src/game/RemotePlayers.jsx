import { useFrame } from '@react-three/fiber'
import { memo, Suspense, useLayoutEffect, useRef, useState } from 'react'
import {
  BufferAttribute,
  CanvasTexture,
  Color,
  Frustum,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  Sphere,
  Vector3,
} from 'three'

import { DEFAULT_PROPORTIONS } from '../bloxity/store'
import { useGame } from '../net/gameStore'
import { actionFx, avatarAnchors, localPlayer, remoteEmotes, remotes, remoteSeats } from '../net/liveState'
import { mergedBoxes } from './instancing'
import Nametag from './Nametag'
import { DATA, FLOOR, PLAYER_HEIGHT } from './layout'
import PlayerAvatar from './PlayerAvatar'
import { getSettings } from './quality'
import { skipWhenHidden } from './sceneGraph'
import { clearSeatPose, poseAtSeat } from './seatPose'
import { useDisposable } from './useDisposable'

/** One snapshot interval: interpolation always runs one packet behind. */
const INTERP_S = 0.1
/** Everyone in a full room, plus a bot at every table. */
const MAX_PLAYERS = DATA.roomSize + DATA.tables.length

/** id -> { group, visual, full, active, isFull, dist, inView } */
const registry = new Map()
/** The same entries as a plain array, so the frame loop iterates without allocating. */
const entries = []
const ordered = []
/** On screen first, then nearest first. */
const byViewThenDistance = (a, b) => b.inView - a.inView || a.dist - b.dist

/** How many draw calls an avatar costs: its visible meshes (body + accessories). */
let _meshes = 0
const countMesh = (o) => {
  if (o.isMesh && o.visible) _meshes += 1
}
function drawCallsOf(e, frame) {
  // Accessories change rarely: recount each avatar about once a second, staggered.
  if (e.calls === undefined || (frame + e.stagger) % 60 === 0) {
    _meshes = 0
    e.full.traverse(countMesh)
    e.calls = Math.max(1, _meshes)
  }
  return e.calls
}
let frameNo = 0

const _frustum = new Frustum()
const _viewProjection = new Matrix4()
/** Roughly a standing avatar: centred at chest height. */
const _bounds = new Sphere(new Vector3(), 1.3)

const _obj = new Object3D()
const _color = new Color()

function lerpAngle(a, b, t) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

/** Stable pastel per player id for the far-away crowd stand-ins. */
function idColor(id) {
  let h = 0
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return _color.setHSL((h % 360) / 360, 0.55, 0.62)
}

/** Blocky stand-in figure with per-part shading baked into vertex colours. */
function createProxyGeometry() {
  const parts = [
    { size: [0.36, 0.8, 0.4], at: [-0.2, 0.4, 0], shade: 0.45 },
    { size: [0.36, 0.8, 0.4], at: [0.2, 0.4, 0], shade: 0.45 },
    { size: [0.8, 0.8, 0.42], at: [0, 1.2, 0], shade: 0.9 },
    { size: [0.3, 0.8, 0.36], at: [-0.56, 1.2, 0], shade: 0.75 },
    { size: [0.3, 0.8, 0.36], at: [0.56, 1.2, 0], shade: 0.75 },
    { size: [0.5, 0.5, 0.5], at: [0, 1.86, 0], shade: 1 },
  ]
  const geometry = mergedBoxes(parts)
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  // mergedBoxes keeps part order and a BoxGeometry has 24 vertices.
  parts.forEach((part, i) => {
    for (let v = i * 24; v < (i + 1) * 24; v += 1) colors.fill(part.shade, v * 3, v * 3 + 3)
  })
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return geometry
}

function createBlobTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(0,0,0,0.45)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  return new CanvasTexture(canvas)
}

const RemotePlayer = memo(function RemotePlayer({ meta }) {
  const { id } = meta
  const groupRef = useRef(null)
  const visualRef = useRef(null)
  const fullRef = useRef(null)
  const tagRef = useRef(null)
  /** Set by RemotePlayers each frame: is this one of the nearest few whose tag shows? */
  const [tagGate] = useState(() => ({ show: true }))
  // Offset idle animations so a seated crowd doesn't breathe in unison.
  const motionRef = useRef({ time: id.length * 1.7, speed: 0, grounded: true, maxSpeed: 7, seated: false })

  useLayoutEffect(() => {
    const entry = {
      group: groupRef.current,
      visual: visualRef.current,
      full: fullRef.current,
      active: false,
      isFull: false,
      dist: 0,
      id,
      tagGate,
      stagger: id.length * 7 + id.charCodeAt(0),
    }
    // Hidden avatars (no data yet, or drawn as a crowd stand-in) cost nothing.
    skipWhenHidden(groupRef.current)
    skipWhenHidden(fullRef.current)
    registry.set(id, entry)
    entries.push(entry)
    avatarAnchors.set(id, visualRef.current)
    return () => {
      registry.delete(id)
      entries.splice(entries.indexOf(entry), 1)
      avatarAnchors.delete(id)
    }
  }, [id, tagGate])

  useFrame((_state, delta) => {
    const group = groupRef.current
    const visual = visualRef.current
    const entry = registry.get(id)
    if (!group || !entry) return

    const r = remotes.get(id)
    const seat = remoteSeats.get(id)
    if (!r && !seat) {
      group.visible = false
      entry.active = false
      return
    }
    group.visible = true
    entry.active = true

    const m = motionRef.current
    m.time += delta
    // A Bloxity emote plays until that player moves or sits (or the clip ends).
    const emote = remoteEmotes.get(id)
    if (emote && (seat || emote.done || (r && r.s > 0.5))) remoteEmotes.delete(id)
    m.emote = remoteEmotes.get(id) || null

    if (seat) {
      group.position.set(seat.x, 0, seat.z)
      poseAtSeat(visual, tagRef.current, seat, m, delta, actionFx.get(id))
    } else {
      if (m.seated || m.danceT != null) clearSeatPose(visual, tagRef.current, m)
      r.alpha = Math.min(1, r.alpha + delta / INTERP_S)
      r.x = r.fx + (r.tx - r.fx) * r.alpha
      r.y = r.fy + (r.ty - r.fy) * r.alpha
      r.z = r.fz + (r.tz - r.fz) * r.alpha
      r.ry = lerpAngle(r.fry, r.try, r.alpha)
      group.position.set(r.x, r.y, r.z)
      visual.rotation.y = r.ry
      m.speed = r.s
      m.grounded = r.g
    }
  })

  return (
    <group ref={groupRef} visible={false}>
      <group ref={visualRef}>
        <group ref={fullRef} visible={false}>
          <Suspense fallback={null}>
            <PlayerAvatar
              equipped={meta.equipped ?? null}
              proportions={meta.proportions || DEFAULT_PROPORTIONS}
              silent
              castShadow={false}
              targetHeight={PLAYER_HEIGHT}
              motionRef={motionRef}
            />
          </Suspense>
        </group>
      </group>
      <group ref={tagRef}>
        <Nametag id={id} name={meta.name} streak={meta.streak} title={meta.title} bot={meta.bot} gate={tagGate} />
      </group>
    </group>
  )
})

/**
 * Everyone else in the room.
 *
 * LOD: players you can SEE get their real Bloxity avatar (one merged skinned body
 * plus one draw call per accessory), nearest first, up to the preset's
 * `maxFullAvatars` within `fullAvatarDistance`. Players behind the camera never use
 * up that budget (they wouldn't be drawn anyway), so in a full lobby the ones on
 * screen look like themselves. Anyone past the budget is one instanced figure (one
 * draw call for all of them), and everyone gets an instanced blob shadow.
 */
export function RemotePlayers() {
  const players = useGame((s) => s.players)
  const selfId = useGame((s) => s.selfId)
  const proxyRef = useRef(null)
  const blobRef = useRef(null)

  const res = useDisposable(() => {
    const blobTexture = createBlobTexture()
    return {
      proxyGeometry: createProxyGeometry(),
      proxyMaterial: new MeshLambertMaterial({ vertexColors: true }),
      blobTexture,
      blobGeometry: new PlaneGeometry(1.3, 1.3).rotateX(-Math.PI / 2),
      blobMaterial: new MeshBasicMaterial({
        map: blobTexture,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    }
  }, [])

  useLayoutEffect(() => {
    // Instance colours must exist before first render so the shader is built with them.
    const proxy = proxyRef.current
    for (let i = 0; i < MAX_PLAYERS; i += 1) proxy.setColorAt(i, _color.set('#ffffff'))
    proxy.count = 0
    blobRef.current.count = 0
  }, [])

  useFrame(({ camera }) => {
    const proxy = proxyRef.current
    const blob = blobRef.current
    const settings = getSettings()
    // Last frame's camera: close enough, and its matrices are up to date.
    _viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    _frustum.setFromProjectionMatrix(_viewProjection)

    ordered.length = 0
    for (let k = 0; k < entries.length; k += 1) {
      const e = entries[k]
      if (!e.active) {
        e.full.visible = false
        continue
      }
      const p = e.group.position
      e.dist = Math.hypot(p.x - localPlayer.position.x, p.z - localPlayer.position.z)
      _bounds.center.set(p.x, p.y + 1, p.z)
      e.inView = _frustum.intersectsSphere(_bounds)
      ordered.push(e)
    }
    ordered.sort(byViewThenDistance)

    let proxies = 0
    let blobs = 0
    let fulls = 0
    let calls = 0
    let tags = 0
    frameNo += 1
    for (let i = 0; i < ordered.length; i += 1) {
      const e = ordered[i]
      let full = e.inView && fulls < settings.maxFullAvatars && e.dist < settings.fullAvatarDistance
      if (full) {
        const cost = drawCallsOf(e, frameNo)
        full = calls + cost <= settings.avatarDrawCalls
        if (full) {
          fulls += 1
          calls += cost
        }
      }
      e.full.visible = full
      e.tagGate.show = e.inView && tags < settings.maxNames
      if (e.tagGate.show) tags += 1

      if (!full) {
        _obj.position.copy(e.group.position)
        _obj.rotation.set(0, e.visual.rotation.y, 0)
        _obj.scale.set(1, 1, 1)
        _obj.updateMatrix()
        proxy.setMatrixAt(proxies, _obj.matrix)
        proxy.setColorAt(proxies, idColor(e.id))
        proxies += 1
      }

      _obj.position.set(e.group.position.x, FLOOR.blob, e.group.position.z)
      _obj.rotation.set(0, 0, 0)
      _obj.updateMatrix()
      blob.setMatrixAt(blobs, _obj.matrix)
      blobs += 1
    }

    // Without realtime shadows the local player gets a blob too.
    if (!settings.shadows) {
      _obj.position.set(localPlayer.position.x, FLOOR.blob, localPlayer.position.z)
      _obj.rotation.set(0, 0, 0)
      _obj.updateMatrix()
      blob.setMatrixAt(blobs, _obj.matrix)
      blobs += 1
    }

    proxy.count = proxies
    blob.count = blobs
    // An instanced mesh with nothing to draw still costs a draw call.
    proxy.visible = proxies > 0
    blob.visible = blobs > 0
    if (proxies) {
      proxy.instanceMatrix.needsUpdate = true
      proxy.instanceColor.needsUpdate = true
    }
    if (blobs) blob.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      {Object.values(players)
        .filter((p) => p.id !== selfId)
        .map((p) => (
          <RemotePlayer key={p.id} meta={p} />
        ))}
      {/* Crowd instances move every frame; their bounds are not worth recomputing. */}
      <instancedMesh ref={proxyRef} args={[res.proxyGeometry, res.proxyMaterial, MAX_PLAYERS]} frustumCulled={false} />
      <instancedMesh ref={blobRef} args={[res.blobGeometry, res.blobMaterial, MAX_PLAYERS + 1]} frustumCulled={false} />
    </>
  )
}

export default RemotePlayers
