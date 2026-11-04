import { create } from 'zustand'

import DATA from '../../../shared/gameData.json'

/**
 * Event-driven game state for the UI: connection, room roster, tables, the local
 * player's match and profile. Updated by socket.js when messages arrive — never
 * from a frame loop. Server durations ("ends in N ms") are converted to local
 * deadlines on receipt so client clock skew can't matter.
 */

let toastId = 0

export const useGame = create((set, get) => ({
  /**
   * 'connecting' | 'online' | 'offline'. Never shown to the player: connecting and
   * reconnecting happen quietly behind the loading screen and the game.
   */
  status: 'connecting',
  selfId: null,
  roomId: null,
  capacity: 30,
  /** id -> { id, name, streak, equipped, proportions } */
  players: {},
  /** id -> public table state + `endsAt` */
  tables: {},
  /** This player's private match state + `endsAt`, or null when not seated. */
  match: null,
  /** Owner's profile view + `giftAt` / `questResetAt` deadlines. */
  profile: null,
  lb: { streaks: [], wins: [], levels: [], playtime: [] },
  toasts: [],
  /** null | 'shop' | 'items' | 'rewards' | 'quests' | 'help' | 'settings' */
  modal: null,
  shopTab: 'cookies',
  /** Duel outcome banner for this player: { win, reward, reason, hearts, vsBot, until }. */
  result: null,
  /** The cups you're poisoning this round, before the server echoes them: { round, cups }. */
  trapDraft: null,
  /** The turn you've already dropped your cookie in (`table:round:turn`), so a double tap can't. */
  localDrop: null,
  /** A cookie just landed at your table: { table, seat, cup, hurt, kind, at } (the reveal popup). */
  landing: null,
  /** "Still there?": when the server will free our place unless we do something (0: no warning). */
  awayWarnUntil: 0,
  /** We were moved out of the lobby for being away; "Play again" brings us back. */
  away: false,
  /** The "Quit the duel?" popup is open (only while a duel is under way). */
  quitAsk: false,
  /** Full-screen edge glow at your table: { kind: 'poison' | 'gold', at, delay, until } (ms). */
  flash: null,
  /** Level-up celebration: { level, reward, title, until }. */
  levelUp: null,
  emotesOpen: false,

  openModal: (modal, shopTab) => set({ modal, ...(shopTab ? { shopTab } : {}) }),
  closeModal: () => set({ modal: null }),
  setShopTab: (shopTab) => set({ shopTab }),
  toggleEmotes: () => set({ emotesOpen: !get().emotesOpen }),

  pushToast: (text) => {
    const id = ++toastId
    set({ toasts: [...get().toasts.slice(-3), { id, text }] })
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 3200)
  },
}))

/**
 * Bots are offered only while the lobby is quiet: at most DATA.bot.maxLobbyPlayers
 * people in it (bots themselves don't count). The server applies the same rule.
 */
export function botsAllowed(state) {
  let people = 0
  for (const id in state.players) if (!state.players[id].bot) people += 1
  return people <= DATA.bot.maxLobbyPlayers
}

export const isPlayingPhase = (phase) =>
  phase === 'poison' || phase === 'aim' || phase === 'rolling' || phase === 'reveal'
