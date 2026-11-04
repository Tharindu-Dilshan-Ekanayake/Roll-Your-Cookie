import { useEffect, useState } from 'react'
import { CanvasTexture, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three'

import { fontReady, GAME_FONT } from './labels'
import { DATA, GUIDE_BOARD } from './layout'
import { GUIDE } from './lobby'
import { useDisposable } from './useDisposable'

// Same aspect as the board, inside the 512 px mobile texture budget.
const TEX_W = 512
const TEX_H = Math.round((TEX_W * GUIDE.height) / GUIDE.width)

const STEPS = [
  ['☠️', 'Poison cups for your opponent'],
  ['🍪', 'Tap DROP to roll your cookie down'],
  ['🥛', 'Milk = safe! Poison = lose a ❤️'],
  ['🏆', `Last cookie standing wins $${DATA.winReward}!`],
]

function drawBoard(canvas) {
  const ctx = canvas.getContext('2d')
  const bg = ctx.createLinearGradient(0, 0, 0, TEX_H)
  bg.addColorStop(0, '#3a2a6e')
  bg.addColorStop(1, '#22184a')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, TEX_W, TEX_H)

  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.textAlign = 'center'
  ctx.font = `700 46px ${GAME_FONT}`
  ctx.lineWidth = 8
  ctx.strokeStyle = '#120a2a'
  ctx.strokeText('HOW TO PLAY', TEX_W / 2, 42)
  ctx.fillStyle = '#ffcf4a'
  ctx.fillText('HOW TO PLAY', TEX_W / 2, 42)

  const top = 92
  const rowH = (TEX_H - top - 48) / STEPS.length
  STEPS.forEach(([icon, text], i) => {
    const y = top + rowH * (i + 0.5)
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.12)'
    ctx.fillRect(16, y - rowH / 2 + 3, TEX_W - 32, rowH - 6)
    ctx.textAlign = 'center'
    ctx.font = `700 30px ${GAME_FONT}`
    ctx.fillStyle = '#ffffff'
    ctx.fillText(icon, 50, y)
    ctx.textAlign = 'left'
    ctx.font = `700 25px ${GAME_FONT}`
    ctx.lineWidth = 5
    ctx.strokeText(text, 84, y)
    ctx.fillText(text, 84, y)
  })

  ctx.textAlign = 'center'
  ctx.font = `700 22px ${GAME_FONT}`
  ctx.fillStyle = '#ffe36b'
  ctx.fillText(`🥛 Every dunk in the milk = +$${DATA.duel.milkBonus}!`, TEX_W / 2, TEX_H - 26)
}

/** The "how to play" sign by the entrance: one quad, one 512 px canvas texture. */
export function GuideBoard() {
  const [drawn, setDrawn] = useState(false)
  const res = useDisposable(() => {
    const canvas = document.createElement('canvas')
    canvas.width = TEX_W
    canvas.height = TEX_H
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = 4
    return {
      texture,
      geometry: new PlaneGeometry(GUIDE.width, GUIDE.height),
      material: new MeshBasicMaterial({ map: texture }),
    }
  }, [])

  // Drawn once the game font is in, in idle time so it never competes with loading.
  useEffect(() => {
    let cancelled = false
    const draw = () => {
      if (cancelled) return
      drawBoard(res.texture.image)
      res.texture.needsUpdate = true
      setDrawn(true)
    }
    fontReady.then(() =>
      window.requestIdleCallback ? window.requestIdleCallback(draw, { timeout: 1500 }) : setTimeout(draw, 50),
    )
    return () => {
      cancelled = true
    }
  }, [res])

  return (
    <group position={[GUIDE_BOARD.x, 0, GUIDE_BOARD.z]} rotation={[0, GUIDE_BOARD.ry, 0]}>
      <mesh geometry={res.geometry} material={res.material} position={[0, GUIDE.y, 0.04]} visible={drawn} />
    </group>
  )
}

export default GuideBoard
