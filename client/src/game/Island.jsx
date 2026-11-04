import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import {
  BoxGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  Object3D,
} from 'three'

import { COOKIE_PRODUCER, drawCookie } from './cookieBatch'
import { cookieIndex } from './cookies'
import Instanced from './Instanced'
import {
  createCloudSeaTexture,
  createCrystalGeometry,
  createIslandRockGeometry,
  createRailGeometry,
  crystalItems,
  GEAR_ITEMS,
  railPosts,
} from './islandGeometry'
import { CRYSTALS, ISLAND_RADIUS, PLANTERS, RAIL_RADIUS, SKY_ISLANDS } from './layout'
import { useSettings } from './quality'
import { BRASS, CLOUD_SEA } from './sceneStyle'
import { useDisposable } from './useDisposable'

/**
 * Everything that makes the map a floating island: its rocky underside and the
 * little islands drifting round it (1 draw call), the brass railing round its rim
 * (2), the glowing sugar crystals (1) and the sea of clouds far below (1). The giant
 * cookies rolling slowly on their stands round the edge are drawn with every other
 * cookie (see CookieInstances), in flavours the showroom shows too, so they add no
 * draw calls of their own.
 */

const _obj = new Object3D()
const _color = new Color()
/** The giant cookies turn this fast (radians per second), alternately one way and the other. */
const GEAR_SPEED = 0.25
const GIANT_COOKIES = ['classic', 'choco', 'berry', 'mint', 'sugar', 'midnight'].map(cookieIndex)

/** The main island, then the sky islands: position and scale of each rock. */
const ROCKS = [
  { p: [0, -0.03, 0], s: ISLAND_RADIUS },
  ...SKY_ISLANDS.map(([x, y, z, s]) => ({ p: [x, y, z], s: s * ISLAND_RADIUS })),
]

/** Crystals round the edge, in the planters by the entrance and on each sky island. */
const CRYSTAL_ITEMS = [
  ...crystalItems(CRYSTALS),
  ...crystalItems(PLANTERS.flatMap(([x, z, , d]) => [[x, z - d / 4, 0.42, 0.5], [x, z + d / 4, 0.36, 0.5]])),
  ...crystalItems(SKY_ISLANDS.map(([x, y, z, s]) => [x, z, s * 9, y])),
]

export function Island() {
  const { shadows } = useSettings()
  const rockRef = useRef(null)
  const crystalRef = useRef(null)

  const res = useDisposable(() => {
    const sea = createCloudSeaTexture()
    return {
      sea,
      rock: createIslandRockGeometry(),
      rockMaterial: new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }),
      rail: createRailGeometry(RAIL_RADIUS),
      railMaterial: new MeshPhongMaterial({ color: BRASS.rail, shininess: 70, specular: '#fff2c0' }),
      post: new BoxGeometry(0.2, 1.2, 0.2),
      postMaterial: new MeshLambertMaterial({ color: BRASS.post }),
      crystal: createCrystalGeometry(),
      crystalMaterial: new MeshBasicMaterial({ vertexColors: true }),
      seaGeometry: new CircleGeometry(900, 48).rotateX(-Math.PI / 2),
      seaMaterial: new MeshBasicMaterial({ map: sea }),
    }
  }, [])

  const posts = useMemo(() => railPosts(RAIL_RADIUS), [])

  useLayoutEffect(() => {
    const rock = rockRef.current
    ROCKS.forEach(({ p, s }, i) => {
      _obj.position.set(p[0], p[1], p[2])
      _obj.rotation.set(0, i * 1.7, 0)
      _obj.scale.setScalar(s)
      _obj.updateMatrix()
      rock.setMatrixAt(i, _obj.matrix)
    })
    rock.instanceMatrix.needsUpdate = true
    rock.computeBoundingSphere()

    const crystals = crystalRef.current
    CRYSTAL_ITEMS.forEach(({ p, s, rx, rz, c }, i) => {
      _obj.position.set(p[0], p[1], p[2])
      _obj.rotation.set(rx, i * 0.9, rz)
      _obj.scale.setScalar(s)
      _obj.updateMatrix()
      crystals.setMatrixAt(i, _obj.matrix)
      crystals.setColorAt(i, _color.set(c))
    })
    crystals.instanceMatrix.needsUpdate = true
    crystals.instanceColor.needsUpdate = true
    crystals.computeBoundingSphere()
  }, [])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    // Standing on their edges, faces to the middle, rolling slowly on the spot.
    for (let i = 0; i < GEAR_ITEMS.length; i += 1) {
      const { x, z, r, y, ry } = GEAR_ITEMS[i]
      _obj.position.set(x, y, z)
      _obj.rotation.set(Math.PI / 2, ry, t * GEAR_SPEED * (i % 2 ? -1 : 1) * (3 / r), 'YZX')
      _obj.scale.setScalar(r * 0.95)
      _obj.updateMatrix()
      drawCookie(GIANT_COOKIES[i % GIANT_COOKIES.length], _obj.matrix)
    }
    // The clouds below drift slowly past.
    res.sea.offset.x = t * 0.004
  }, COOKIE_PRODUCER)

  return (
    <>
      <instancedMesh ref={rockRef} args={[res.rock, res.rockMaterial, ROCKS.length]} />
      <mesh geometry={res.rail} material={res.railMaterial} castShadow={shadows} />
      <Instanced geometry={res.post} material={res.postMaterial} items={posts} castShadow={shadows} />
      <instancedMesh ref={crystalRef} args={[res.crystal, res.crystalMaterial, CRYSTAL_ITEMS.length]} />
      <mesh geometry={res.seaGeometry} material={res.seaMaterial} position={[0, CLOUD_SEA.y, 0]} />
    </>
  )
}

export default Island
