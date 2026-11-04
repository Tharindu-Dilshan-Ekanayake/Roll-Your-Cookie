/**
 * The scene's whole look in one place: an island floating above the clouds at
 * sunset. A violet sky glowing orange at the horizon, lavender flagstones, brass
 * railings and gears, and warm low sunlight.
 *
 * Colours are sRGB hex, exactly as you would pick them in an image editor.
 *
 * Light intensities are three.js physical units: a light of intensity PI (~3.14)
 * lights a surface facing it to its full texture colour. The hemisphere fill plus the
 * sun add up to just over that on the ground; shadowed ground only gets the fill, so
 * shadows read as a softer, cooler violet.
 */

export const SKY = {
  /** Straight up: deep dusk violet. */
  top: '#3d2c8d',
  /** At eye level: a warm sunset glow. Fog uses the same colour so distant things melt into the sky. */
  horizon: '#ffc29a',
  /** Lower = the violet reaches further down towards the horizon. */
  exponent: 0.55,
}

/** Haze at the horizon. Distances scale with the quality preset's view distance. */
export const FOG = {
  color: SKY.horizon,
  /** Fraction of the view distance where the haze starts. */
  nearFraction: 0.3,
}

export const CLOUDS = {
  /** Sunlit tops, warm from the low sun. */
  top: '#fff4ea',
  /** Undersides, a soft lavender. */
  bottom: '#d5bfe9',
  count: 18,
}

/** The sea of clouds far below the island; the fog blends it into the sky. */
export const CLOUD_SEA = {
  base: '#f1dcf2',
  puff: '#fff7f0',
  y: -32,
}

/** The island's flagstones, two shades of lavender stone. */
export const GROUND = {
  base: '#a9a2c6',
  alt: '#9d96bb',
}

/** The island's rocky underside: a stone band at the top, darker towards the tip. */
export const ROCK = {
  rim: '#857da3',
  mid: '#6b5d86',
  deep: '#43375c',
}

export const BRASS = {
  rail: '#e2ad45',
  post: '#4a4560',
  gear: '#d9a441',
}

export const LIGHTS = {
  /** Fill from above (warm sky) and below (bounce off the lavender stone). */
  hemiSky: '#fff0e0',
  hemiGround: '#8a76b0',
  hemiIntensity: 2.0,

  sunColor: '#ffd9a6',
  sunIntensity: 1.8,
  /**
   * Direction *towards* the sun: high and a little to the left, behind the default
   * camera, so the side of the character you look at is lit and its shadow falls
   * beside it where you can see it, not hidden behind its back.
   */
  sunDirection: [-0.35, 0.9, 0.2],
  /** 1 = shadows get no sunlight at all; lower = lighter shadows. */
  shadowIntensity: 0.8,
  /** Blur radius of shadow edges, in shadow-map texels. */
  shadowSoftness: 4,
}
