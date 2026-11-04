import { useEffect } from 'react'

import { sfx } from '../audio/sfx'
import { canDrop, currentTraps, dropCookie, lockTraps, toggleTrap } from '../game/duelActions'
import { cookieById, DATA, emoteById, poisonKind, titleById } from '../game/layout'
import { botsAllowed, isPlayingPhase, useGame } from '../net/gameStore'
import { bubbles } from '../net/liveState'
import { send } from '../net/api'
import CookieIcon from './CookieIcon'
import { money, useNow } from './format'
import { useTouch } from './touch'

const secondsLeft = (endsAt, now) => Math.max(0, Math.ceil((endsAt - now) / 1000))
/** How long the "MILK!" / "POISONED!" popup stays after a cookie lands. */
const LANDING_MS = 1700

/**
 * Big centre text (countdown, result), below the duel bar and above the board.
 * `top` is its own prop: two `top-*` classes on one element would fight.
 */
function Banner({ children, top = 'top-[30%]' }) {
  return (
    <div className={`pointer-events-none absolute left-1/2 z-30 w-[92vw] -translate-x-1/2 text-center ${top}`}>
      {children}
    </div>
  )
}

/** While you wait alone at a table: a bot sits down opposite, right now. */
function VsBotButton() {
  const allowed = useGame(botsAllowed)
  if (!allowed) return null
  return (
    <button
      type="button"
      onClick={() => {
        sfx.click()
        send({ t: 'bot' })
      }}
      className="btn-3d press pointer-events-auto bg-gradient-to-b from-[#c49bff] via-[#8a5cff] to-[#5b2fd8] px-4 py-1.5 text-base font-bold text-white"
    >
      <span className="stroke-thin">🤖 PLAY VS BOT</span>
    </button>
  )
}

/** Under "Waiting for an opponent": a bot in a quiet lobby, patience in a busy one. */
function WaitingHint() {
  const allowed = useGame(botsAllowed)
  return (
    <span className="stroke-thin text-center text-base font-bold text-white/90">
      {allowed ? 'Nobody coming? Play a bot instead!' : 'Lots of players around: someone will join you soon!'}
    </span>
  )
}

/** Leaves the table; mid-duel (`forfeit`) it asks first, in the QuitDialog. */
function LeaveButton({ label = 'Leave', forfeit = false }) {
  return (
    <button
      type="button"
      onClick={() => {
        sfx.click()
        if (forfeit) useGame.setState({ quitAsk: true })
        else send({ t: 'leave' })
      }}
      className="btn-3d press pointer-events-auto bg-gradient-to-b from-[#ff5a5a] to-[#d81f1f] px-4 py-1.5 text-base font-bold text-white"
    >
      <span className="stroke-thin">{label}</span>
    </button>
  )
}

/**
 * "Quit the duel?" in the middle of the screen, in the game's own style (not the
 * browser's confirm box). Quitting is a loss: you pay up to DATA.forfeit.penalty to
 * your opponent. Esc or a tap outside keeps playing.
 */
function QuitDialog() {
  const cash = useGame((s) => s.profile?.cash ?? 0)
  const vsBot = useGame((s) => Boolean(s.match?.vsBot))
  const pay = vsBot ? 0 : Math.min(DATA.forfeit.penalty, cash)
  const stay = () => {
    sfx.click()
    useGame.setState({ quitAsk: false })
  }
  const quit = () => {
    sfx.click()
    useGame.setState({ quitAsk: false })
    send({ t: 'leave' })
  }

  useEffect(() => {
    // Captured first, so Esc only closes this (and doesn't also open Bloxity's menu).
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      useGame.setState({ quitAsk: false })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <div className="pointer-events-auto absolute inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={stay}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quit-title"
        onClick={(e) => e.stopPropagation()}
        className="ui-panel pop-in flex w-[min(90vw,24rem)] flex-col items-center gap-3 px-5 py-4 text-center"
      >
        <div className="text-[2.8rem] leading-none">🏃💨</div>
        <h2 id="quit-title" className="stroke-text text-[1.7rem] font-bold leading-tight text-white">
          Quit the duel?
        </h2>
        <p className="text-sm font-semibold leading-snug text-white/85">
          Quitting counts as a loss and your opponent wins the prize
          {pay > 0 && (
            <>
              {' '}
              <span className="font-bold text-[#ff8a8a]">plus {money(pay)} of your cash</span>
            </>
          )}
          .
        </p>
        <div className="mt-1 flex w-full gap-2">
          <button
            type="button"
            autoFocus
            onClick={stay}
            className="btn-3d press flex-1 bg-gradient-to-b from-[#5dff5d] to-[#22c522] px-2 py-2 text-base font-bold text-white"
          >
            <span className="stroke-thin">KEEP PLAYING</span>
          </button>
          <button
            type="button"
            onClick={quit}
            className="btn-3d press flex-1 bg-gradient-to-b from-[#ff5a5a] to-[#d81f1f] px-2 py-2 text-base font-bold text-white"
          >
            <span className="stroke-thin">QUIT{pay > 0 ? ` −${money(pay)}` : ''}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

/** ❤️ ❤️ 🖤: hearts left out of the duel's DATA.duel.hearts. */
function Hearts({ hearts, max, className = '' }) {
  return (
    <span className={`flex gap-0.5 ${className}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`heart ${i < hearts ? '' : 'heart-lost'}`}>
          {i < hearts ? '❤️' : '🖤'}
        </span>
      ))}
    </span>
  )
}

/** What a duelist last said (an emote, "Yum! 🥛", "Gotcha! 😈"), while it lasts. */
function speechOf(id, now) {
  const b = id ? bubbles.get(id) : null
  return b && b.text && b.until > now ? b.text : null
}

/** What a seat is doing right now, as a little chip on its card. */
function statusOf(match, seat) {
  if (match.phase === 'poison') return match.ready[seat] ? ['✅ READY', 'chip-green'] : ['☠️ POISONING…', 'chip-dark']
  if ((match.phase === 'aim' || match.phase === 'rolling') && match.turn === seat) {
    return match.phase === 'aim' ? ['🍪 AIMING…', 'chip-gold'] : ['🍪 ROLLING…', 'chip-gold']
  }
  return null
}

/**
 * One side of the duel bar: the cookie they roll, title, name, hearts, what they're
 * doing and a speech bubble underneath. Seat 0 is on the left, as on the board.
 */
function DuelistCard({ player, isSelf, bot, cookie, hearts, max, status, speech, align, hurt }) {
  const title = titleById(player?.title)
  const left = align === 'left'
  return (
    <div className={`flex min-w-0 flex-1 flex-col gap-1.5 ${left ? 'items-start' : 'items-end'}`}>
      <div
        className={`ui-panel flex w-full min-w-0 items-center gap-2 px-2 py-1 ${left ? '' : 'flex-row-reverse'} ${
          hurt ? 'shake' : ''
        } ${isSelf ? 'card-self' : ''}`}
      >
        <CookieIcon cookie={cookieById(cookie)} className="size-10 shrink-0" />
        <div className={`flex min-w-0 flex-1 flex-col ${left ? 'items-start text-left' : 'items-end text-right'}`}>
          {title && (
            <span
              className={`max-w-full truncate text-[0.65rem] font-bold leading-tight ${title.rainbow ? 'rainbow-text' : ''}`}
              style={title.rainbow ? undefined : { color: title.color }}
            >
              {title.name}
            </span>
          )}
          <span className={`stroke-thin flex max-w-full items-center gap-1 text-base font-bold leading-tight text-white ${left ? '' : 'flex-row-reverse'}`}>
            <span className="truncate">{player?.name || '…'}</span>
            {isSelf && <span className="shrink-0 rounded bg-[#2a6bff] px-1 text-[0.6rem]">YOU</span>}
            {bot && <span className="shrink-0 rounded bg-[#6b7280] px-1 text-[0.6rem]">BOT 🤖</span>}
          </span>
          <Hearts hearts={hearts} max={max} className={`mt-0.5 ${left ? '' : 'flex-row-reverse'}`} />
        </div>
      </div>
      {status && (
        <span className={`chip stroke-thin pop-in ${status[1]}`} key={status[0]}>
          {status[0]}
        </span>
      )}
      {speech && (
        <div
          key={speech}
          className={`speech pop-in max-w-full rounded-xl border-2 border-black/70 bg-white px-2 py-0.5 text-sm font-bold leading-snug text-[#1d2433] ${
            left ? 'speech-left' : 'speech-right'
          }`}
        >
          {speech}
        </div>
      )}
    </div>
  )
}

/** Top of the screen during a duel: seat 0 | the round | seat 1, as they stand at the board. */
function DuelBar({ match, now }) {
  const selfId = useGame((s) => s.selfId)
  const profile = useGame((s) => s.profile)
  const table = useGame((s) => s.tables[match.table])
  const them = useGame((s) => (match.opponent ? s.players[match.opponent] : null))
  const landing = useGame((s) => s.landing)
  const self = { name: profile?.name || 'You', title: profile?.equippedTitle }
  const recentHurt = landing && landing.table === match.table && landing.hurt && now - landing.at < 600 ? landing.seat : -1

  const card = (seat) => {
    const mine = seat === match.seat
    return (
      <DuelistCard
        key={seat}
        player={mine ? self : them}
        isSelf={mine}
        bot={!mine && match.vsBot}
        cookie={mine ? profile?.equippedCookie : table?.seats[seat]?.cookie}
        hearts={match.hearts[seat]}
        max={match.maxHearts}
        status={statusOf(match, seat)}
        speech={speechOf(mine ? selfId : match.opponent, now)}
        align={seat === 0 ? 'left' : 'right'}
        hurt={recentHurt === seat}
      />
    )
  }

  return (
    <div className="hud-top pointer-events-none absolute left-1/2 z-40 flex w-[min(96vw,40rem)] -translate-x-1/2 items-start gap-2">
      {card(0)}
      <div className="flex shrink-0 flex-col items-center gap-1 pt-0.5">
        <div className="btn-3d flex h-12 min-w-12 items-center justify-center bg-[#8a4f2a] px-2 text-xl font-bold text-white">
          <span className="stroke-thin">{match.phase === 'countdown' ? 'VS' : `R${match.round}`}</span>
        </div>
        {match.phase !== 'countdown' && (
          <span className="stroke-thin whitespace-nowrap rounded-md bg-black/45 px-1.5 text-[0.7rem] font-bold text-white">
            ☠️ ×{match.poisons}
          </span>
        )}
      </div>
      {card(1)}
    </div>
  )
}

/** Under the duel bar: what to do now, and how long is left. */
function PhaseBanner({ match, now }) {
  const theirName = useGame((s) => (match.opponent && s.players[match.opponent]?.name) || 'Your opponent')
  const traps = useGame((s) => currentTraps(s))
  const left = secondsLeft(match.endsAt, now)
  let title = null
  let sub = null
  if (match.phase === 'poison') {
    const ready = match.ready[match.seat]
    title = ready ? '✅ POISON SET!' : `☠️ POISON ${match.poisons} CUPS!`
    sub = ready
      ? `Waiting for ${theirName}… ${left}s`
      : `${traps.length}/${match.poisons} picked · ${left}s · their cookie rolls into these!`
  } else if (match.phase === 'aim') {
    if (match.turn === match.seat) {
      title = '🍪 YOUR TURN!'
      sub = `Tap DROP when it's over a safe cup · ${left}s`
    } else {
      title = `${theirName} is aiming… 😈`
      sub = 'Your poison is in the coloured cups'
    }
  } else if (match.phase === 'rolling') {
    title = match.turn === match.seat ? '🍪 Rolling… come on, milk!' : '🍪 Rolling… come on, poison!'
  }
  if (!title) return null
  return (
    <div className="timer-pos pointer-events-none absolute left-1/2 z-30 w-[min(92vw,28rem)] -translate-x-1/2">
      <div key={`${match.phase}:${match.turn}`} className="ui-panel slam flex flex-col items-center px-3 py-1">
        <span className="stroke-text text-center text-xl font-bold leading-tight text-white">{title}</span>
        {sub && <span className="stroke-thin text-center text-xs font-bold text-white/90">{sub}</span>}
      </div>
    </div>
  )
}

/** The seven cups, as buttons along the bottom, while you poison them (or tap the cups). */
function CupPicker({ match }) {
  const traps = useGame((s) => currentTraps(s))
  const touch = useTouch((s) => s.touch)
  const ready = match.ready[match.seat]
  const full = traps.length === match.poisons

  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat || useGame.getState().quitAsk) return
      const n = Number(e.key)
      if (n >= 1 && n <= DATA.duel.cups) toggleTrap(n - 1)
      else if (e.code === 'Enter' && lockTraps()) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="cup-pos pointer-events-none absolute left-1/2 z-40 flex w-[min(98vw,46rem)] -translate-x-1/2 flex-col items-center gap-2">
      <div className="flex w-full gap-1 sm:gap-1.5">
        {Array.from({ length: DATA.duel.cups }, (_, c) => {
          const k = traps.indexOf(c)
          const kind = k >= 0 ? poisonKind(k) : null
          return (
            <button
              key={c}
              type="button"
              onClick={() => toggleTrap(c)}
              className={`cup-btn btn-3d press pointer-events-auto flex min-w-0 flex-1 flex-col items-center justify-center px-0.5 font-bold text-white ${
                kind ? 'cup-poison' : 'cup-milk'
              }`}
              style={kind ? { '--poison': kind.color } : undefined}
            >
              <span className="text-[1.15rem] leading-none">{kind ? kind.icon : '🥛'}</span>
              <span className="stroke-thin w-full truncate text-center text-[0.7rem] leading-tight sm:text-sm">
                {kind ? kind.name : `Cup ${c + 1}`}
              </span>
            </button>
          )
        })}
      </div>
      <button
        type="button"
        disabled={!full || ready}
        onClick={lockTraps}
        className={`btn-3d press pointer-events-auto px-6 py-2 text-xl font-bold text-white ${
          ready ? 'bg-[#3b3e45]' : full ? 'bg-gradient-to-b from-[#5dff5d] to-[#22c522] lock-pulse' : 'bg-[#5b6270]'
        }`}
      >
        <span className="stroke-text">
          {ready ? '✅ LOCKED IN' : full ? `LOCK IN ✅${touch ? '' : ' (Enter)'}` : `Pick ${match.poisons - traps.length} more`}
        </span>
      </button>
    </div>
  )
}

/** The big DROP button (also Space / Enter) while it's your turn. */
function DropButton() {
  const touch = useTouch((s) => s.touch)
  const live = useGame((s) => canDrop(s))

  useEffect(() => {
    const onKey = (e) => {
      if ((e.code !== 'Space' && e.code !== 'Enter') || e.repeat) return
      if (useGame.getState().quitAsk) return
      if (dropCookie()) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="drop-pos pointer-events-none absolute z-40 flex flex-col items-center gap-1">
      <button
        type="button"
        disabled={!live}
        onPointerDown={(e) => {
          // On pointer down, not click: aiming is all about timing.
          e.preventDefault()
          dropCookie()
        }}
        className={`drop-button press pointer-events-auto flex flex-col items-center justify-center rounded-full border-[5px] border-black font-bold text-white ${
          live ? 'drop-live' : 'drop-done'
        }`}
      >
        <span className="text-[1.6rem] leading-none">🍪</span>
        <span className="stroke-text text-[1.7rem] leading-none">DROP!</span>
      </button>
      {!touch && live && (
        <span className="stroke-thin rounded-md bg-black/45 px-2 text-xs font-bold text-white">or press SPACE</span>
      )}
    </div>
  )
}

/** "MILK! Safe" / "POISONED! −1 ❤️" / "GOTCHA!", the moment a cookie lands at your table. */
function LandingPopup({ match }) {
  const landing = useGame((s) => s.landing)
  const theirName = useGame((s) => (match.opponent && s.players[match.opponent]?.name) || 'They')
  const now = useNow(200)
  if (!landing || landing.table !== match.table || now - landing.at > LANDING_MS) return null
  const mine = landing.seat === match.seat
  const kind = landing.hurt ? poisonKind(landing.kind) : null
  let big
  let small
  let color
  if (mine && kind) {
    big = `${kind.icon} ${kind.name.toUpperCase()}!`
    small = 'Bleh! −1 ❤️'
    color = '#ff5a5a'
  } else if (mine) {
    big = '🥛 MILK!'
    small = match.vsBot || !DATA.duel.milkBonus ? 'Safe! Yum!' : `Safe! +${money(DATA.duel.milkBonus)}`
    color = '#ffffff'
  } else if (kind) {
    big = '😈 GOTCHA!'
    small = `${theirName} drank your ${kind.name}! −1 ❤️`
    color = '#ffe23d'
  } else {
    big = '😤 Dodged it…'
    small = `${theirName} hit the milk`
    color = '#cfe3ff'
  }
  return (
    <Banner top="top-[36%]">
      <div key={landing.at} className="slam flex flex-col items-center">
        <div className="stroke-text text-[3.2rem] font-bold leading-none" style={{ color }}>
          {big}
        </div>
        <div className="stroke-text mt-1 text-2xl font-bold text-white">{small}</div>
      </div>
    </Banner>
  )
}

/**
 * A soft glow round the screen's edges when your cookie lands in poison (green) or
 * you win (gold): a fade in and out, never a hard full-screen flash.
 */
function ScreenFlash() {
  const flash = useGame((s) => s.flash)
  useEffect(() => {
    if (!flash) return undefined
    const id = setTimeout(() => useGame.setState({ flash: null }), Math.max(0, flash.until - Date.now()))
    return () => clearTimeout(id)
  }, [flash])
  if (!flash) return null
  return (
    <div
      key={flash.at}
      className={`pointer-events-none absolute inset-0 z-[45] ${flash.kind === 'poison' ? 'flash-poison' : 'flash-golden'}`}
      style={{ animationDelay: `${flash.delay || 0}ms` }}
    />
  )
}

/** Quick phrases bought in the shop, said in a bubble over your head. */
function EmotePanel({ hiddenInPortrait }) {
  const owned = useGame((s) => s.profile?.ownedEmotes) || []
  const isOpen = useGame((s) => s.emotesOpen)
  const toggle = useGame((s) => s.toggleEmotes)

  return (
    <div
      className={`pointer-events-none absolute bottom-3 left-3 z-40 flex flex-col items-start gap-2 ${
        hiddenInPortrait ? 'portrait:hidden' : ''
      }`}
    >
      {isOpen && (
        <div className="ui-panel pop-in pointer-events-auto w-[15rem] p-2">
          <div className="game-scroll flex max-h-[min(30vh,14rem)] flex-col gap-1.5 overflow-y-auto pr-1">
            {owned.map((id) => {
              const e = emoteById(id)
              if (!e) return null
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    sfx.pop()
                    send({ t: 'emote', id })
                  }}
                  className="btn-3d press flex items-center justify-between bg-gradient-to-b from-[#fff35c] to-[#f2c200] px-2 py-1"
                >
                  <span className="stroke-thin truncate text-base font-bold text-white">
                    {e.label} {e.icon}
                  </span>
                  <span className="text-xs font-bold text-black/50">USE</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={toggle}
        className="btn-3d press pointer-events-auto bg-gradient-to-b from-[#3ee7ff] to-[#2a6bff] px-3 py-1.5 text-lg font-bold text-white"
      >
        <span className="stroke-text">Emotes 👀</span>
      </button>
    </div>
  )
}

const RESULT_TEXT = {
  win: { hearts: 'Last cookie standing!', forfeit: 'They quit the duel!', afk: 'They stopped playing 😴' },
  lose: { hearts: 'Your cookie got cooked', forfeit: 'You quit the duel', afk: 'You stopped playing' },
}

function ResultBanner() {
  const result = useGame((s) => s.result)
  const now = useNow(250)

  useEffect(() => {
    if (!result) return undefined
    const id = setTimeout(() => useGame.setState({ result: null }), Math.max(0, result.until - Date.now()))
    return () => clearTimeout(id)
  }, [result])

  if (!result || result.until < now) return null
  const reason = RESULT_TEXT[result.win ? 'win' : 'lose'][result.reason] || ''
  let reward = result.reward ? `+${money(result.reward)} ${result.win ? '💵' : 'for playing'}` : ''
  // A quitter's money changes hands: it is already in the winner's reward.
  if (result.penalty && result.win) reward = `+${money(result.reward)} 💵 (incl. their ${money(result.penalty)})`
  const lost = result.penalty && !result.win ? `−${money(result.penalty)}` : ''
  const title = result.win ? 'YOU WIN! 🏆' : result.reason === 'hearts' ? 'COOKED! 💀' : 'YOU LOSE 😭'

  return (
    <Banner top="top-[24%]">
      <div className="pop-in flex flex-col items-center">
        <div
          className={`stroke-text text-[3.4rem] font-bold leading-none ${result.win ? 'text-[#ffe23d]' : 'text-[#ff4040]'}`}
        >
          {title}
        </div>
        {result.reason === 'hearts' && (
          <div className="mt-2 flex items-center gap-3 text-2xl">
            <Hearts hearts={result.hearts[0]} max={DATA.duel.hearts} />
            <span className="stroke-text text-xl font-bold text-white">vs</span>
            <Hearts hearts={result.hearts[1]} max={DATA.duel.hearts} />
          </div>
        )}
        <div className="stroke-text mt-2 text-2xl font-bold text-white">
          {reason}
          {reward && <span className="text-[#5cff5c]">{`  ·  ${reward}`}</span>}
          {lost && <span className="text-[#ff6b6b]">{`  ·  ${lost}`}</span>}
        </div>
        {result.vsBot && (
          <div className="stroke-thin mt-1 text-sm font-bold text-white/80">Practice vs a bot: wins vs players count on the leaderboards!</div>
        )}
      </div>
    </Banner>
  )
}

/** Everything on screen while at a table: waiting, countdown, the duel. */
export function MatchUI() {
  const match = useGame((s) => s.match)
  const quitAsk = useGame((s) => s.quitAsk)
  const now = useNow(150)

  // A wood-block tick on each second of the "Starting in 3, 2, 1" countdown.
  const countdown = match?.phase === 'countdown' ? Math.max(1, secondsLeft(match.endsAt, now)) : 0
  useEffect(() => {
    if (countdown) sfx.tick()
  }, [countdown])
  // ...and on the last three seconds to drop.
  const myTurnLeft =
    match?.phase === 'aim' && match.turn === match.seat ? secondsLeft(match.endsAt, now) : 0
  useEffect(() => {
    if (myTurnLeft > 0 && myTurnLeft <= 3) sfx.tick()
  }, [myTurnLeft])

  const playing = isPlayingPhase(match?.phase)
  const myTurn = match?.phase === 'aim' && match.turn === match.seat

  return (
    <>
      <ScreenFlash />
      {match && <EmotePanel hiddenInPortrait={playing} />}
      {match && (match.phase === 'countdown' || playing) && <DuelBar match={match} now={now} />}

      {match?.phase === 'waiting' && (
        <div className="pointer-events-none absolute bottom-[16%] left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-2">
          <span className="stroke-text whitespace-nowrap text-2xl font-bold text-white">Waiting for an opponent… (1/2)</span>
          <WaitingHint />
          <div className="flex items-center gap-2">
            <VsBotButton />
            <LeaveButton />
          </div>
        </div>
      )}

      {match?.phase === 'countdown' && (
        <>
          <Banner>
            <span className="stroke-text text-[3.6rem] font-bold text-white">
              Starting in {Math.max(1, secondsLeft(match.endsAt, now))}
            </span>
          </Banner>
          <div className="pointer-events-none absolute bottom-[16%] left-1/2 z-30 -translate-x-1/2">
            <LeaveButton />
          </div>
        </>
      )}

      {playing && <PhaseBanner match={match} now={now} />}
      {match?.phase === 'poison' && <CupPicker match={match} />}
      {myTurn && <DropButton />}
      {match && <LandingPopup match={match} />}
      {playing && (
        <div className="pointer-events-none absolute bottom-3 right-3 z-40 portrait:bottom-auto portrait:top-[9.5rem]">
          <LeaveButton label="Quit duel" forfeit />
        </div>
      )}

      <ResultBanner />
      {quitAsk && playing && <QuitDialog />}
    </>
  )
}

export default MatchUI
