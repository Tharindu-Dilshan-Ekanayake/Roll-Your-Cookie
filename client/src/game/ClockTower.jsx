import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { fontReady, GAME_FONT } from './labels'
import { TOWER } from './layout'
import { CLOCK } from './lobby'
import { useSettings } from './quality'
import { useDisposable } from './useDisposable'

/**
 * The square's centrepiece: a clock tower keeping the real time on four faces. The
 * stonework is part of the world's scenery mesh (see lobby.js); this draws what boxes
 * can't: the faces (1 draw call, one 256 px texture), the hands (1, instanced: hour,
 * minute and a red sweeping second hand per face) and the roof with its jewel (1).
 */

const TEX = 256
/** The four faces: yaw of each (0 faces +Z, the entrance). */
const FACES = [0, Math.PI / 2, Math.PI, -Math.PI / 2]
/** Hands: [length, width, colour, how far out from the face]. */
const HANDS = [
  [0.72, 0.16, '#1d2433', 0.03],
  [1.08, 0.11, '#1d2433', 0.045],
  [1.18, 0.05, '#e8343c', 0.06],
]
const ROOF_H = 2.9
/** Local time = UTC + this (read once: the frame loop allocates nothing, not even a Date). */
const TZ_OFFSET_MS = -new Date().getTimezoneOffset() * 60000

const _obj = new Object3D()
const _color = new Color()

function drawFace(canvas) {
  const ctx = canvas.getContext('2d')
  const c = TEX / 2
  ctx.clearRect(0, 0, TEX, TEX)
  ctx.beginPath()
  ctx.arc(c, c, c - 4, 0, Math.PI * 2)
  ctx.fillStyle = '#ffc93d'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(c, c, c - 16, 0, Math.PI * 2)
  const g = ctx.createRadialGradient(c - 30, c - 34, 10, c, c, c)
  g.addColorStop(0, '#ffffff')
  g.addColorStop(1, '#f1ead8')
  ctx.fillStyle = g
  ctx.fill()
  // Minute ticks, bolder every five.
  ctx.strokeStyle = '#1d2433'
  for (let i = 0; i < 60; i += 1) {
    const a = (i / 60) * Math.PI * 2
    const big = i % 5 === 0
    const r0 = c - (big ? 36 : 28)
    const r1 = c - 22
    ctx.lineWidth = big ? 6 : 2
    ctx.beginPath()
    ctx.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0)
    ctx.lineTo(c + Math.sin(a) * r1, c - Math.cos(a) * r1)
    ctx.stroke()
  }
  ctx.font = `700 34px ${GAME_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#1d2433'
  for (const [n, a] of [[12, 0], [3, 0.5], [6, 1], [9, 1.5]]) {
    const r = c - 60
    ctx.fillText(String(n), c + Math.sin(a * Math.PI) * r, c - Math.cos(a * Math.PI) * r + 2)
  }
}

/** The four faces in one geometry, each on its side of the clock room. */
function createFacesGeometry() {
  const out = CLOCK.roomSize / 2 + 0.01
  const parts = FACES.map((yaw) => {
    const g = new PlaneGeometry(CLOCK.faceSize, CLOCK.faceSize)
    g.translate(0, 0, out)
    g.rotateY(yaw)
    return g
  })
  const merged = mergeGeometries(parts)
  for (const g of parts) g.dispose()
  return merged.translate(TOWER.x, CLOCK.y, TOWER.z)
}

/** Roof cone (turned so its four sides line up with the walls) and the jewel on top. */
function createRoofGeometry() {
  const cone = new ConeGeometry(CLOCK.roomSize * 0.78, ROOF_H, 4, 1).rotateY(Math.PI / 4)
  cone.translate(0, CLOCK.y + CLOCK.roomHeight / 2 + 0.15 + ROOF_H / 2, 0)
  return cone.translate(TOWER.x, 0, TOWER.z)
}

export function ClockTower() {
  const { shadows } = useSettings()
  const handsRef = useRef(null)
  const [drawn, setDrawn] = useState(false)

  const res = useDisposable(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = TEX
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = 4
    return {
      texture,
      faces: createFacesGeometry(),
      faceMaterial: new MeshBasicMaterial({ map: texture, transparent: true }),
      // A hand pivots at its base (the face's centre).
      hand: new BoxGeometry(1, 1, 0.03).translate(0, 0.42, 0),
      handMaterial: new MeshBasicMaterial({ color: '#ffffff' }),
      roof: createRoofGeometry(),
      roofMaterial: new MeshLambertMaterial({ color: '#e8343c' }),
      jewel: new OctahedronGeometry(0.42, 0),
      jewelMaterial: new MeshBasicMaterial({ color: '#ffe84d' }),
    }
  }, [])

  // Drawn once the game font is in, in idle time so it never competes with loading.
  useEffect(() => {
    let cancelled = false
    const draw = () => {
      if (cancelled) return
      drawFace(res.texture.image)
      res.texture.needsUpdate = true
      setDrawn(true)
    }
    fontReady.then(() =>
      window.requestIdleCallback ? window.requestIdleCallback(draw, { timeout: 1500 }) : setTimeout(draw, 50),
    )
    return () => {
      cancelled = true
    }
  }, [res])

  useLayoutEffect(() => {
    const mesh = handsRef.current
    FACES.forEach((_yaw, f) => {
      HANDS.forEach(([, , color], h) => mesh.setColorAt(f * HANDS.length + h, _color.set(color)))
    })
    mesh.instanceColor.needsUpdate = true
  }, [])

  // The real local time; the second hand sweeps smoothly.
  useFrame(() => {
    const mesh = handsRef.current
    if (!mesh) return
    const local = (Date.now() + TZ_OFFSET_MS) / 1000
    const s = local % 60
    const m = (local / 60) % 60
    const hr = (local / 3600) % 12
    const angles = [(hr / 12) * Math.PI * 2, (m / 60) * Math.PI * 2, (s / 60) * Math.PI * 2]
    const out = CLOCK.roomSize / 2
    FACES.forEach((yaw, f) => {
      HANDS.forEach(([length, width, , lift], h) => {
        _obj.position.set(TOWER.x + Math.sin(yaw) * (out + lift), CLOCK.y, TOWER.z + Math.cos(yaw) * (out + lift))
        // Turn the hand round in the face's plane (clockwise as you look at it), then
        // face it out with its side of the tower.
        _obj.rotation.set(0, yaw, -angles[h])
        _obj.scale.set(width, length, 1)
        _obj.updateMatrix()
        mesh.setMatrixAt(f * HANDS.length + h, _obj.matrix)
      })
    })
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <mesh geometry={res.faces} material={res.faceMaterial} visible={drawn} />
      <instancedMesh
        ref={handsRef}
        args={[res.hand, res.handMaterial, FACES.length * HANDS.length]}
        frustumCulled={false}
      />
      <mesh geometry={res.roof} material={res.roofMaterial} castShadow={shadows} />
      <mesh
        geometry={res.jewel}
        material={res.jewelMaterial}
        position={[TOWER.x, CLOCK.y + CLOCK.roomHeight / 2 + 0.15 + ROOF_H + 0.3, TOWER.z]}
      />
    </>
  )
}

export default ClockTower
