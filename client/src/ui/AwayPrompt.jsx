import { sfx } from '../audio/sfx'
import { DATA } from '../game/layout'
import { comeBack, imHere } from '../net/api'
import { useGame } from '../net/gameStore'
import { useNow } from './format'

/**
 * Lobbies are for playing: a player who does nothing at all for a while is moved
 * out so their place goes to someone else (see GameRoom.checkAway).
 *
 *  - First, "Still there?" with a countdown: any input (or the button) keeps them in.
 *  - Then, if they really were away, "Welcome back!" with one button that puts them
 *    straight into the fullest lobby with room. Their cash and cookies are saved.
 */
export function AwayPrompt() {
  const warnUntil = useGame((s) => s.awayWarnUntil)
  const away = useGame((s) => s.away)
  const now = useNow(250)

  if (away) {
    return (
      <div className="pointer-events-auto absolute inset-0 z-[65] flex items-center justify-center bg-[#1b1030]/70">
        <div className="ui-panel pop-in flex w-[min(90vw,24rem)] flex-col items-center gap-3 px-5 py-5 text-center">
          <div className="text-[3rem] leading-none">💤🍪</div>
          <h2 className="stroke-text text-[1.8rem] font-bold leading-tight text-white">Welcome back!</h2>
          <p className="text-sm font-semibold leading-snug text-white/85">
            You were away for a while, so your spot went to another player. Your cash and cookies are saved.
          </p>
          <button
            type="button"
            autoFocus
            onClick={() => {
              sfx.click()
              comeBack()
            }}
            className="btn-3d press mt-1 w-full bg-gradient-to-b from-[#7dff7a] via-[#2fd14f] to-[#169a3a] px-4 py-2.5 text-2xl font-bold text-white"
          >
            <span className="stroke-text">🍪 PLAY AGAIN</span>
          </button>
        </div>
      </div>
    )
  }

  if (!warnUntil || warnUntil < now) return null
  const left = Math.max(1, Math.ceil((warnUntil - now) / 1000))
  return (
    <div className="pointer-events-none absolute left-1/2 top-[38%] z-[65] -translate-x-1/2">
      <div className="ui-panel pop-in pointer-events-auto flex w-[min(90vw,22rem)] flex-col items-center gap-2 px-4 py-3 text-center">
        <div className="stroke-text text-2xl font-bold text-white">👋 Still there?</div>
        <p className="text-sm font-semibold leading-snug text-white/85">
          Move or tap within <span className="font-bold text-[#ffe23d]">{left}s</span> to keep your spot. After{' '}
          {Math.round(DATA.afk.kickSec / 60 * 10) / 10} min away it goes to someone who wants to play.
        </p>
        <button
          type="button"
          onClick={() => {
            sfx.click()
            imHere()
          }}
          className="btn-3d press w-full bg-gradient-to-b from-[#ffe45c] to-[#f2b200] px-4 py-2 text-xl font-bold text-white"
        >
          <span className="stroke-text">✋ I&apos;M HERE!</span>
        </button>
      </div>
    </div>
  )
}

export default AwayPrompt
