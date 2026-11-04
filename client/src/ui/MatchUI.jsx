import { useEffect, useRef } from 'react'

import { sfx } from '../audio/sfx'
import { DATA, emoteById, TIMER, titleById } from '../game/layout'
import { canPress, pressStop } from '../game/timerActions'
import { isPlayingPhase, useGame } from '../net/gameStore'
import { bubbles } from '../net/liveState'
import { send } from '../net/api'
import { BLIND_READING, money, NO_READING, offBy, stopwatch, useNow } from './format'
import { useTouch } from './touch'

const secondsLeft = (endsAt, now) => Math.max(0, Math.ceil((endsAt - now) / 1000))
const NO_PRESS = -2

/**
 * Big centre text (countdown, result), below the duel bar and above the players' heads.
 * `top` is its own prop: two `top-*` classes on one element would fight.
 */
function Banner({ children, top = 'top-[30%]' }) {
  return (
    <div className={`pointer-events-none absolute left-1/2 z-30 w-[92vw] -translate-x-1/2 text-center ${top}`}>
      {children}
    </div>
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
  const pay = Math.min(DATA.forfeit.penalty, cash)
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

/** ● ● / ○ ○: rounds won, out of the DATA.timer.winsNeeded that win the duel. */
function ScorePips({ score, className = '' }) {
  return (
    <span className={`flex gap-1 ${className}`}>
      {Array.from({ length: TIMER.winsNeeded }, (_, i) => (
        <span
          key={i}
          className={`size-3.5 rounded-full border-2 border-black/70 ${i < score ? 'bg-[#ffd23d]' : 'bg-black/35'}`}
        />
      ))}
    </span>
  )
}

/** What a duelist last said (an emote, "STOP! ✋", "So close! 😬"), while it lasts. */
function speechOf(id, now) {
  const b = id ? bubbles.get(id) : null
  return b && b.text && b.until > now ? b.text : null
}

/** One side of the duel bar: title, name, rounds won, and a speech bubble underneath. */
function DuelistCard({ player, isSelf, score, stopped, speech, align }) {
  const title = titleById(player?.title)
  return (
    <div className={`flex min-w-0 flex-1 flex-col gap-1.5 ${align === 'left' ? 'items-start' : 'items-end'}`}>
      <div
        className={`ui-panel flex w-full min-w-0 flex-col px-2.5 py-1 ${
          align === 'left' ? 'items-start text-left' : 'items-end text-right'
        }`}
      >
        {title && (
          <span
            className={`max-w-full truncate text-[0.65rem] font-bold leading-tight ${title.rainbow ? 'rainbow-text' : ''}`}
            style={title.rainbow ? undefined : { color: title.color }}
          >
            {title.name}
          </span>
        )}
        <span className="stroke-thin flex max-w-full items-center gap-1 text-base font-bold leading-tight text-white">
          <span className="truncate">{player?.name || '…'}</span>
          {isSelf && <span className="shrink-0 rounded bg-[#2a6bff] px-1 text-[0.6rem]">YOU</span>}
        </span>
        <span className={`mt-1 flex items-center gap-1.5 ${align === 'left' ? '' : 'flex-row-reverse'}`}>
          <ScorePips score={score} />
          {stopped && (
            <span className="stroke-thin pop-in whitespace-nowrap rounded-full border-2 border-black/70 bg-gradient-to-b from-[#ff6b6b] to-[#d4182c] px-1.5 text-[0.65rem] font-bold leading-snug text-white">
              ✋ STOPPED
            </span>
          )}
        </span>
      </div>
      {speech && (
        <div
          key={speech}
          className={`speech pop-in max-w-full rounded-xl border-2 border-black/70 bg-white px-2 py-0.5 text-sm font-bold leading-snug text-[#1d2433] ${
            align === 'left' ? 'speech-left' : 'speech-right'
          }`}
        >
          {speech}
        </div>
      )}
    </div>
  )
}

/** Top of the screen during a duel: you | the round | your opponent. */
function DuelBar({ match, now }) {
  const selfId = useGame((s) => s.selfId)
  const profile = useGame((s) => s.profile)
  const localPress = useGame((s) => s.localPress)
  const them = useGame((s) => (match.opponent ? s.players[match.opponent] : null))
  const self = { name: profile?.name || 'You', title: profile?.equippedTitle }
  const running = match.phase === 'running'
  const iStopped = running && (match.pressed || localPress?.round === match.round)

  return (
    <div className="hud-top pointer-events-none absolute left-1/2 z-40 flex w-[min(94vw,36rem)] -translate-x-1/2 items-start gap-2">
      <DuelistCard
        player={self}
        isSelf
        score={match.myScore}
        stopped={iStopped}
        speech={speechOf(selfId, now)}
        align="left"
      />
      <div className="flex shrink-0 flex-col items-center gap-1 pt-0.5">
        <div className="btn-3d flex h-12 min-w-12 items-center justify-center bg-[#2d6b78] px-2 text-xl font-bold text-white">
          <span className="stroke-thin">{match.phase === 'countdown' ? 'VS' : `R${match.round}`}</span>
        </div>
        <span className="stroke-thin whitespace-nowrap rounded-md bg-black/45 px-1.5 text-[0.7rem] font-bold text-white">
          FIRST TO {TIMER.winsNeeded}
        </span>
      </div>
      <DuelistCard
        player={them}
        score={match.theirScore}
        stopped={running && match.theirPressed}
        speech={speechOf(match.opponent, now)}
        align="right"
      />
    </div>
  )
}

/**
 * The round's target, big, while it is announced. The clock starts as this card
 * leaves: it says how long the clock will show before it goes blind.
 */
function TargetCard({ match, now }) {
  const left = Math.max(1, secondsLeft(match.startAt, now))
  return (
    <div className="timer-pos pointer-events-none absolute left-1/2 z-30 -translate-x-1/2">
      <div key={match.round} className="ui-panel slam flex flex-col items-center gap-1 px-5 py-3">
        <span className="stroke-text text-2xl font-bold leading-none text-white">ROUND {match.round}</span>
        <span className="stroke-thin text-sm font-bold text-white/85">🎯 Stop your clock at</span>
        <span className="lcd lcd-amber">{stopwatch(match.target)}</span>
        <span className="stroke-thin text-center text-sm font-bold text-white">
          It shows for {(match.showMs / 1000).toFixed(match.showMs % 1000 ? 1 : 0)}s… then goes BLIND 🙈
        </span>
        <span className="stroke-text mt-1 text-xl font-bold text-[#ffcf4a]">Ready in {left}…</span>
      </div>
    </div>
  )
}

/**
 * The running clock, driven from its own animation frame loop (no React re-render
 * 60 times a second). With `displayRef` / `statusRef` it writes the reading straight
 * into the DOM: the time while it shows, then "??.???". With `sounds` it plays the
 * clock's sounds: a tick for each of the last seconds before it starts, a beep as it
 * starts and a whoosh as it goes blind.
 */
function useClock({ displayRef = null, statusRef = null, sounds = false }) {
  useEffect(() => {
    let raf = 0
    let lastKey = ''
    const heard = { round: -1, ticks: new Set(), started: false, blind: false }
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const { match, localPress, players } = useGame.getState()
      if (!match) return
      const now = Date.now()
      const elapsed = now - match.startAt
      if (heard.round !== match.round) {
        heard.round = match.round
        heard.ticks.clear()
        heard.started = false
        heard.blind = false
      }

      if (sounds && match.phase === 'target') {
        const s = Math.ceil(-elapsed / 1000)
        if (s >= 1 && s <= 2 && !heard.ticks.has(s)) {
          heard.ticks.add(s)
          sfx.tick()
        }
      }
      if (match.phase !== 'running' && match.phase !== 'target') return
      if (sounds && elapsed >= 0 && !heard.started) {
        heard.started = true
        sfx.beep()
      }
      const stopped = match.pressed || localPress?.round === match.round
      const blind = elapsed >= match.showMs
      if (sounds && blind && !heard.blind && elapsed < match.showMs + 500 && !stopped) {
        heard.blind = true
        sfx.blind()
      }

      let text
      let status
      let mode
      if (elapsed < 0) {
        text = stopwatch(0)
        status = 'Get ready…'
        mode = 'red'
      } else if (stopped) {
        text = NO_READING
        const name = (match.opponent && players[match.opponent]?.name) || 'your opponent'
        status = match.theirPressed ? '✋ Both stopped!' : `✋ Stopped! Waiting for ${name}…`
        mode = 'dim'
      } else if (!blind) {
        text = stopwatch(elapsed)
        status = '👀 Feel the speed…'
        mode = 'red'
      } else {
        text = BLIND_READING
        status = '🙈 BLIND! Count in your head…'
        mode = 'blind'
      }
      if (!displayRef) return
      const key = `${text}|${status}|${mode}`
      if (key === lastKey) return
      lastKey = key
      if (displayRef.current) {
        displayRef.current.textContent = text
        displayRef.current.className = `lcd lcd-${mode}`
      }
      if (statusRef.current) statusRef.current.textContent = status
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [displayRef, statusRef, sounds])
}

/** The clock's sounds, from the target's announcement until the round is revealed. */
function ClockSounds() {
  useClock({ sounds: true })
  return null
}

function ClockPanel({ match }) {
  const displayRef = useRef(null)
  const statusRef = useRef(null)
  useClock({ displayRef, statusRef })
  return (
    <div className="timer-pos pointer-events-none absolute left-1/2 z-30 -translate-x-1/2">
      <div className="ui-panel flex flex-col items-center gap-1 px-5 py-2.5">
        <span className="stroke-thin rounded-full bg-black/40 px-2 text-sm font-bold text-[#ffcf4a]">
          🎯 TARGET {stopwatch(match.target)}
        </span>
        <span ref={displayRef} className="lcd lcd-red">
          00.00
        </span>
        <span ref={statusRef} className="stroke-thin text-center text-sm font-bold text-white" />
      </div>
    </div>
  )
}

/** The big STOP button (also Space / Enter, or a tap on your button on the table). */
function StopButton({ match }) {
  const localPress = useGame((s) => s.localPress)
  const touch = useTouch((s) => s.touch)
  const now = useNow(100)
  const stopped = match.pressed || localPress?.round === match.round
  const live = canPress(useGame.getState(), now)

  useEffect(() => {
    const onKey = (e) => {
      if ((e.code !== 'Space' && e.code !== 'Enter') || e.repeat) return
      if (useGame.getState().quitAsk) return
      if (pressStop()) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="stop-pos pointer-events-none absolute left-1/2 z-40 flex -translate-x-1/2 flex-col items-center gap-1">
      <button
        type="button"
        disabled={!live}
        onPointerDown={(e) => {
          // On pointer down, not click: every millisecond counts.
          e.preventDefault()
          pressStop()
        }}
        className={`stop-button press pointer-events-auto flex flex-col items-center justify-center rounded-full border-[5px] border-black font-bold text-white ${
          stopped ? 'stop-done' : live ? 'stop-live' : 'stop-wait'
        }`}
      >
        <span className="stroke-text text-[2rem] leading-none">{stopped ? '✋' : 'STOP'}</span>
      </button>
      {!touch && !stopped && (
        <span className="stroke-thin rounded-md bg-black/45 px-2 text-xs font-bold text-white">or press SPACE</span>
      )}
    </div>
  )
}

/** One player's line in the round's reveal: their stop and how far off it was. */
function RevealRow({ name, time, target, won, isSelf }) {
  const pressed = time !== NO_PRESS && time >= 0
  const off = pressed ? time - target : 0
  const bullseye = pressed && Math.abs(off) <= TIMER.bullseyeMs
  return (
    <div
      className={`flex items-center gap-2 rounded-xl border-[3px] px-2.5 py-1 ${
        won ? 'border-[#3dff6a] bg-[#0f3d1c]' : 'border-black/50 bg-black/30'
      }`}
    >
      <span className="stroke-thin w-[6.5rem] truncate text-sm font-bold text-white">
        {isSelf ? 'You' : name}
      </span>
      <span className={`lcd lcd-small ${won ? 'lcd-green' : 'lcd-red'}`}>{pressed ? stopwatch(time) : NO_READING}</span>
      <span className={`stroke-thin w-[5.2rem] text-right text-sm font-bold ${won ? 'text-[#7dff9a]' : 'text-[#ff9a9a]'}`}>
        {pressed ? offBy(off) : 'TOO LATE'}
      </span>
      <span className="w-6 text-center text-lg leading-none">{bullseye ? '🎯' : won ? '✅' : ''}</span>
    </div>
  )
}

/** Both stops side by side, and who took the round. */
function RoundReveal({ match }) {
  const theirName = useGame((s) => (match.opponent && s.players[match.opponent]?.name) || 'Opponent')
  const mine = match.roundWinner === 'me'
  const myOff = match.myTime >= 0 ? Math.abs(match.myTime - match.target) : Infinity
  let headline = 'IT’S A TIE! 🤝'
  if (mine) headline = 'YOU TAKE THE ROUND! 😎'
  else if (match.roundWinner === 'them') headline = `${theirName.toUpperCase()} TAKES IT 😬`
  return (
    <div className="timer-pos pointer-events-none absolute left-1/2 z-30 -translate-x-1/2">
      <div className="ui-panel pop-in flex flex-col items-center gap-1.5 px-4 py-3">
        <span className="stroke-thin text-sm font-bold text-white/85">
          ROUND {match.round} · 🎯 {stopwatch(match.target)}
        </span>
        <RevealRow name="You" isSelf time={match.myTime} target={match.target} won={mine} />
        <RevealRow name={theirName} time={match.theirTime} target={match.target} won={match.roundWinner === 'them'} />
        <span
          key={match.round}
          className={`slam stroke-text mt-1 text-center text-[1.6rem] font-bold leading-tight ${
            mine ? 'text-[#7dff7a]' : match.roundWinner === 'them' ? 'text-[#ff6b6b]' : 'text-[#ffcf4a]'
          }`}
        >
          {headline}
        </span>
        <span className="stroke-text text-xl font-bold text-white">
          {match.myScore} - {match.theirScore}
        </span>
        {myOff <= TIMER.bullseyeMs && (
          <span className="stroke-text text-lg font-bold text-[#ffe23d]">🎯 BULLSEYE! +{money(TIMER.bullseyeCash)}</span>
        )}
      </div>
    </div>
  )
}

/**
 * A soft glow around the screen's edges when your button zaps you (electric blue) or
 * you hit a bullseye (gold): a fade in and out, never a hard full-screen flash.
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
      className={`pointer-events-none absolute inset-0 z-[45] ${flash.kind === 'zap' ? 'flash-zap' : 'flash-golden'}`}
      style={{ animationDelay: `${flash.delay || 0}ms` }}
    />
  )
}

/** Quick phrases bought in the Store, said in a bubble over your head. */
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
  win: { timer: 'Your timing was better!', forfeit: 'They quit the duel!', afk: 'They stopped pressing 😴' },
  lose: { timer: 'Their timing was better', forfeit: 'You quit the duel', afk: 'You stopped pressing' },
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
  const title = result.win ? 'YOU WIN! 🏆' : result.reason === 'timer' ? 'EJECTED! 🚀' : 'YOU LOSE 😭'

  return (
    <Banner top="top-[24%]">
      <div className="pop-in flex flex-col items-center">
        <div
          className={`stroke-text text-[3.4rem] font-bold leading-none ${result.win ? 'text-[#ffe23d]' : 'text-[#ff4040]'}`}
        >
          {title}
        </div>
        {result.reason === 'timer' && (
          <div className="stroke-text mt-1 text-3xl font-bold text-white">
            {result.score[0]} - {result.score[1]}
          </div>
        )}
        <div className="stroke-text mt-2 text-2xl font-bold text-white">
          {reason}
          {reward && <span className="text-[#5cff5c]">{`  ·  ${reward}`}</span>}
          {lost && <span className="text-[#ff6b6b]">{`  ·  ${lost}`}</span>}
        </div>
      </div>
    </Banner>
  )
}

/** Everything on screen while seated at a table: waiting, countdown, the duel. */
export function MatchUI() {
  const match = useGame((s) => s.match)
  const quitAsk = useGame((s) => s.quitAsk)
  const now = useNow(150)

  // A wood-block tick on each second of the "Starting in 3, 2, 1" countdown.
  const countdown = match?.phase === 'countdown' ? Math.max(1, secondsLeft(match.endsAt, now)) : 0
  useEffect(() => {
    if (countdown) sfx.tick()
  }, [countdown])

  const playing = isPlayingPhase(match?.phase)
  // The clock has started even if the server hasn't said "running" yet.
  const clockOn = match && (match.phase === 'running' || (match.phase === 'target' && now >= match.startAt))

  return (
    <>
      <ScreenFlash />
      {match && <EmotePanel hiddenInPortrait={playing} />}
      {match && (match.phase === 'countdown' || playing) && <DuelBar match={match} now={now} />}

      {match?.phase === 'waiting' && (
        <div className="pointer-events-none absolute bottom-[16%] left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-2">
          <span className="stroke-text whitespace-nowrap text-2xl font-bold text-white">Waiting for an opponent… (1/2)</span>
          <LeaveButton />
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

      {(match?.phase === 'target' || match?.phase === 'running') && <ClockSounds />}
      {match?.phase === 'target' && !clockOn && <TargetCard match={match} now={now} />}
      {clockOn && (
        <>
          <ClockPanel match={match} />
          <StopButton match={match} />
        </>
      )}
      {match?.phase === 'reveal' && <RoundReveal match={match} />}
      {playing && (
        <div className="pointer-events-none absolute bottom-3 right-3 z-40 portrait:bottom-auto portrait:top-[7.5rem]">
          <LeaveButton label="Quit duel" forfeit />
        </div>
      )}

      <ResultBanner />
      {quitAsk && playing && <QuitDialog />}
    </>
  )
}

export default MatchUI
