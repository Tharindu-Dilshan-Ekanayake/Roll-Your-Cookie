import { create } from 'zustand'

import { usePlatform } from '../bloxity/platform'

/**
 * Graphics presets. Every visual feature reads one of these values before it
 * renders anything; LOW is the floor for low-end phones.
 *
 * maxFullAvatars - remote players ON SCREEN drawn as their real avatar (one merged
 *                  body + one draw call per accessory), nearest first, within
 *                  fullAvatarDistance; the rest become one instanced crowd figure.
 */
export const PRESETS = {
  low: {
    dpr: 1,
    shadows: false,
    shadowMapSize: 0,
    particles: false,
    maxFullAvatars: 10,
    /** Draw calls the real avatars on screen may use together (body + each accessory). */
    avatarDrawCalls: 24,
    fullAvatarDistance: 45,
    /** Name tags drawn at once (nearest players on screen), and table signs (nearest tables). */
    maxNames: 6,
    maxTableSigns: 4,
    nameDistance: 26,
    labelDistance: 22,
    viewDistance: 140,
    clouds: 12,
    anisotropy: 4,
    blur: false,
  },
  medium: {
    dpr: [1, 1.5],
    shadows: true,
    shadowMapSize: 1024,
    particles: true,
    maxFullAvatars: 16,
    avatarDrawCalls: 44,
    fullAvatarDistance: 70,
    maxNames: 10,
    maxTableSigns: 6,
    nameDistance: 34,
    labelDistance: 30,
    viewDistance: 260,
    clouds: 12,
    anisotropy: 4,
    blur: false,
  },
  high: {
    dpr: [1, 2],
    shadows: true,
    shadowMapSize: 2048,
    particles: true,
    maxFullAvatars: 30,
    avatarDrawCalls: 60,
    fullAvatarDistance: 110,
    maxNames: 16,
    maxTableSigns: 8,
    nameDistance: 50,
    labelDistance: 38,
    viewDistance: 420,
    clouds: 18,
    anisotropy: 8,
    blur: true,
  },
}

const ORDER = ['low', 'medium', 'high']

/** Bloxity's graphics_quality setting ('Low' | 'Medium' | 'High' | 'Ultra'). */
const PLATFORM_PRESET = { Low: 'low', Medium: 'medium', High: 'high', Ultra: 'high' }

/**
 * Everyone starts on LOW. Bloxity's graphics_quality setting reports a value
 * straight away (its default is "High" for everyone), so only a change the player
 * makes in the Bloxity menu during the session moves the preset.
 */
export const useQuality = create((set, get) => ({
  preset: 'low',

  /** Called by <PerformanceMonitor> when FPS stays under 45. */
  drop: () => {
    const i = ORDER.indexOf(get().preset)
    if (i > 0) set({ preset: ORDER[i - 1] })
  },
}))

let platformSettingSeen = false
usePlatform.subscribe((s, prev) => {
  if (s.graphics === prev.graphics) return
  // The first value is the stored/default one, not a choice made now.
  if (!platformSettingSeen) {
    platformSettingSeen = true
    return
  }
  const preset = PLATFORM_PRESET[s.graphics]
  if (preset) useQuality.setState({ preset })
})

export const useSettings = () => PRESETS[useQuality((s) => s.preset)]
/** Non-reactive read for useFrame loops. */
export const getSettings = () => PRESETS[useQuality.getState().preset]
