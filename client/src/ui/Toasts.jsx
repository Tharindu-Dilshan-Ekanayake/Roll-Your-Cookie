import { useGame } from '../net/gameStore'

/**
 * Short server messages: purchases, errors, rewards. Never anything about the
 * connection: connecting, a server waking up and reconnecting all happen quietly
 * (see net/socket.js), so the player never has to read about them.
 */
export function Toasts() {
  const toasts = useGame((s) => s.toasts)
  return (
    <div className="pointer-events-none absolute left-1/2 top-[20%] z-60 flex -translate-x-1/2 flex-col items-center gap-1.5">
      {toasts.map((t) => (
        <div key={t.id} className="ui-panel pop-in px-4 py-1.5 text-center text-base font-bold text-white">
          {t.text}
        </div>
      ))}
    </div>
  )
}

export default Toasts
