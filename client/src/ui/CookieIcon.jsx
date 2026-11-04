import { useId } from 'react'

import { RARITY_COLORS } from '../game/layout'

/** `hex` moved `t` (0..1) of the way towards `to` (both '#rrggbb'). */
function mix(hex, to, t) {
  const a = parseInt(hex.slice(1), 16)
  const b = parseInt(to.slice(1), 16)
  const ch = (shift) => Math.round(((a >> shift) & 255) + ((((b >> shift) & 255) - ((a >> shift) & 255)) * t))
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`
}

/** Deterministic 0..1 noise, so an icon looks the same on every render. */
const hash = (a, b) => {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return v - Math.floor(v)
}

const OUTLINE = '#2a1608'
const C = 32

/** Points spread over the cookie's face: [x, y, angle] (a jittered golden-angle spiral). */
function spots(count, seed, maxR = 19) {
  return Array.from({ length: count }, (_, i) => {
    const r = maxR * Math.sqrt((i + 0.5) / count) * (0.85 + hash(i, seed) * 0.3)
    const a = i * 2.39996 + hash(seed, i)
    return [C + Math.cos(a) * r, C + Math.sin(a) * r, (hash(i + 3, seed) * 180) | 0]
  })
}

/**
 * A cookie drawn in SVG for the shop, the inventory and the duel cards, from the
 * same DATA.cookies entry as the 3D one: its dough with a baked rim, and its
 * chips, sprinkles, glaze, gems, lava cracks or (sandwich cookies) the cream
 * peeking out. Glowing cookies glow. Plain markup: no textures, no 3D preview.
 */
export function CookieIcon({ cookie, className = 'size-16' }) {
  const id = useId().replace(/:/g, '')
  const { dough, style, toppings = [], glaze, cream, glow } = cookie
  const seed = cookie.id.length * 7
  const rim = mix(dough, '#000000', 0.28)
  const centre = mix(dough, '#ffffff', 0.18)
  const glowColor = RARITY_COLORS[cookie.rarity]
  const filter = glow ? { filter: `drop-shadow(0 0 0.3rem ${glowColor})` } : undefined

  return (
    <svg viewBox="0 0 64 64" className={className} style={filter} aria-hidden="true">
      <defs>
        <radialGradient id={`d${id}`} cx="0.42" cy="0.38" r="0.62">
          <stop offset="0" stopColor={centre} />
          <stop offset="0.72" stopColor={dough} />
          <stop offset="1" stopColor={rim} />
        </radialGradient>
      </defs>
      {style === 'sandwich' && (
        <circle cx={C} cy={C + 3} r="27" fill={mix(dough, '#000000', 0.2)} stroke={OUTLINE} strokeWidth="1.6" />
      )}
      {style === 'sandwich' && <ellipse cx={C} cy={C + 1.8} rx="28.5" ry="27" fill={cream} stroke={OUTLINE} strokeWidth="1.4" />}
      <circle cx={C} cy={C} r="27" fill={`url(#d${id})`} stroke={OUTLINE} strokeWidth="1.8" />
      {style === 'glaze' && (
        <path
          d={Array.from({ length: 25 }, (_, i) => {
            const a = (i / 24) * Math.PI * 2
            const r = 21 + Math.sin(a * 5) * 1.6 + Math.sin(a * 11) * 0.9
            return `${i ? 'L' : 'M'}${(C + Math.cos(a) * r).toFixed(1)} ${(C + Math.sin(a) * r).toFixed(1)}`
          }).join(' ') + 'Z'}
          fill={glaze}
          opacity="0.95"
        />
      )}
      {style === 'chips' &&
        spots(9, seed).map(([x, y, a], i) => (
          <rect
            key={i}
            x={x - 3}
            y={y - 2.4}
            width="6"
            height="4.8"
            rx="1.6"
            fill={toppings[i % toppings.length]}
            transform={`rotate(${a} ${x} ${y})`}
          />
        ))}
      {(style === 'sprinkles' || (style === 'glaze' && toppings.length > 0)) &&
        spots(style === 'glaze' ? 10 : 16, seed + 1, 18).map(([x, y, a], i) => (
          <rect
            key={i}
            x={x - 3}
            y={y - 0.9}
            width="6"
            height="1.8"
            rx="0.9"
            fill={toppings[i % toppings.length]}
            transform={`rotate(${a} ${x} ${y})`}
          />
        ))}
      {style === 'gems' &&
        spots(7, seed + 2, 17).map(([x, y], i) => (
          <path
            key={i}
            d={`M${x} ${y - 4} L${x + 3.2} ${y} L${x} ${y + 4} L${x - 3.2} ${y} Z`}
            fill={toppings[i % toppings.length]}
            stroke="#ffffff"
            strokeWidth="0.6"
          />
        ))}
      {style === 'lava' &&
        Array.from({ length: 6 }, (_, i) => {
          const a = (i / 6) * Math.PI * 2 + hash(i, 1) * 0.6
          const r0 = 6 + hash(i, 2) * 4
          const r1 = 16 + hash(i, 3) * 6
          return (
            <path
              key={i}
              d={`M${C + Math.cos(a) * r0} ${C + Math.sin(a) * r0} L${C + Math.cos(a + 0.25) * ((r0 + r1) / 2)} ${C + Math.sin(a + 0.25) * ((r0 + r1) / 2)} L${C + Math.cos(a) * r1} ${C + Math.sin(a) * r1}`}
              stroke={toppings[i % toppings.length]}
              strokeWidth="2.2"
              strokeLinecap="round"
              fill="none"
            />
          )
        })}
      {/* A soft highlight on the top left of the dough. */}
      <ellipse cx="22" cy="19" rx="9" ry="5" fill="#ffffff" opacity="0.18" transform="rotate(-30 22 19)" />
    </svg>
  )
}

export default CookieIcon
