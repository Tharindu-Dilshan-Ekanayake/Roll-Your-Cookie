import { Callbacks, Client } from '@colyseus/sdk'

import { sfx } from '../audio/sfx'
import { boxityEnv } from '../bloxity/env'
import { loadEmoteCatalog, onPlatformEvent, platform } from '../bloxity/platform'
import { DATA, seatPosition, SPAWN } from '../game/layout'
import { getSettings } from '../game/quality'
import { clearRolls, startRoll } from '../game/rolls'
import { isPlayingPhase, useGame } from './gameStore'
import {
  actionFx,
  bubbles,
  effectQueue,
  localPlayer,
  pushRemote,
  remoteEmotes,
  remotes,
  remoteSeats,
  SELF_ANCHOR,
  setBubble,
} from './liveState'

/**
 * Colyseus client for the game server (server/src/game/GameRoom.js).
 *
 * Public world state (players, their positions, the tables) arrives as Colyseus
 * state patches at 10 Hz. Positions go straight into liveState so they never cause
 * a React render; everything else lands in the zustand store for the UI. Private
 * data (this player's duel, profile) and one-off events (rolls, bubbles, results,
 * toasts) arrive as room messages.
 *
 * The connection is never the player's problem: joining, a cold start (the server
 * waking up) and reconnecting all happen quietly, behind the loading screen or
 * the game, retrying for as long as it takes. Nothing about it is ever shown.
 *
 * Where it connects (see endpointFor):
 * - Bloxity hosting (VITE_BLOXITY_HOSTING_ID set): through Bloxity's matchmaker,
 *   resolving a fresh endpoint for every connection. Never <id>.host.bloxity.io.
 * - Otherwise a game server directly: the local Bloxity stack's server, the dev
 *   server on :3000, or (self-hosted) this page's own origin / VITE_SERVER_URL.
 */

const ROOM_NAME = DATA.bloxity.roomName
const HOSTING_ID = import.meta.env.VITE_BLOXITY_HOSTING_ID || ''
const POS_INTERVAL_MS = 100
const HEARTBEAT_MS = 1000
/** How far back from the table (against sideways 1) a launched loser flies. */
const FLY_BACK = 0.8
/** The server launches the loser this long after the result; the winner dances after it. */
const EJECT_MS = 900
const DANCE_AFTER_EJECT_MS = 500
/** Longest wait between quiet reconnection attempts. */
const MAX_RETRY_MS = 8000
/** Players already in the room when we join get playerInRoom, later ones playerJoined. */
const INITIAL_SYNC_MS = 1500
/** The server's close code when this account joined from another window. */
const KICKED_REPLACED = 4100
/** The server's close code when it freed our place after we were away too long. */
const KICKED_AWAY = 4101
/** Input is reported to the server at most this often (it only needs to know we're here). */
const ACTIVE_EVERY_MS = 15000
/** Consented leave (we called room.leave()). */
const CONSENTED = 4000

let room = null
/** Matchmaker relay room the current room was reached through (hosting only). */
let relayRoomId = null
let hello = null
/** Bumped on every connect/disconnect so a slow, stale join can't attach itself. */
let joinToken = 0
let retryDelay = 500
let retryTimer = null
let posTimer = null
/** server clock - local clock, from the welcome message. */
let clockOffset = 0
/** `?roomId=` from Bloxity's Join button or an invite, used for the first join only. */
let deepLinkRoomId = new URLSearchParams(window.location.search).get('roomId')
/** After signing in mid-game: the room to rejoin with the new identity. */
let rejoinTarget = null
const lastSent = { x: 0, y: 0, z: 0, ry: 0, s: 0, g: true, at: 0 }

const viaMatchmaker = () => Boolean(HOSTING_ID) && boxityEnv().env !== 'local'
const toWs = (url) => url.replace(/^http/i, 'ws')

/** Where to open the next connection: `{ url, relayRoomId? }`. */
async function endpointFor() {
  if (viaMatchmaker()) {
    // A cold start (the server waking up) takes a few seconds; the loading screen
    // covers it, so there is nothing to tell the player.
    const resolved = await platform.resolveEndpoint(HOSTING_ID, { userId: hello?.userId })
    return { url: resolved.endpoint, relayRoomId: resolved.roomId }
  }
  if (import.meta.env.VITE_SERVER_URL) return { url: import.meta.env.VITE_SERVER_URL }
  // Told it is on a local Bloxity stack: the "matchmaker" is your local game server.
  // (Only when told: the SDK also calls any localhost page 'local', without one.)
  const told = window.BLOXITY_ENV
  if (told?.env === 'local' && told.playUrl) return { url: told.playUrl }
  // Dev: Vite serves the page on :5173, the game server runs on :3000. Self-hosted
  // production: the game server serves the page itself.
  if (import.meta.env.DEV) return { url: `${window.location.protocol}//${window.location.hostname}:3000` }
  return { url: window.location.origin }
}

/** Sends `{ t: type, ...payload }` to the room; dropped while not connected. */
export function send(msg) {
  if (!room || useGame.getState().status !== 'online') return
  const { t, ...payload } = msg
  room.send(t, payload)
}

/**
 * Joins a game room, or rejoins with a new identity (login/logout). A player who
 * signs in mid-game goes back into the SAME room rather than being re-matchmade
 * away from their friends.
 */
export function connect(joinOptions) {
  hello = joinOptions
  // A fresh join (e.g. after signing in) is a way back from being away, too.
  useGame.setState({ away: false, awayWarnUntil: 0 })
  const previousRelay = relayRoomId
  const previous = detachRoom()
  rejoinTarget = previous ? { roomId: previous.roomId, relayRoomId: previousRelay } : null
  retryDelay = 500
  join().finally(() => previous?.leave(true).catch(() => {}))
}

export function disconnect() {
  hello = null
  detachRoom()?.leave(true).catch(() => {})
}

/** Stops listening to the current room and resets the world; returns the room. */
function detachRoom() {
  joinToken += 1
  clearTimeout(retryTimer)
  clearInterval(posTimer)
  const old = room
  room = null
  relayRoomId = null
  if (old) {
    old.removeAllListeners()
    platform.updateRoom('')
  }
  resetWorld()
  return old
}

// Closing or leaving the tab frees the seat at once. Only unexpected drops
// (network blips) hold it for the server's reconnection window.
window.addEventListener('pagehide', () => {
  platform.gameplayEnd()
  room?.leave(true).catch(() => {})
})

/** A specific room by id; null when it is gone or full (then we matchmake). */
async function joinById(url, roomId) {
  try {
    return await new Client(url).joinById(roomId, hello)
  } catch {
    return null
  }
}

/**
 * The room behind a `?roomId=` link. On hosting, a bare joinById would land on
 * whichever pod the matchmaker picks, so the room's own pod is looked up in the
 * cross-pod room directory first.
 */
async function joinDeepLink(roomId, target) {
  if (!viaMatchmaker()) return joinById(target.url, roomId)
  try {
    const res = await fetch(`${boxityEnv().playUrl}/v1/dir/${encodeURIComponent(HOSTING_ID)}/list`)
    const body = await res.json()
    const rooms = Array.isArray(body) ? body : body.rooms || []
    const entry = rooms.find((r) => (r.colyseusRoomId || r.roomId || r.id) === roomId)
    if (!entry?.joinUrl) return null
    return joinById(toWs(entry.joinUrl), roomId)
  } catch {
    return null
  }
}

async function join() {
  const token = ++joinToken
  clearTimeout(retryTimer)
  useGame.setState({ status: 'connecting' })
  try {
    // Every connection resolves a fresh endpoint and builds a new Client from it:
    // each endpoint is pinned to one pod.
    const target = await endpointFor()
    let joined = null
    let via = target.relayRoomId || null

    if (rejoinTarget) {
      const back = rejoinTarget
      rejoinTarget = null
      const url = back.relayRoomId ? `${toWs(boxityEnv().playUrl)}/v1/ws/${back.relayRoomId}` : target.url
      joined = await joinById(url, back.roomId)
      if (joined) via = back.relayRoomId
    } else if (deepLinkRoomId) {
      const id = deepLinkRoomId
      deepLinkRoomId = null
      joined = await joinDeepLink(id, target)
    }
    // joinOrCreate fills a room to its 20 players before opening the next one.
    joined ||= await new Client(target.url).joinOrCreate(ROOM_NAME, hello)

    if (token !== joinToken) {
      joined.leave(true).catch(() => {})
      return
    }
    room = joined
    relayRoomId = via
    retryDelay = 500
    attach(joined)
  } catch (err) {
    if (token !== joinToken) return
    // Quietly, again and again: a server waking up just takes a little longer.
    console.warn('[net] could not join the game server yet:', err?.message || err)
    useGame.setState({ status: 'offline' })
    scheduleRejoin()
  }
}

/** Tries again straight away (e.g. the tab came back to the foreground). */
export function retryConnection() {
  if (!hello || room || useGame.getState().away) return
  retryDelay = 500
  join()
}

/** Back after being moved out for being away: join again (the fullest lobby with room). */
export function comeBack() {
  useGame.setState({ away: false, awayWarnUntil: 0 })
  if (!hello || room) return
  retryDelay = 500
  join()
}

/**
 * Tells the server a person is here: any tap, click, key, scroll or mouse move
 * (camera drags and menu browsing included, which send nothing else). At most once
 * every ACTIVE_EVERY_MS, or at once while a "Still there?" warning is showing.
 */
let lastActiveSent = 0
function reportActive() {
  if (!room || useGame.getState().status !== 'online') return
  const warned = useGame.getState().awayWarnUntil > 0
  const now = Date.now()
  if (!warned && now - lastActiveSent < ACTIVE_EVERY_MS) return
  lastActiveSent = now
  room.send('active', {})
  if (warned) useGame.setState({ awayWarnUntil: 0 })
}
export const imHere = () => {
  lastActiveSent = 0
  reportActive()
}
for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) {
  window.addEventListener(type, reportActive, { passive: true, capture: true })
}

function scheduleRejoin() {
  if (!hello) return
  clearTimeout(retryTimer)
  retryTimer = setTimeout(join, retryDelay)
  retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS)
}

// Back from the background (a phone's lock screen): don't sit out the backoff.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !room && hello) retryConnection()
})

/** Left by our own choice or the server's: don't come back on our own. */
const NO_REJOIN = new Set([KICKED_REPLACED, CONSENTED, KICKED_AWAY])

function resetWorld() {
  remotes.clear()
  remoteSeats.clear()
  remoteEmotes.clear()
  bubbles.clear()
  actionFx.clear()
  clearRolls()
  localPlayer.seat = null
  localPlayer.emote = null
  useGame.setState({ players: {}, tables: {}, match: null, trapDraft: null, localDrop: null, landing: null })
}

/** Wires a freshly joined room's state callbacks and messages into the client. */
function attach(r) {
  const cb = Callbacks.get(r)
  const joinedAt = Date.now()
  useGame.setState({ selfId: r.sessionId, roomId: r.roomId })
  // Friends can now join this room from Bloxity (invites, "Open Rooms").
  platform.updateRoom(r.roomId)

  for (const [type, handler] of Object.entries(handlers)) r.onMessage(type, handler)

  cb.onAdd('players', (player, id) => {
    setPlayerMeta(id, player)
    cb.listen(player, 'streak', () => setPlayerMeta(id, player), false)
    cb.listen(player, 'avatar', () => setPlayerMeta(id, player), false)
    cb.listen(player, 'halo', () => setPlayerMeta(id, player), false)
    cb.listen(player, 'level', () => setPlayerMeta(id, player), false)
    cb.listen(player, 'title', () => setPlayerMeta(id, player), false)
    if (id === r.sessionId) return

    // Bloxity's friend-join toasts (bots have no Bloxity account).
    if (!player.bot) {
      if (Date.now() - joinedAt < INITIAL_SYNC_MS) platform.playerInRoom(player.uname)
      else platform.playerJoined(player.uname)
    }

    pushRemote(id, player.x, player.y, player.z, player.ry, player.s, player.g)
    cb.onChange(player, () => pushRemote(id, player.x, player.y, player.z, player.ry, player.s, player.g))
    cb.listen(
      player,
      'emoteSeq',
      () => {
        if (player.emote) startRemoteEmote(id, player.emote)
      },
      false,
    )
  })
  cb.onRemove('players', (_player, id) => removePlayer(id))

  cb.onAdd('tables', (table, key) => {
    applyTable(Number(key), table)
    cb.onChange(table, () => applyTable(Number(key), table))
  })

  // A dropped connection: Colyseus reconnects on its own and the server holds our
  // place (and table seat) meanwhile.
  r.onDrop(() => {
    clearInterval(posTimer)
    useGame.setState({ status: 'offline' })
  })
  r.onReconnect(() => {
    useGame.setState({ status: 'online' })
    startPositionUpdates()
  })
  r.onLeave((code) => {
    if (room !== r) return
    room = null
    clearInterval(posTimer)
    platform.updateRoom('')
    resetWorld()
    useGame.setState({ status: 'offline' })
    // Moved out for being away: one tap on "Play again" brings us back (comeBack).
    if (code === KICKED_AWAY) useGame.setState({ away: true, awayWarnUntil: 0 })
    if (NO_REJOIN.has(code)) return
    // Closed unexpectedly (e.g. its pod is being replaced): resolve again and rejoin.
    scheduleRejoin()
  })
  r.onError((code, message) => console.warn('[net] room error', code, message))

  startPositionUpdates()
}

/* ---- Platform events ------------------------------------------------------------ */

/** Bloxity's emote picker chose an emote: play it here and replicate it. */
onPlatformEvent('playEmote', async (id) => {
  if (localPlayer.seat || !room) return
  const emote = (await loadEmoteCatalog()).get(id)
  // Unknown ids are ignored silently; Bloxity only sends emotes the player owns.
  if (!emote) return
  localPlayer.emote = { clip: emote.clip, start: performance.now() / 1000 }
  room.send('anim', { id })
})

async function startRemoteEmote(id, emoteId) {
  const emote = (await loadEmoteCatalog()).get(emoteId)
  if (emote) remoteEmotes.set(id, { clip: emote.clip, start: performance.now() / 1000 })
}

/** Bloxity menu "Reset Character": stand up and go back to the spawn point. */
onPlatformEvent('respawn', () => {
  if (useGame.getState().match) send({ t: 'leave' })
  localPlayer.seat = null
  localPlayer.emote = null
  localPlayer.position.set(SPAWN[0], SPAWN[1], SPAWN[2])
  localPlayer.ry = Math.PI
  localPlayer.snapCamera = true
})

/** A chat message from Bloxity's chat: shown over the sender's head. */
onPlatformEvent('chat', (m) => {
  const { selfId, players } = useGame.getState()
  const id = m.isLocalPlayer
    ? selfId
    : Object.values(players).find((p) => p.uid && p.uid === m.userId)?.id
  if (id) setBubble(id, m.text, m.seconds * 1000)
  // Chatting in Bloxity's own chat panel (outside the game's page) is being here too.
  if (m.isLocalPlayer) reportActive()
})

// An ad break is not being away: the clock starts again when it ends.
onPlatformEvent('breakStart', () => {
  sfx.setMuted(true)
  imHere()
})
onPlatformEvent('breakEnd', () => {
  sfx.setMuted(false)
  imHere()
})

function startPositionUpdates() {
  clearInterval(posTimer)
  lastSent.at = 0
  posTimer = setInterval(sendPosition, POS_INTERVAL_MS)
}

/** Sends the local transform when it changed, plus a slow heartbeat. */
function sendPosition() {
  if (localPlayer.seat || !room) return
  const p = localPlayer.position
  const now = Date.now()
  const moved =
    Math.abs(p.x - lastSent.x) > 0.02 ||
    Math.abs(p.y - lastSent.y) > 0.02 ||
    Math.abs(p.z - lastSent.z) > 0.02 ||
    Math.abs(localPlayer.ry - lastSent.ry) > 0.03 ||
    Math.abs(localPlayer.speed - lastSent.s) > 0.2 ||
    localPlayer.grounded !== lastSent.g
  if (!moved && now - lastSent.at < HEARTBEAT_MS) return

  lastSent.x = p.x
  lastSent.y = p.y
  lastSent.z = p.z
  lastSent.ry = localPlayer.ry
  lastSent.s = localPlayer.speed
  lastSent.g = localPlayer.grounded
  lastSent.at = now
  room.send('pos', { x: p.x, y: p.y, z: p.z, ry: localPlayer.ry, s: localPlayer.speed, g: localPlayer.grounded })
}

function parseAvatar(json) {
  try {
    const { equipped = null, proportions = null } = JSON.parse(json || '{}')
    return { equipped, proportions }
  } catch {
    return { equipped: null, proportions: null }
  }
}

function setPlayerMeta(id, player) {
  const { equipped, proportions } = parseAvatar(player.avatar)
  useGame.setState((s) => ({
    players: {
      ...s.players,
      [id]: {
        id,
        name: player.name,
        uid: player.uid,
        bot: Boolean(player.bot),
        streak: player.streak,
        level: player.level,
        title: player.title,
        halo: player.halo,
        equipped,
        proportions,
      },
    },
  }))
}

function removePlayer(id) {
  remotes.delete(id)
  remoteEmotes.delete(id)
  remoteSeats.delete(id)
  bubbles.delete(id)
  actionFx.delete(id)
  useGame.setState((s) => {
    const players = { ...s.players }
    delete players[id]
    return { players }
  })
}

/** Mirrors who is standing where (and who is dancing after a win) for remote players' pose. */
function indexSeats(table) {
  const wasHere = []
  for (const [id, seat] of remoteSeats) {
    if (seat.table !== table.id) continue
    remoteSeats.delete(id)
    wasHere.push(id)
  }
  table.seats.forEach((s, i) => {
    if (!s) return
    const dancing = table.phase === 'ended' && table.winner === s.id
    remoteSeats.set(s.id, { ...seatPosition(table.id, i), table: table.id, dancing })
  })
  // Whoever left the table leaves their duel behind (a loser's flight included).
  for (const id of wasHere) if (!remoteSeats.has(id)) actionFx.delete(id)
}

/** Synced TableState -> the plain shape the UI uses, with local-clock times. */
function applyTable(id, t) {
  const table = {
    id,
    phase: t.phase,
    seats: [t.seat0 ? { id: t.seat0, cookie: t.cookie0 } : null, t.seat1 ? { id: t.seat1, cookie: t.cookie1 } : null],
    winner: t.winner || null,
    endsAt: t.endsAt ? t.endsAt - clockOffset : 0,
    /** When the current aim began (local clock): the launcher's sweep starts then. */
    aimAt: t.aimAt ? t.aimAt - clockOffset : 0,
    round: t.round,
    poisons: t.poisons,
    hearts: [t.hearts0, t.hearts1],
    turn: t.turn,
    ready: [t.ready0, t.ready1],
    lastCup: t.lastCup,
    lastKind: t.lastKind,
  }
  indexSeats(table)
  useGame.setState((s) => ({ tables: { ...s.tables, [id]: table } }))
}

/** Private match state with its server durations turned into local times. */
function withTimes(match) {
  if (!match) return null
  const now = Date.now()
  return {
    ...match,
    endsAt: now + (match.endsInMs || 0),
    aimStart: now - (match.aimElapsedMs || 0),
  }
}

function withProfileDeadlines(profile) {
  const now = Date.now()
  return { ...profile, giftAt: now + profile.giftInMs, questResetAt: now + profile.questResetInMs }
}

function positionOf(id) {
  if (id === useGame.getState().selfId) return localPlayer.position
  const seat = remoteSeats.get(id)
  if (seat) return { x: seat.x, y: 0, z: seat.z }
  return remotes.get(id) || null
}

/** A player's spot at a table ({ x, z, ry, table }), local or remote, or null. */
function seatOf(id) {
  if (id === useGame.getState().selfId) {
    const m = useGame.getState().match
    return localPlayer.seat && m ? { ...localPlayer.seat, table: m.table } : null
  }
  return remoteSeats.get(id) || null
}

/** The server's confirmations come as toasts; each kind gets its sound. */
function playToastSound(text) {
  if (/not enough|need \$|busy|full|walk closer|already|too slow|out of time|nothing left/i.test(text)) sfx.error()
  else if (/bought|unlocked|claimed/i.test(text)) sfx.buy()
  else if (/quest complete|gift|reward|streak/i.test(text)) sfx.reward()
}

/** actionFx is keyed by session id, except the local player's entry. */
const fxKey = (id) => (id === useGame.getState().selfId ? SELF_ANCHOR : id)

/** The duel's loser: launched off to one side and back from the table. */
function playEject(id, now) {
  const seat = seatOf(id)
  if (!seat) return
  const side = Math.random() < 0.5 ? -1 : 1
  // Back from the table (against the way they face), and to one side.
  let ax = -Math.sin(seat.ry) * FLY_BACK + Math.cos(seat.ry) * side
  let az = -Math.cos(seat.ry) * FLY_BACK - Math.sin(seat.ry) * side
  const n = Math.hypot(ax, az) || 1
  ax /= n
  az /= n
  const key = fxKey(id)
  actionFx.set(key, { ...actionFx.get(key), fly: now, ax, az, side })
  const { selfId, match } = useGame.getState()
  if (id === selfId || (match && id === match.opponent)) sfx.eject()
}

const handlers = {
  welcome(msg) {
    clockOffset = msg.serverNow - Date.now()
    useGame.setState({
      status: 'online',
      capacity: msg.capacity,
      profile: withProfileDeadlines(msg.profile),
      lb: msg.lb,
    })
    // Table deadlines decoded before this message used a zero clock offset.
    room?.state.tables.forEach((t, key) => applyTable(Number(key), t))
  },

  match(msg) {
    const prev = useGame.getState().match
    const next = withTimes(msg.match)
    sfx.setDucked(Boolean(next))
    localPlayer.seat = next ? { ...seatPosition(next.table, next.seat), dancing: Boolean(next.won) } : null

    if (next && prev) {
      // A new round: time to poison some cups.
      if (next.phase === 'poison' && (prev.phase !== 'poison' || prev.round !== next.round)) sfx.go()
      // Your turn to drop.
      if (next.phase === 'aim' && next.turn === next.seat && (prev.phase !== 'aim' || prev.turn !== next.turn)) {
        sfx.yourTurn()
      }
      // The opponent locked their poison in.
      const o = 1 - next.seat
      if (next.phase === 'poison' && next.ready[o] && !prev.ready[o]) sfx.theirReady()
    }
    // Leaving the table leaves the duel behind (a loser's flight included).
    if (!next) actionFx.delete(SELF_ANCHOR)
    useGame.setState((s) => ({
      match: next,
      // A new round starts from the server's picks; a new turn can be dropped again.
      ...(!next || s.trapDraft?.round !== next.round ? { trapDraft: null } : {}),
      ...(!next ? { localDrop: null, landing: null } : {}),
      // The quit popup only makes sense while a duel is under way.
      ...(!isPlayingPhase(next?.phase) ? { quitAsk: false } : {}),
    }))
  },

  /** A cookie was dropped at a table, anywhere in the room: everyone animates it. */
  roll(msg) {
    startRoll(msg)
  },

  /** Lost a duel: back to the lobby spawn point. */
  respawn(msg) {
    localPlayer.seat = null
    localPlayer.position.set(msg.x, msg.y, msg.z)
    localPlayer.ry = msg.ry
    localPlayer.snapCamera = true
  },

  profile(msg) {
    useGame.setState({ profile: withProfileDeadlines(msg.profile) })
  },

  /**
   * Table actions anywhere in the room, so every duel looks alive from the square:
   * a drop (the hand flicks the cookie onto the board) or a launch (lost the duel).
   * Landing in poison is animated by rolls.js, in step with the cookie.
   */
  fx(msg) {
    const now = Date.now()
    const key = fxKey(msg.id)
    if (msg.kind === 'drop') {
      // The local player's own drop already started the animation (duelActions).
      const fx = actionFx.get(key)
      if (!fx?.press || now - fx.press > 1000) actionFx.set(key, { ...fx, press: now })
      return
    }
    if (msg.kind === 'eject') playEject(msg.id, now)
  },

  bubble(msg) {
    setBubble(msg.id, msg.text)
  },

  /** "Still there?": we'll be moved out in `inMs` unless we do something (-1: cleared). */
  afk(msg) {
    useGame.setState({ awayWarnUntil: msg.inMs >= 0 ? Date.now() + msg.inMs : 0 })
    if (msg.inMs >= 0) sfx.pop()
  },

  toast(msg) {
    useGame.getState().pushToast(msg.text)
    playToastSound(msg.text)
  },

  lb(msg) {
    useGame.setState({ lb: { streaks: msg.streaks, wins: msg.wins, levels: msg.levels, playtime: msg.playtime } })
  },

  /** Levelled up: a banner, a sparkle sound and confetti over your head. */
  levelUp(msg) {
    // Shown after the duel result has had its moment (it is sent just before the result).
    const { result, match } = useGame.getState()
    const delay = result || match ? 3000 : 0
    setTimeout(() => {
      sfx.reward()
      if (getSettings().particles) {
        const p = localPlayer.position
        effectQueue.push({ kind: 'confetti', x: p.x, y: 3, z: p.z })
      }
      useGame.setState({ levelUp: { ...msg, until: Date.now() + 3200 } })
    }, delay)
  },

  result(msg) {
    // The winner dances once the loser has been launched.
    if (msg.winner) {
      const wait = msg.reason === 'hearts' ? EJECT_MS + DANCE_AFTER_EJECT_MS : 0
      const key = fxKey(msg.winner)
      actionFx.set(key, { ...actionFx.get(key), danceAt: Date.now() + wait })
    }
    showResult(msg)
  },
}

/** The duel result: confetti over the winner, and your banner if it was your duel. */
function showResult(msg) {
  const { selfId, match } = useGame.getState()
  const now = Date.now()

  // The particle system only exists on presets that allow particles; queuing
  // without it would grow the queue forever.
  if (getSettings().particles) {
    const winnerPos = msg.winner && positionOf(msg.winner)
    if (winnerPos) effectQueue.push({ kind: 'confetti', x: winnerPos.x, y: 2.5, z: winnerPos.z })
  }

  if (msg.winner === selfId || msg.loser === selfId) {
    const win = msg.winner === selfId
    const mySeat = match?.seat ?? 0
    win ? sfx.win() : sfx.lose()
    useGame.setState({
      result: {
        win,
        reward: win ? msg.reward : msg.consolation || 0,
        /** What a quitter paid (the winner's reward already includes it). */
        penalty: msg.penalty || 0,
        /** Hearts left: [yours, theirs]. */
        hearts: [msg.hearts[mySeat], msg.hearts[1 - mySeat]],
        reason: msg.reason,
        vsBot: Boolean(msg.vsBot),
        until: now + 4600,
      },
    })
  }
}
