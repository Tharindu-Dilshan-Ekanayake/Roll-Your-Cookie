import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { BatchedMesh, Matrix4 } from 'three'

import { MAX_COOKIES, queue } from './cookieBatch'
import { COOKIES, createCookieGeometry, createCookieMaterial } from './cookies'
import { getSettings, useSettings } from './quality'

/**
 * Draws every cookie in the world: the ones rolling down the tables, the showroom's
 * and the shop's, and the giant ones round the island.
 *
 * One BatchedMesh holds all sixteen kinds of cookie and one shared material, so
 * every cookie on screen, whatever its kind, is ONE draw call (WebGL multi-draw;
 * browsers without it fall back to one call per cookie, still correct). A fixed
 * pool of MAX_COOKIES instances is reused: each frame the queued cookies (see
 * cookieBatch.js) take the first slots, with their kind and matrix, and the rest
 * are hidden. Nothing is allocated per frame.
 */

const _m = new Matrix4()

function build() {
  const geometries = COOKIES.map((c) => createCookieGeometry(c))
  const vertices = geometries.reduce((n, g) => n + g.getAttribute('position').count, 0)
  const material = createCookieMaterial()
  const mesh = new BatchedMesh(MAX_COOKIES, vertices, 0, material)
  const ids = geometries.map((g) => mesh.addGeometry(g))
  for (const g of geometries) g.dispose()
  // Opaque: no depth sorting needed; each cookie is still culled on its own.
  mesh.sortObjects = false
  mesh.perObjectFrustumCulled = true
  mesh.frustumCulled = false
  const slots = new Int16Array(MAX_COOKIES)
  for (let i = 0; i < MAX_COOKIES; i += 1) {
    mesh.addInstance(ids[0])
    mesh.setVisibleAt(i, false)
    slots[i] = 0
  }
  mesh.castShadow = getSettings().shadows
  return { mesh, material, ids, slots, shown: 0 }
}

export function CookieInstances() {
  const { shadows } = useSettings()
  const scene = useThree((s) => s.scene)
  // Built and added in the effect (not a memo): BatchedMesh.dispose() leaves the
  // mesh unusable, so every mount, StrictMode's double one included, gets its own.
  const ref = useRef(null)
  useEffect(() => {
    const built = build()
    ref.current = built
    scene.add(built.mesh)
    return () => {
      scene.remove(built.mesh)
      built.mesh.dispose()
      built.material.dispose()
      if (ref.current === built) ref.current = null
    }
  }, [scene])

  useEffect(() => {
    if (ref.current) ref.current.mesh.castShadow = shadows
  }, [shadows])

  useFrame(() => {
    const res = ref.current
    if (!res) {
      queue.count = 0
      return
    }
    const { mesh, ids, slots } = res
    const n = queue.count
    for (let i = 0; i < n; i += 1) {
      const type = queue.types[i]
      if (slots[i] !== type) {
        mesh.setGeometryIdAt(i, ids[type])
        slots[i] = type
      }
      mesh.setMatrixAt(i, _m.fromArray(queue.matrices, i * 16))
      if (i >= res.shown) mesh.setVisibleAt(i, true)
    }
    for (let i = n; i < res.shown; i += 1) mesh.setVisibleAt(i, false)
    res.shown = n
    // Nothing to draw: not even the one call.
    mesh.visible = n > 0
    queue.count = 0
  })

  return null
}

export default CookieInstances
