import { useGame } from '../net/gameStore'
import { retryConnection } from '../net/api'

/**
 * Short server messages (purchases, errors, rewards). Connecting, waking up and
 * reconnecting happen quietly in the background; the only connection message a
 * player ever sees is "Couldn't reach the game server" with a Retry button, once
 * the game has given up and they need to act.
 */
export function Toasts() {
  const toasts = useGame((s) => s.toasts)
  const status = useGame((s) => s.status)
  return (
    <div className="pointer-events-none absolute left-1/2 top-[20%] z-60 flex -translate-x-1/2 flex-col items-center gap-1.5">
      {status === 'failed' && (
        <div className="ui-panel pointer-events-auto flex items-center gap-3 px-4 py-2 text-base font-bold text-white">
          Couldn&apos;t reach the game server
          <button
            type="button"
            onClick={retryConnection}
            className="btn-3d press bg-gradient-to-b from-[#5dff5d] to-[#22c522] px-3 py-1 text-sm"
          >
            <span className="stroke-thin">Retry</span>
          </button>
        </div>
      )}
      {toasts.map((t) => (
        <div key={t.id} className="ui-panel pop-in px-4 py-1.5 text-center text-base font-bold text-white">
          {t.text}
        </div>
      ))}
    </div>
  )
}

export default Toasts
