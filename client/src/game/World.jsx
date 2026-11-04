import { useLayoutEffect } from 'react'
import { BoxGeometry, CanvasTexture, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, SRGBColorSpace } from 'three'

import { FLOOR, ISLAND_RADIUS } from './layout'
import Leaderboards from './Leaderboards'
import { createPlazaGeometry, LAMP_BULBS, lobbyBoxes, RUG_ITEMS } from './lobby'
import { useSettings } from './quality'
import { GROUND } from './sceneStyle'
import Shops from './Shops'
import Tables from './Tables'
import { createTileTexture, createWorldDiscGeometry } from './textures'
import { archBoxes } from './arch'
import ContactShadows from './ContactShadows'
import ArchSign from './ArchGate'
import GuideBoard from './GuideBoard'
import Instanced from './Instanced'
import Island from './Island'
import { gearStandBoxes } from './islandGeometry'
import { MILK_CARTON } from './layout'
import MilkTower from './MilkTower'
import { Sign } from './Shops'
import { useDisposable } from './useDisposable'

/** World size of one ground texture repeat (2 x 2 flagstones of 1 unit). */
const GROUND_TILE = 2

/**
 * A rug pattern in light tones (instance colour tints it): a plain field, a
 * patterned border band and a thin inner line. 128 px, one shared texture.
 */
function createRugTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#e8e8e8'
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, 14)
  ctx.fillRect(0, size - 14, size, 14)
  ctx.fillRect(0, 0, 14, size)
  ctx.fillRect(size - 14, 0, 14, size)
  ctx.fillStyle = '#9a9a9a'
  for (let i = 4; i < size; i += 12) {
    ctx.fillRect(i, 5, 4, 4)
    ctx.fillRect(i, size - 9, 4, 4)
    ctx.fillRect(5, i, 4, 4)
    ctx.fillRect(size - 9, i, 4, 4)
  }
  ctx.strokeStyle = '#bcbcbc'
  ctx.lineWidth = 2
  ctx.strokeRect(20, 20, size - 40, size - 40)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/**
 * All the box-built scenery (the welcome gate, the giant cookies' stands, and the
 * square's lamp posts, string lights, planters, the milk glass's plinth, the milk
 * carton and the Cookie Shop) as instances of one unit cube: one draw call.
 */
const SCENERY = [...archBoxes(), ...gearStandBoxes(), ...lobbyBoxes()]

/**
 * The map: a round island floating above a sea of clouds at sunset (see Island),
 * paved in lavender flagstones, with the milk-glass square in the middle (see
 * layout.js and lobby.js).
 *
 * Repeated props are instanced and multi-part props are merged, so the whole
 * landscape is a dozen or so draw calls. Everything mounts during the loading
 * screen (and has its shaders compiled there), so nothing pops in once you play.
 */
export function World() {
  const settings = useSettings()
  const shadows = settings.shadows

  const res = useDisposable(() => {
    const groundTexture = createTileTexture({ base: GROUND.base, alt: GROUND.alt, size: 256 })
    return {
      groundTexture,
      ground: new MeshLambertMaterial({ map: groundTexture }),
      groundGeometry: createWorldDiscGeometry(ISLAND_RADIUS, GROUND_TILE),
      box: new BoxGeometry(1, 1, 1),
      // Instance colour does the tinting; the base colour stays white.
      tinted: new MeshLambertMaterial({ color: '#ffffff' }),
      // White flagstones: the square's vertex colours paint them.
      plazaTexture: createTileTexture({ base: '#ffffff', alt: '#f1f1f1', size: 256, seed: 11 }),
      plazaGeometry: createPlazaGeometry(GROUND_TILE),
      rugTexture: createRugTexture(),
      rugGeometry: new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      // Lamp globes and string lights glow: unlit, tinted per instance.
      bulb: new MeshBasicMaterial({ color: '#ffffff' }),
    }
  }, [])
  const plazaMaterial = useDisposable(
    () =>
      new MeshLambertMaterial({
        map: res.plazaTexture,
        vertexColors: true,
        // Sits just above the ground; the offset stops distant flicker.
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    [res],
  )

  const rugMaterial = useDisposable(
    () =>
      new MeshLambertMaterial({
        map: res.rugTexture,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    [res],
  )

  useLayoutEffect(() => {
    for (const t of [res.groundTexture, res.plazaTexture]) {
      t.anisotropy = settings.anisotropy
      t.needsUpdate = true
    }
  }, [res, settings.anisotropy])

  return (
    <>
      <mesh geometry={res.groundGeometry} material={res.ground} receiveShadow />
      <Island />

      <mesh geometry={res.plazaGeometry} material={plazaMaterial} position={[0, FLOOR.plaza, 0]} receiveShadow />
      <Instanced geometry={res.rugGeometry} material={rugMaterial} items={RUG_ITEMS} receiveShadow />
      <Instanced geometry={res.box} material={res.tinted} items={SCENERY} castShadow={shadows} receiveShadow />
      <Instanced geometry={res.box} material={res.bulb} items={LAMP_BULBS} />
      <ArchSign />
      <MilkTower />
      <GuideBoard />
      <Sign
        lines={[{ text: 'MILK 🥛', size: 56, color: '#4f8dff', stroke: '#ffffff' }]}
        position={[MILK_CARTON.x, 5.1, MILK_CARTON.z]}
        height={0.7}
        scale={1.6}
      />
      {/* Realtime shadows are off on LOW: soft baked ones keep the depth. */}
      {!shadows && <ContactShadows />}

      <Tables />
      <Shops />
      <Leaderboards />
    </>
  )
}

export default World
