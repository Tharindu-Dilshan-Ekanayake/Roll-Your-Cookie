import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import { Color, DoubleSide, MeshBasicMaterial, Object3D, OctahedronGeometry, PlaneGeometry } from 'three'

import { effectQueue } from '../net/liveState'
import { useDisposable } from './useDisposable'

/**
 * Pooled particle effects: confetti over a duel's winner, and little sparks when a
 * button zaps its player (or someone hits a bullseye). Fixed-size pools, preallocated typed
 * arrays, one instanced draw call per effect; nothing is allocated per frame or per
 * spawn.
 *
 * Only mounted on presets with particles enabled (see GameScene).
 */

const CONFETTI = 160
/** Sparks from a zap (and a bullseye's glitter). */
const SPARKS = 48
const GRAVITY = 9

const CONFETTI_COLORS = ['#ff3b3b', '#ffb21e', '#ffee32', '#3bff6f', '#33c8ff', '#b14dff', '#ff4fb8']
const SPARK_COLORS = ['#fff5a8', '#ffffff', '#ffd23d', '#ff8a3d']

const _obj = new Object3D()
const _color = new Color()

/** A pool of particles stored struct-of-arrays style. */
function createPool(size) {
  return {
    size,
    next: 0,
    life: new Float32Array(size),
    pos: new Float32Array(size * 3),
    vel: new Float32Array(size * 3),
    rot: new Float32Array(size * 3),
    spin: new Float32Array(size * 3),
  }
}

function spawn(pool, count, x, y, z, speed, up) {
  for (let n = 0; n < count; n += 1) {
    const i = pool.next
    pool.next = (pool.next + 1) % pool.size
    const a = Math.random() * Math.PI * 2
    const r = Math.random() * speed
    const o = i * 3
    pool.life[i] = 2.2 + Math.random()
    pool.pos[o] = x + (Math.random() - 0.5) * 0.6
    pool.pos[o + 1] = y + Math.random() * 0.8
    pool.pos[o + 2] = z + (Math.random() - 0.5) * 0.6
    pool.vel[o] = Math.cos(a) * r
    pool.vel[o + 1] = up + Math.random() * up
    pool.vel[o + 2] = Math.sin(a) * r
    for (let k = 0; k < 3; k += 1) {
      pool.rot[o + k] = Math.random() * 6
      pool.spin[o + k] = (Math.random() - 0.5) * 12
    }
  }
}

/** Integrates a pool and writes its instance matrices. `drag` slows confetti's fall. */
function step(pool, mesh, dt, drag, floor) {
  let alive = false
  for (let i = 0; i < pool.size; i += 1) {
    const o = i * 3
    if (pool.life[i] <= 0) {
      _obj.scale.setScalar(0)
    } else {
      alive = true
      pool.life[i] -= dt
      pool.vel[o + 1] -= GRAVITY * dt
      if (drag) {
        pool.vel[o] *= 1 - drag * dt
        pool.vel[o + 1] = Math.max(pool.vel[o + 1], -1.6)
        pool.vel[o + 2] *= 1 - drag * dt
      }
      pool.pos[o] += pool.vel[o] * dt
      pool.pos[o + 1] += pool.vel[o + 1] * dt
      pool.pos[o + 2] += pool.vel[o + 2] * dt
      if (pool.pos[o + 1] < floor) {
        pool.pos[o + 1] = floor
        pool.vel[o] *= 0.6
        pool.vel[o + 1] *= -0.3
        pool.vel[o + 2] *= 0.6
      }
      for (let k = 0; k < 3; k += 1) pool.rot[o + k] += pool.spin[o + k] * dt
      _obj.position.set(pool.pos[o], pool.pos[o + 1], pool.pos[o + 2])
      _obj.rotation.set(pool.rot[o], pool.rot[o + 1], pool.rot[o + 2])
      _obj.scale.setScalar(Math.min(1, pool.life[i] * 2))
    }
    _obj.updateMatrix()
    mesh.setMatrixAt(i, _obj.matrix)
  }
  mesh.visible = alive
  if (alive) mesh.instanceMatrix.needsUpdate = true
}

export function Effects() {
  const confettiRef = useRef(null)
  const sparksRef = useRef(null)
  const pools = useRef({ confetti: createPool(CONFETTI), sparks: createPool(SPARKS) })

  const res = useDisposable(
    () => ({
      confettiGeometry: new PlaneGeometry(0.16, 0.09),
      confettiMaterial: new MeshBasicMaterial({ side: DoubleSide }),
      sparkGeometry: new OctahedronGeometry(0.07),
      sparkMaterial: new MeshBasicMaterial(),
    }),
    [],
  )

  useLayoutEffect(() => {
    for (let i = 0; i < CONFETTI; i += 1) {
      confettiRef.current.setColorAt(i, _color.set(CONFETTI_COLORS[i % CONFETTI_COLORS.length]))
    }
    for (let i = 0; i < SPARKS; i += 1) {
      sparksRef.current.setColorAt(i, _color.set(SPARK_COLORS[i % SPARK_COLORS.length]))
    }
    confettiRef.current.visible = false
    sparksRef.current.visible = false
  }, [])

  useFrame((_state, delta) => {
    const dt = Math.min(delta, 0.05)
    const { confetti, sparks } = pools.current
    while (effectQueue.length) {
      const e = effectQueue.shift()
      if (e.kind === 'confetti') spawn(confetti, 80, e.x, e.y, e.z, 4, 4)
      else spawn(sparks, 14, e.x, e.y, e.z, 2.6, 1.4)
    }
    step(confetti, confettiRef.current, dt, 1.5, 0.02)
    step(sparks, sparksRef.current, dt, 2.5, 0.9)
  })

  return (
    <>
      <instancedMesh ref={confettiRef} args={[res.confettiGeometry, res.confettiMaterial, CONFETTI]} frustumCulled={false} />
      <instancedMesh ref={sparksRef} args={[res.sparkGeometry, res.sparkMaterial, SPARKS]} frustumCulled={false} />
    </>
  )
}

export default Effects
