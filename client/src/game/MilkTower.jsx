import { useFrame } from '@react-three/fiber'
import {
  BufferAttribute,
  Color,
  CylinderGeometry,
  DoubleSide,
  MeshLambertMaterial,
  MeshPhongMaterial,
  Object3D,
  TorusGeometry,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { COOKIE_PRODUCER, drawCookie } from './cookieBatch'
import { cookieIndex } from './cookies'
import { TOWER } from './layout'
import { MILK_GLASS } from './lobby'
import { useSettings } from './quality'
import { useDisposable } from './useDisposable'

/**
 * The square's centrepiece: a giant glass of milk with a giant cookie dunked in it,
 * bobbing and slowly turning, and a striped straw. The plinth is part of the
 * scenery mesh (lobby.js); this is the glass (1 draw call, see-through), the milk,
 * straw and rim (1, vertex coloured) and the cookie (drawn with every other
 * cookie by CookieInstances).
 */

const { radius: R, height: H, y0: Y0, milk: MILK_H } = MILK_GLASS
const COOKIE_TYPE = cookieIndex('classic')
const COOKIE_SCALE = 1.55

/** Gives a geometry one vertex colour (or a function of its position). */
function tint(geometry, hex, shade = null) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry
  if (g !== geometry) geometry.dispose()
  const pos = g.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  const c = new Color()
  for (let i = 0; i < pos.count; i += 1) {
    c.set(typeof hex === 'function' ? hex(pos.getX(i), pos.getY(i), pos.getZ(i)) : hex)
    if (shade) c.multiplyScalar(shade)
    colors.set([c.r, c.g, c.b], i * 3)
  }
  g.setAttribute('color', new BufferAttribute(colors, 3))
  g.deleteAttribute('uv')
  return g
}

function createMilkGeometry() {
  const milk = tint(new CylinderGeometry(R * 0.95, R * 0.88, MILK_H, 40).translate(0, MILK_H / 2, 0), '#fbfdff')
  const rim = tint(new TorusGeometry(R, 0.07, 8, 48).rotateX(Math.PI / 2).translate(0, H, 0), '#dff3ff')
  // A striped straw leaning against the rim: red and white bands.
  const straw = new CylinderGeometry(0.18, 0.18, H + 2.2, 12, 12).translate(0, (H + 2.2) / 2, 0)
  straw.rotateZ(-0.28).translate(R * 0.45, 0.2, -R * 0.35)
  const bands = tint(straw, (x, y) => (Math.floor(y / 0.55) % 2 ? '#ffffff' : '#ff4f6b'))
  const merged = mergeGeometries([milk, rim, bands])
  for (const g of [milk, rim, bands]) g.dispose()
  return merged.translate(TOWER.x, Y0, TOWER.z)
}

const _obj = new Object3D()

export function MilkTower() {
  const { shadows } = useSettings()
  const res = useDisposable(
    () => ({
      glass: new CylinderGeometry(R, R * 0.92, H, 40, 1, true).translate(TOWER.x, Y0 + H / 2, TOWER.z),
      glassMaterial: new MeshPhongMaterial({
        color: '#e6f6ff',
        transparent: true,
        opacity: 0.28,
        shininess: 120,
        specular: '#ffffff',
        depthWrite: false,
        side: DoubleSide,
      }),
      milk: createMilkGeometry(),
      milkMaterial: new MeshLambertMaterial({ vertexColors: true }),
    }),
    [],
  )

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    // Half dunked, bobbing, its face to the entrance, slowly rolling round.
    _obj.position.set(TOWER.x - 0.25, Y0 + MILK_H + 0.35 + Math.sin(t * 1.3) * 0.12, TOWER.z + 0.2)
    _obj.rotation.set(Math.PI / 2, 0.25 + Math.sin(t * 0.4) * 0.15, t * 0.3, 'YZX')
    _obj.scale.setScalar(COOKIE_SCALE)
    _obj.updateMatrix()
    drawCookie(COOKIE_TYPE, _obj.matrix)
  }, COOKIE_PRODUCER)

  return (
    <>
      <mesh geometry={res.milk} material={res.milkMaterial} castShadow={shadows} />
      <mesh geometry={res.glass} material={res.glassMaterial} renderOrder={2} />
    </>
  )
}

export default MilkTower
