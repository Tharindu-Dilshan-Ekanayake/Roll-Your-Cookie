import { useId } from 'react'

/** `hex` moved `t` (0..1) of the way towards `to` (both '#rrggbb'). */
function mix(hex, to, t) {
  const a = parseInt(hex.slice(1), 16)
  const b = parseInt(to.slice(1), 16)
  const ch = (shift) => Math.round(((a >> shift) & 255) + ((((b >> shift) & 255) - ((a >> shift) & 255)) * t))
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`
}

const OUTLINE = '#15161c'

/**
 * A chair drawn in SVG for the shop and inventory: its colour, its finish (metal
 * shines in bands, gems sparkle, neon glows, frost fades to white, wood shows grain)
 * and its style (a throne's crest and armrests, a snow chair's snow and icicles).
 * Plain markup: no textures, no 3D preview to render.
 */
export function ChairIcon({ chair, className = 'size-16' }) {
  const id = useId().replace(/:/g, '')
  const { color, finish, style } = chair
  const throne = style === 'throne'
  const snow = style === 'snow'
  const cushion = mix(color, '#ffffff', 0.45)

  let fill = color
  let defs = null
  if (finish === 'metal' || finish === 'gem' || finish === 'frost') {
    const stops =
      finish === 'metal'
        ? [[0, mix(color, '#ffffff', 0.6)], [0.35, color], [0.55, mix(color, '#000000', 0.3)], [0.75, color], [1, mix(color, '#ffffff', 0.3)]]
        : finish === 'gem'
          ? [[0, mix(color, '#ffffff', 0.5)], [0.5, color], [1, mix(color, '#000000', 0.4)]]
          : [[0, '#ffffff'], [0.6, color], [1, mix(color, '#000000', 0.15)]]
    defs = (
      <linearGradient id={`g${id}`} x1="0" y1="0" x2={finish === 'gem' ? '1' : '0.3'} y2="1">
        {stops.map(([o, c]) => (
          <stop key={o} offset={o} stopColor={c} />
        ))}
      </linearGradient>
    )
    fill = `url(#g${id})`
  }
  const part = { fill, stroke: OUTLINE, strokeWidth: 1.6, strokeLinejoin: 'round' }
  const glow = finish === 'glow' ? { filter: `drop-shadow(0 0 0.35rem ${color})` } : undefined

  return (
    <svg viewBox="0 0 64 64" className={className} style={glow} aria-hidden="true">
      {defs && <defs>{defs}</defs>}
      {throne && (
        <>
          <polygon points="15,15 19,4 25,10 32,1 39,10 45,4 49,15" {...part} />
          <circle cx="32" cy="7.5" r="3" fill="#ffffff" stroke={OUTLINE} strokeWidth="1.2" />
        </>
      )}
      {/* Back: posts, top rail and slats. */}
      <rect x="14" y="14" width="6" height="29" rx="1.5" {...part} />
      <rect x="44" y="14" width="6" height="29" rx="1.5" {...part} />
      <rect x="12" y="13" width="40" height="8" rx="3" {...part} />
      {[24, 30, 36].map((x) => (
        <rect key={x} x={x} y="21" width="4" height="13" {...part} />
      ))}
      {throne && (
        <>
          <rect x="5" y="28" width="11" height="4" rx="1.5" {...part} />
          <rect x="48" y="28" width="11" height="4" rx="1.5" {...part} />
        </>
      )}
      {/* Seat, its cushion and the legs. */}
      <rect x="13" y="43" width="5" height="17" rx="1" {...part} />
      <rect x="46" y="43" width="5" height="17" rx="1" {...part} />
      <rect x="10" y="37" width="44" height="7" rx="2" {...part} />
      <rect x="12" y="33" width="40" height="5" rx="2" fill={cushion} stroke={OUTLINE} strokeWidth="1.6" />
      {finish === 'wood' && (
        <g stroke={mix(color, '#000000', 0.35)} strokeWidth="1" strokeLinecap="round">
          <line x1="15" y1="40" x2="30" y2="40" />
          <line x1="34" y1="41.5" x2="50" y2="41.5" />
          <line x1="18" y1="16" x2="28" y2="16" />
        </g>
      )}
      {finish === 'gem' && (
        <path d="M44 22 l1.4 3.2 3.2 1.4 -3.2 1.4 -1.4 3.2 -1.4 -3.2 -3.2 -1.4 3.2 -1.4 z" fill="#ffffff" />
      )}
      {snow && (
        <g fill="#ffffff" stroke="#9fc9e6" strokeWidth="1">
          <path d="M11 14 q4 -6 10 -2 q5 -4 11 0 q6 -5 12 -1 q5 -3 9 3 z" />
          <path d="M10 37 q11 -4 22 -1 q11 -3 22 1 z" />
          {[20, 28, 36, 44].map((x, i) => (
            <polygon key={x} points={`${x - 1.6},44 ${x + 1.6},44 ${x},${49 + (i % 2) * 3}`} />
          ))}
        </g>
      )}
    </svg>
  )
}

export default ChairIcon
