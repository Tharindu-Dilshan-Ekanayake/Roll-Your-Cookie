import { useCallback, useEffect, useState } from 'react'

import { sfx } from '../audio/sfx'
import { cookieById, INTERACTABLES } from '../game/layout'
import { useTouch } from './touch'
import { useGame } from '../net/gameStore'
import { localPlayer } from '../net/liveState'
import { send } from '../net/api'
import { money } from './format'

const POLL_MS = 150

function nearest() {
  const p = localPlayer.position
  let best = null
  let bestD = Infinity
  for (const it of INTERACTABLES) {
    const d = Math.hypot(it.x - p.x, it.z - p.z)
    if (d < it.range && d < bestD) {
      best = it
      bestD = d
    }
  }
  return best
}

/** What pressing E would do right now, or null. */
function describe(target, { tables, profile }) {
  if (!target) return null
  if (target.kind === 'table') {
    const t = tables[target.id]
    const free = !t || (t.phase === 'waiting' && t.seats.some((s) => !s))
    return free ? { label: 'Play', enabled: true } : { label: 'Table busy', enabled: false }
  }
  if (target.kind === 'cookie') {
    const cookie = cookieById(target.id)
    if (profile?.equippedCookie === cookie.id) return { label: `${cookie.name} equipped 🍪`, enabled: false }
    if (profile?.ownedCookies.includes(cookie.id)) return { label: `Equip ${cookie.name}`, enabled: true }
    return { label: `Buy ${cookie.name} (${money(cookie.price)})`, enabled: true }
  }
  return { label: 'Open the Cookie Shop 🛒', enabled: true }
}

function act(target) {
  const { profile, openModal } = useGame.getState()
  sfx.click()
  if (target.kind === 'table') send({ t: 'sit', table: target.id })
  else if (target.kind === 'store') openModal('shop', 'cookies')
  else if (target.kind === 'cookie') {
    if (profile?.ownedCookies.includes(target.id)) send({ t: 'equip', kind: 'cookie', id: target.id })
    else send({ t: 'buy', kind: 'cookie', id: target.id })
  }
}

/**
 * Proximity prompt: walk up to a table, a showroom cookie or the Cookie Shop's
 * counter and press E (or tap the prompt on touch screens).
 *
 * Proximity is polled on a timer, not computed in the render loop, so moving around
 * re-renders this component only when the nearest target actually changes.
 */
export function InteractPrompt() {
  const [target, setTarget] = useState(null)
  const seated = useGame((s) => Boolean(s.match))
  const modal = useGame((s) => s.modal)
  const tables = useGame((s) => s.tables)
  const profile = useGame((s) => s.profile)
  const online = useGame((s) => s.status === 'online')
  const isTouchDevice = useTouch((s) => s.touch)

  useEffect(() => {
    const id = setInterval(() => {
      const next = nearest()
      setTarget((prev) => (prev === next ? prev : next))
    }, POLL_MS)
    return () => clearInterval(id)
  }, [])

  const active = online && !seated && !modal ? target : null
  const info = describe(active, { tables, profile })

  const trigger = useCallback(() => {
    if (active && info?.enabled) act(active)
  }, [active, info])

  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'KeyE' && !e.repeat) trigger()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [trigger])

  // A bot is offered only once you've sat down at a table (see MatchUI), never here.
  if (!info) return null
  return (
    <button
      type="button"
      onClick={trigger}
      disabled={!info.enabled}
      className="press pop-in pointer-events-auto ui-panel absolute left-1/2 top-[60%] z-30 flex -translate-x-1/2 items-center gap-3 py-2 pl-2 pr-4 text-white portrait:top-[56%] disabled:opacity-70"
    >
      {!isTouchDevice && (
        <span className="flex size-9 items-center justify-center rounded-lg border-2 border-white/80 bg-white/10 text-lg font-bold">
          E
        </span>
      )}
      <span className="whitespace-nowrap text-lg font-bold">{isTouchDevice && info.enabled ? `Tap: ${info.label}` : info.label}</span>
    </button>
  )
}

export default InteractPrompt
