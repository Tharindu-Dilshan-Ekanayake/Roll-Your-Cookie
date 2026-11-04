import { lazy, Suspense, useCallback, useEffect, useState } from 'react'

import { platform, setAdScreen, usePlatform } from './bloxity/platform'
import { isPlayingPhase, useGame } from './net/gameStore'
import { renderStats } from './net/liveState'
import { useConnection } from './net/useConnection'
import AwayPrompt from './ui/AwayPrompt'
import HUD from './ui/HUD'
import InteractPrompt from './ui/InteractPrompt'
import LoadingScreen from './ui/LoadingScreen'
import MatchUI from './ui/MatchUI'
import Toasts from './ui/Toasts'
import { useTouch } from './ui/touch'
import TouchControls from './ui/TouchControls'

// The 3D scene (three, R3F, the world) is its own chunk so the loading screen paints
// first; the menus aren't needed until the player opens one.
const GameScene = lazy(() => import('./game/GameScene'))
const Modals = lazy(() => import('./ui/Modals'))

/** Bloxity's "Show FPS" setting. */
function FpsReadout() {
  const [fps, setFps] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setFps(renderStats.fps), 500)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="pointer-events-none absolute bottom-2 left-1/2 z-50 -translate-x-1/2 rounded bg-black/50 px-2 py-0.5 font-mono text-xs text-white">
      {fps} FPS
    </div>
  )
}

/**
 * Tells Bloxity which screen is showing so it can place banners around it:
 * a menu panel, the pre-duel wait/countdown ('lobby') or a duel result.
 */
function useAdScreens() {
  const modal = useGame((s) => s.modal)
  const phase = useGame((s) => s.match?.phase)
  const result = useGame((s) => s.result)
  useEffect(() => {
    if (modal) setAdScreen('panel')
    else if (result || phase === 'ended') setAdScreen('results')
    else if (phase === 'waiting' || phase === 'countdown') setAdScreen('lobby')
    else if (isPlayingPhase(phase)) setAdScreen('gameplay')
    else setAdScreen(null)
  }, [modal, phase, result])
}

/** Esc closes an open menu; otherwise, inside Bloxity, it opens Bloxity's menu. */
function useEscapeMenu() {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || useGame.getState().modal) return
      if (usePlatform.getState().embedded) platform.showMenu()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/**
 * If the game server still hasn't answered this long after the world is ready (a
 * very cold start), show the world anyway: the connection carries on quietly in the
 * background and the HUD appears the moment the profile arrives.
 */
const MAX_SERVER_WAIT_MS = 45000

/** What the Bloxity loading overlay says at each stage: playful, never technical. */
const LOADING_STEPS = {
  start: 'Preheating the oven…',
  avatar: 'Baking cookies…',
  shaders: 'Pouring the milk…',
  scene: 'Hiding the poison…',
}

/**
 * The loading screen stays until everything is ready: the scene drawn with the
 * player's avatar, every shader compiled, and the player's profile in from the
 * game server. Returns the stages, and whether to show the game.
 */
function useLoading() {
  const [stages, setStages] = useState({ avatar: false, shaders: false, scene: false })
  const profile = useGame((s) => Boolean(s.profile))
  const [waitedLong, setWaitedLong] = useState(false)
  const onProgress = useCallback((stage) => {
    setStages((s) => (s[stage] ? s : { ...s, [stage]: true }))
    platform.loadingStep(LOADING_STEPS[stage] || LOADING_STEPS.start)
  }, [])
  const onReady = useCallback(() => onProgress('scene'), [onProgress])

  useEffect(() => {
    platform.loadingStep(LOADING_STEPS.start)
  }, [])
  useEffect(() => {
    if (!stages.scene || profile) return undefined
    const id = setTimeout(() => setWaitedLong(true), MAX_SERVER_WAIT_MS)
    return () => clearTimeout(id)
  }, [stages.scene, profile])

  const ready = stages.scene && (profile || waitedLong)
  useEffect(() => {
    if (!ready) return
    platform.loadingEnd()
    platform.gameplayStart()
  }, [ready])
  return { stages: { ...stages, profile }, ready, onReady, onProgress }
}

function App() {
  useConnection()
  useAdScreens()
  useEscapeMenu()
  const { stages, ready, onReady, onProgress } = useLoading()
  const modal = useGame((s) => s.modal)
  const showFps = usePlatform((s) => s.showFps)
  const touch = useTouch((s) => s.touch)

  return (
    <div className="relative h-dvh w-screen select-none overflow-hidden bg-[#ffc29a] font-game">
      <Suspense fallback={null}>
        <GameScene onReady={onReady} onProgress={onProgress} />
      </Suspense>

      <HUD />
      <MatchUI />
      <InteractPrompt />
      <Toasts />
      <AwayPrompt />
      {touch && <TouchControls />}
      {showFps && <FpsReadout />}
      {modal && (
        <Suspense fallback={null}>
          <Modals />
        </Suspense>
      )}
      {!ready && <LoadingScreen stages={stages} />}
    </div>
  )
}

export default App
