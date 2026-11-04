import { PerformanceMonitor } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Frustum, Matrix4, NearestFilter } from 'three'

import { usePlatform } from '../bloxity/platform'
import { renderStats } from '../net/liveState'
import CookieInstances from './CookieInstances'
import { CullingSystem } from './culling'
import Effects from './Effects'
import FollowCamera from './FollowCamera'
import Halos from './Halos'
import Lighting from './Lighting'
import Player from './Player'
import { useQuality, useSettings } from './quality'
import RemotePlayers from './RemotePlayers'
import { FOG, SKY } from './sceneStyle'
import Sky from './Sky'
import World from './World'

/** How long to wait for the browser to restore a lost WebGL context before rebuilding. */
const CONTEXT_RESTORE_TIMEOUT_MS = 4000

/**
 * Fires `onFirstFrame` after the renderer has actually drawn once.
 * The loading screen should end on "the player can see the game", not "React mounted".
 */
function FirstFrameSignal({ onFirstFrame }) {
  const fired = useRef(false)
  useFrame(() => {
    if (fired.current) return
    fired.current = true
    onFirstFrame()
  })
  return null
}

/** Approximate GPU bytes for every texture the scene references (mips add a third). */
function measureTextures(scene) {
  const seen = new Set()
  let bytes = 0
  scene.traverse((o) => {
    const materials = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []
    for (const m of materials) {
      const t = m.map
      if (!t?.image || seen.has(t)) continue
      seen.add(t)
      const mips = t.generateMipmaps && t.minFilter !== NearestFilter ? 4 / 3 : 1
      bytes += t.image.width * t.image.height * 4 * mips
    }
  })
  return { count: seen.size, bytes }
}

/**
 * Dev only: roughly what each draw call is, grouped by kind: every drawable that
 * is visible (with all its ancestors) and on screen (or not frustum culled).
 */
function drawBreakdown(scene, camera) {
  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  )
  const groups = {}
  const shown = (o) => {
    for (let p = o; p; p = p.parent) if (!p.visible) return false
    return true
  }
  scene.traverse((o) => {
    if (!(o.isMesh || o.isSprite || o.isPoints || o.isLine) || !shown(o)) return
    if (o.isInstancedMesh && o.count === 0) return
    if (o.frustumCulled && !o.isInstancedMesh && !frustum.intersectsObject(o)) return
    const key = o.isSkinnedMesh ? 'avatar (skinned)' : o.isSprite ? 'label sprite' : o.isInstancedMesh ? `instanced ${o.geometry.type}` : `mesh ${o.geometry.type}`
    groups[key] = (groups[key] || 0) + 1
  })
  return Object.entries(groups).sort((a, b) => b[1] - a[1])
}

/**
 * Copies renderer counters into liveState for the perf readout and automated checks,
 * and exposes `window.__textureMemory()` for on-demand texture budget checks.
 */
function RenderStats() {
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const frames = useRef({ count: 0, since: 0 })
  useEffect(() => {
    window.__textureMemory = () => measureTextures(scene)
    if (import.meta.env.DEV) window.__drawBreakdown = () => drawBreakdown(scene, camera)
    return () => {
      delete window.__textureMemory
      delete window.__drawBreakdown
    }
  }, [scene, camera])
  useFrame(({ gl }) => {
    // Read before this frame renders: these are the previous frame's totals.
    renderStats.calls = gl.info.render.calls
    renderStats.triangles = gl.info.render.triangles
    renderStats.textures = gl.info.memory.textures
    renderStats.geometries = gl.info.memory.geometries
    const f = frames.current
    f.count += 1
    const now = performance.now()
    if (!f.since) f.since = now
    if (now - f.since >= 1000) {
      renderStats.fps = Math.round((f.count * 1000) / (now - f.since))
      f.count = 0
      f.since = now
    }
  })
  return null
}

/** Horizontal field of view kept on portrait screens, in degrees. */
const PORTRAIT_HFOV = 56
const LANDSCAPE_VFOV = 60
const MAX_VFOV = 88

/**
 * On a portrait screen a fixed vertical FOV leaves a very narrow view sideways;
 * widen it so roughly the same width of the world stays in frame.
 */
function ResponsiveFov() {
  const camera = useThree((s) => s.camera)
  const aspect = useThree((s) => s.size.width / s.size.height)
  useEffect(() => {
    const fov =
      aspect >= 1
        ? LANDSCAPE_VFOV
        : Math.min(MAX_VFOV, (2 * Math.atan(Math.tan((PORTRAIT_HFOV * Math.PI) / 360) / aspect) * 180) / Math.PI)
    camera.fov = fov
    camera.updateProjectionMatrix()
  }, [camera, aspect])
  return null
}

/**
 * Compiles every material in the scene, including hidden objects, using the
 * browser's parallel shader compilation where available, then calls `onDone`.
 * Waits two frames first so freshly mounted objects are in the scene.
 */
function ShaderWarmup({ onDone }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    let cancelled = false
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        const compiled = gl.compileAsync ? gl.compileAsync(scene, camera) : Promise.resolve()
        compiled
          .catch(() => {})
          .then(() => {
            if (!cancelled) onDone()
          })
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [gl, scene, camera, onDone])
  return null
}

/** Keeps camera far plane and fog in step with the preset's view distance. */
function ViewDistance({ distance }) {
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    camera.far = distance + 100
    camera.updateProjectionMatrix()
    if (scene.fog) {
      scene.fog.near = distance * FOG.nearFraction
      scene.fog.far = distance
    }
  }, [camera, scene, distance])
  return null
}

/**
 * The 3D world. Everything in it (the island, all fifteen tables, the shops, the
 * leaderboards, every cookie) mounts at once behind the loading screen and has its
 * shaders compiled there (ShaderWarmup), so once the game shows nothing pops in and
 * nothing stutters. `onReady` fires when the scene has drawn with the player's
 * avatar in it and every shader is compiled; App lifts the loading screen once the
 * game server has sent the player's profile too.
 *
 * @param {{ onReady?: () => void, onProgress?: (stage: string) => void }} props
 */
export function GameScene({ onReady, onProgress }) {
  // Bloxity ad break: stop simulating and rendering until it ends.
  const paused = usePlatform((s) => s.paused)
  const settings = useSettings()
  const drop = useQuality((s) => s.drop)

  const [avatarReady, setAvatarReady] = useState(false)
  const [warm, setWarm] = useState(false)
  const [drawn, setDrawn] = useState(false)
  const readied = useRef(false)
  const [contextLost, setContextLost] = useState(false)
  const [canvasKey, setCanvasKey] = useState(0)

  const handleAvatarReady = useCallback(() => setAvatarReady(true), [])
  const handleWarm = useCallback(() => setWarm(true), [])
  const handleFirstFrame = useCallback(() => setDrawn(true), [])

  useEffect(() => {
    if (avatarReady) onProgress?.('avatar')
  }, [avatarReady, onProgress])
  useEffect(() => {
    if (warm) onProgress?.('shaders')
  }, [warm, onProgress])

  useEffect(() => {
    if (readied.current || !avatarReady || !warm || !drawn) return
    readied.current = true
    onReady?.()
  }, [avatarReady, warm, drawn, onReady])

  // If the browser doesn't hand the context back, remount the canvas from scratch.
  useEffect(() => {
    if (!contextLost) return undefined
    const id = setTimeout(() => {
      setContextLost(false)
      setCanvasKey((k) => k + 1)
    }, CONTEXT_RESTORE_TIMEOUT_MS)
    return () => clearTimeout(id)
  }, [contextLost])

  const onCreated = useCallback(({ gl }) => {
    gl.setClearColor(SKY.horizon)
    // Checking every program's link status blocks on the GPU driver per shader;
    // without it, programs compile in parallel. Errors still surface in dev.
    gl.debug.checkShaderErrors = import.meta.env.DEV
    const canvas = gl.domElement
    canvas.addEventListener('webglcontextlost', (e) => {
      // preventDefault tells the browser we intend to restore the context.
      e.preventDefault()
      setContextLost(true)
    })
    canvas.addEventListener('webglcontextrestored', () => setContextLost(false))
  }, [])

  return (
    <>
      <Canvas
        frameloop={paused ? 'never' : 'always'}
        key={canvasKey}
        // PCF, not R3F's default "soft": three r18x removed PCFSoftShadowMap.
        shadows={settings.shadows ? 'percentage' : false}
        dpr={settings.dpr}
        // No tone mapping: keeps the lime grass and blue sky saturated.
        flat
        // Antialiasing is fixed when the WebGL context is created; every preset uses it.
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ position: [0, 6, 38], fov: 60, far: settings.viewDistance + 100 }}
        onCreated={onCreated}
      >
        <PerformanceMonitor onDecline={drop} bounds={() => [45, 1000]} flipflops={4} />
        <fog attach="fog" args={[FOG.color, settings.viewDistance * FOG.nearFraction, settings.viewDistance]} />
        <ViewDistance distance={settings.viewDistance} />
        <ResponsiveFov />
        <Sky clouds="on" />
        <Lighting />

        <Suspense fallback={null}>
          <World />
          <Player onAvatarReady={handleAvatarReady} />
          <RemotePlayers />
        </Suspense>
        <CookieInstances />
        <Halos />

        {settings.particles && <Effects />}
        <FollowCamera />
        <CullingSystem />
        {/* After the avatar is in, so its shaders compile behind the loading screen too. */}
        {avatarReady && !warm && <ShaderWarmup onDone={handleWarm} />}
        <RenderStats />
        <FirstFrameSignal onFirstFrame={handleFirstFrame} />
      </Canvas>

      {/* While the browser hands the graphics back (rare, mostly on phones), the
          screen just dims for a moment: no message to read. */}
      {contextLost && <div className="pointer-events-none absolute inset-0 z-50 bg-[#2b1a4d]/70" />}
    </>
  )
}

export default GameScene
