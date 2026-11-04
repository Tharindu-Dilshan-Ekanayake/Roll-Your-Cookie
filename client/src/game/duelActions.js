import { aimAt } from '../../../shared/plinko.mjs'
import { sfx } from '../audio/sfx'
import { send } from '../net/api'
import { useGame } from '../net/gameStore'
import { actionFx, SELF_ANCHOR } from '../net/liveState'
import { predictRoll } from './rolls'

/**
 * What the local player does in a duel: pick the cups to poison (tapping a cup on
 * the table or its button), lock them in, and drop the cookie (the DROP button,
 * Space, or a tap on the board). Each shows at once and tells the server, which
 * has the last word.
 */

/** The cups you've picked this round (your draft, or what the server has). */
export function currentTraps(state = useGame.getState()) {
  const { match, trapDraft } = state
  if (!match) return []
  return trapDraft?.round === match.round ? trapDraft.cups : match.myTraps
}

/** Poisons `cup` (or takes the poison back out). Past the limit, the oldest pick moves. */
export function toggleTrap(cup) {
  const state = useGame.getState()
  const { match } = state
  if (!match || match.phase !== 'poison') return
  const current = currentTraps(state)
  let cups
  if (current.includes(cup)) {
    cups = current.filter((c) => c !== cup)
    sfx.untrap()
  } else {
    cups = current.length < match.poisons ? [...current, cup] : [...current.slice(1), cup]
    sfx.trap()
  }
  useGame.setState({ trapDraft: { round: match.round, cups } })
  send({ t: 'traps', cups, ready: false })
}

/** Locks your poison in (once you've picked enough cups). */
export function lockTraps() {
  const state = useGame.getState()
  const { match } = state
  if (!match || match.phase !== 'poison') return false
  const cups = currentTraps(state)
  if (cups.length !== match.poisons) return false
  sfx.ready()
  send({ t: 'traps', cups, ready: true })
  return true
}

const dropKey = (m) => `${m.table}:${m.round}:${m.turn}`

/** Can the local player drop their cookie right now? */
export function canDrop(state = useGame.getState()) {
  const { match, localDrop } = state
  return Boolean(match && match.phase === 'aim' && match.turn === match.seat && localDrop !== dropKey(match))
}

/**
 * Lets go of the cookie where the launcher is now. It starts falling straight
 * away (see rolls.predictRoll); the server's seed takes over at the first peg.
 */
export function dropCookie() {
  const state = useGame.getState()
  if (!canDrop(state)) return false
  const { match, profile } = state
  const aim = aimAt(Date.now() - match.aimStart, match.round)
  useGame.setState({ localDrop: dropKey(match) })
  predictRoll(match.table, match.seat, profile?.equippedCookie || 'classic', aim)
  // The hand flicks forward straight away; the server's echo won't restart it.
  actionFx.set(SELF_ANCHOR, { ...actionFx.get(SELF_ANCHOR), press: Date.now() })
  send({ t: 'drop', aim })
  return true
}
