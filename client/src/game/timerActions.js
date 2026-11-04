import { sfx } from '../audio/sfx'
import { send } from '../net/api'
import { useGame } from '../net/gameStore'
import { actionFx, SELF_ANCHOR } from '../net/liveState'

/** Can the local player stop their clock right now? */
export function canPress(state = useGame.getState(), now = Date.now()) {
  const { match, localPress } = state
  if (!match || match.pressed || localPress?.round === match.round) return false
  // The server may not have said "running" yet when the clock has already started.
  return match.phase === 'running' || (match.phase === 'target' && now >= match.startAt)
}

/**
 * Stops the local player's clock: the STOP button, Space, or a tap on their button
 * on the table. Sends what their clock read (the server checks it against its own
 * time) and shows the press at once. Returns true if it did something.
 */
export function pressStop() {
  const state = useGame.getState()
  const now = Date.now()
  if (!canPress(state, now)) return false
  const { match } = state
  const ms = Math.max(0, now - match.startAt)
  sfx.press()
  useGame.setState({ localPress: { round: match.round, ms } })
  // The hand slams the button straight away; the server's echo won't restart it.
  actionFx.set(SELF_ANCHOR, { ...actionFx.get(SELF_ANCHOR), press: now })
  send({ t: 'press', ms })
  return true
}
