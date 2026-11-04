import { useProgress } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'

import DATA from '../../../shared/gameData.json'
import CookieIcon from './CookieIcon'

const TIPS = [
  '☠️ Poison the cups you think your opponent will hit',
  '🍪 Tap DROP when the cookie is over a cup you trust',
  '🥛 Milk is safe… and pays a little bonus!',
  '😈 The end cups and the middle catch the most cookies',
  '❤️ Last cookie with hearts left wins the duel',
  '🛒 The cookie you equip is the one you roll!',
  '🎁 Open a free mystery gift every 10 minutes',
  '🔥 Win in a row against players for streak bonuses',
]
const COVER = DATA.cookies.find((c) => c.id === 'galaxy') || DATA.cookies[0]

/**
 * Covers the screen until the game is completely ready to play: the world drawn
 * with the player's avatar in it, every shader compiled and the player's profile
 * in from the game server. Then it all appears at once: nothing pops in later.
 *
 * It never talks about servers or connections: only a cookie, a bar and tips.
 * While it waits on the server (a cold start can take a while) the bar keeps
 * creeping, so it never looks stuck.
 *
 * @param {{ stages: { avatar: boolean, shaders: boolean, scene: boolean, profile: boolean } }} props
 */
export function LoadingScreen({ stages }) {
  const { progress: assets } = useProgress()
  const [tip, setTip] = useState(() => Math.floor(Math.random() * TIPS.length))
  const [creep, setCreep] = useState(0)
  const since = useRef(0)

  useEffect(() => {
    const id = setInterval(() => setTip((t) => (t + 1) % TIPS.length), 2600)
    return () => clearInterval(id)
  }, [])

  // Waiting only on the server: ease the last stretch of the bar towards 98%.
  const waiting = stages.scene && !stages.profile
  useEffect(() => {
    if (!waiting) return undefined
    since.current = performance.now()
    const id = setInterval(() => setCreep(1 - Math.exp(-(performance.now() - since.current) / 9000)), 200)
    return () => clearInterval(id)
  }, [waiting])

  let progress = assets * 0.45 + (stages.avatar ? 15 : 0) + (stages.shaders ? 15 : 0) + (stages.profile ? 25 : 0)
  if (waiting) progress += 23 * creep
  progress = Math.min(stages.scene && stages.profile ? 100 : 98, Math.max(6, progress))

  return (
    <div className="loading-bg absolute inset-0 z-[70] flex flex-col items-center justify-center gap-5 px-6">
      <div className="cookie-bounce">
        <CookieIcon cookie={COVER} className="cookie-spin size-28" />
      </div>
      <h1 className="stroke-text text-center text-[3.4rem] font-bold leading-none text-white">{DATA.title}</h1>
      <p className="stroke-thin text-center text-xl font-bold text-white">{DATA.tagline}</p>
      <div className="h-5 w-[min(80vw,26rem)] overflow-hidden rounded-full border-4 border-black bg-black/30">
        <div
          className="h-full bg-gradient-to-r from-[#ffcf4a] via-[#ff9a3d] to-[#ff6f9f] transition-[width] duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p key={tip} className="stroke-thin pop-in text-center text-lg font-bold text-white/95">
        {TIPS[tip]}
      </p>
    </div>
  )
}

export default LoadingScreen
