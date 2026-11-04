import { Color, InstancedBufferAttribute, MeshLambertMaterial, MeshPhongMaterial } from 'three'

import { finishOf } from './layout'
import { mergedBoxes } from './instancing'

/**
 * Chairs, facing -Z (the table side), in two parts so each can take its own colour:
 * the frame in the chair's colour and a padded cushion in a lighter tint of it.
 * Shared by the tables, the showroom and the Store's roof; each part is one
 * instanced mesh, whatever mix of chairs (and finishes) it shows.
 */

/** Frame: legs, seat apron, side rails, back posts, a curved top rail and slats. */
export function createChairFrameGeometry() {
  const legs = [-0.25, 0.25].flatMap((x) =>
    [-0.24, 0.24].map((z) => ({ size: [0.08, 0.42, 0.08], at: [x, 0.21, z] })),
  )
  return mergedBoxes([
    ...legs,
    // Apron under the seat and low rails between the legs.
    { size: [0.62, 0.08, 0.6], at: [0, 0.4, 0] },
    ...[-0.25, 0.25].map((x) => ({ size: [0.05, 0.05, 0.48], at: [x, 0.14, 0] })),
    // Back posts rising from the rear legs.
    ...[-0.27, 0.27].map((x) => ({ size: [0.09, 0.78, 0.09], at: [x, 0.83, 0.26] })),
    // Curved top rail: a wide bar with a raised middle.
    { size: [0.66, 0.1, 0.11], at: [0, 1.2, 0.26] },
    { size: [0.36, 0.06, 0.11], at: [0, 1.27, 0.26] },
    // Three slats.
    ...[-0.13, 0, 0.13].map((x) => ({ size: [0.06, 0.62, 0.05], at: [x, 0.86, 0.27] })),
  ])
}

/** Cushion: a padded seat (stepped edge) and a back pad between the posts. */
export function createChairCushionGeometry() {
  return mergedBoxes([
    { size: [0.58, 0.08, 0.56], at: [0, 0.48, -0.01] },
    { size: [0.5, 0.05, 0.48], at: [0, 0.545, -0.01] },
    { size: [0.42, 0.3, 0.06], at: [0, 0.82, 0.22] },
  ])
}

const _tint = new Color()
const WHITE = new Color('#ffffff')

/** A chair's cushion colour: its frame colour lifted towards white. */
export function cushionColor(frameHex) {
  return _tint.set(frameHex).lerp(WHITE, 0.45).getHexString()
}

/**
 * The extra parts that make a chair a throne: a tall crested back, armrests and a
 * jewel on top. Drawn in the chair's colour on thrones only (instances of other
 * chairs are scaled to nothing).
 */
export function createThroneGeometry() {
  return mergedBoxes([
    // Tall back panel and its stepped crest.
    { size: [0.7, 0.62, 0.08], at: [0, 1.5, 0.3] },
    { size: [0.5, 0.18, 0.08], at: [0, 1.88, 0.3] },
    { size: [0.24, 0.14, 0.08], at: [0, 2.04, 0.3] },
    // Side wings of the crest.
    ...[-1, 1].map((s) => ({ size: [0.12, 0.42, 0.1], at: [s * 0.36, 1.62, 0.3] })),
    // Armrests on posts.
    ...[-1, 1].map((s) => ({ size: [0.1, 0.08, 0.56], at: [s * 0.33, 0.78, 0.0] })),
    ...[-1, 1].map((s) => ({ size: [0.08, 0.26, 0.08], at: [s * 0.33, 0.63, -0.22] })),
  ])
}

/** The throne's jewels (crest gem and armrest knobs), drawn bright and unlit. */
export function createThroneGemGeometry() {
  return mergedBoxes([
    { size: [0.16, 0.16, 0.16], at: [0, 2.2, 0.3] },
    ...[-1, 1].map((s) => ({ size: [0.11, 0.11, 0.11], at: [s * 0.33, 0.87, -0.24] })),
  ])
}

/**
 * Snow piled on a chair's top rail and posts, with icicles under the seat: drawn on
 * snow-style chairs only (instances of other chairs are scaled to nothing).
 */
export function createSnowGeometry() {
  return mergedBoxes([
    { size: [0.74, 0.09, 0.17], at: [0, 1.295, 0.26] },
    { size: [0.42, 0.08, 0.15], at: [0, 1.345, 0.26] },
    { size: [0.2, 0.06, 0.13], at: [0.18, 1.38, 0.25] },
    ...[-0.27, 0.27].map((x) => ({ size: [0.13, 0.07, 0.13], at: [x, 1.27, 0.26] })),
    // A drift along the front of the seat, and icicles hanging under it.
    { size: [0.6, 0.05, 0.1], at: [0, 0.59, -0.25] },
    ...[[-0.22, 0.14], [-0.08, 0.2], [0.06, 0.11], [0.2, 0.17]].map(([x, h]) => ({
      size: [0.045, h, 0.045],
      at: [x, 0.36 - h / 2, -0.29],
    })),
  ])
}

export const createSnowMaterial = () =>
  new MeshLambertMaterial({ color: '#ffffff', emissive: '#cfe9ff', emissiveIntensity: 0.4 })

/**
 * The chairs' shared material: Phong, with each instance's finish (DATA chair
 * `finish`, see FINISHES in layout.js) read from a per-instance `aFinish` attribute:
 * x scales the specular highlight (metal gleams, wood is dull), y lights the chair
 * from within (neon, gems). One material and one draw call for every finish.
 */
export function createChairMaterial() {
  const material = new MeshPhongMaterial({ color: '#ffffff', specular: '#ffffff', shininess: 46 })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aFinish;\nvarying vec2 vFinish;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFinish = aFinish;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFinish;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vFinish.y;',
      )
      .replace(
        '#include <lights_phong_fragment>',
        '#include <lights_phong_fragment>\nmaterial.specularStrength *= vFinish.x;',
      )
  }
  return material
}

/** Gives a geometry its per-instance finish attribute, for `count` instances. */
export function addFinishAttribute(geometry, count) {
  geometry.setAttribute('aFinish', new InstancedBufferAttribute(new Float32Array(count * 2), 2))
  return geometry
}

/** Writes chair `chair`'s finish into instance `i` of every geometry given. */
export function setFinish(geometries, i, chair) {
  const { shine, glow } = finishOf(chair)
  for (const g of geometries) {
    const a = g.getAttribute('aFinish')
    a.setXY(i, shine, glow)
    a.needsUpdate = true
  }
}
