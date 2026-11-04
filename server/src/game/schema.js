const { schema, t } = require('@colyseus/schema')

/**
 * Synchronised room state. Colyseus diffs it and sends only changed fields to every
 * client at the room's patch rate.
 *
 * Only public information lives here. Which cups each player has poisoned, their duel
 * view and their profile (cash, inventory) go to that player alone as messages. A
 * roll's aim and seed are broadcast as a 'roll' message the moment it happens (a
 * patch could be up to 100 ms late), and every client animates it.
 */

const PlayerState = schema(
  {
    name: t.string(),
    /** Bloxity account id ('' for guests and bots): matches chat messages to players. */
    uid: t.string(),
    /** Bloxity username, for the platform's friend-join toasts. */
    uname: t.string(),
    /** A computer opponent filling an empty seat (see Bot.js). */
    bot: t.boolean(),
    streak: t.uint16(),
    level: t.uint16(),
    /** Title worn (a DATA.titles id, '' = none). */
    title: t.string(),
    /** Head aura worn (a DATA.halos id, '' = none). */
    halo: t.string(),
    /** Bloxity emote being played, and a counter that changes on every play. */
    emote: t.string(),
    emoteSeq: t.uint16(),
    /** JSON of { equipped, proportions }: changes rarely, and opaque to the server. */
    avatar: t.string(),
    x: t.float32(),
    y: t.float32(),
    z: t.float32(),
    /** Facing (yaw), horizontal speed, and whether grounded: drive the remote pose. */
    ry: t.float32(),
    s: t.float32(),
    g: t.boolean(),
  },
  'Player',
)

const TableState = schema(
  {
    /** 'waiting' | 'countdown' | 'poison' | 'aim' | 'rolling' | 'reveal' | 'ended' */
    phase: t.string(),
    /** Session ids in the two seats ('' when empty), and each one's equipped cookie. */
    seat0: t.string(),
    seat1: t.string(),
    cookie0: t.string(),
    cookie1: t.string(),
    /** Session id of the duel's winner while the result shows: they dance by the table. */
    winner: t.string(),
    /** Server epoch ms when the current phase times out (0 when it doesn't). */
    endsAt: t.float64(),
    /** Server epoch ms when the current aim began: the launcher's sweep starts then. */
    aimAt: t.float64(),
    /** Round number (1-based) and how many cups each player poisons in it. */
    round: t.uint8(),
    poisons: t.uint8(),
    hearts0: t.uint8(),
    hearts1: t.uint8(),
    /** Seat whose turn it is to drop (aim / rolling / reveal), -1 otherwise. */
    turn: t.int8(),
    /** Each seat has locked in its poison this round. */
    ready0: t.boolean(),
    ready1: t.boolean(),
    /** The last roll's cup (-1 none) and what was in it: -1 milk, else a DATA.poisonKinds index. */
    lastCup: t.int8(),
    lastKind: t.int8(),
  },
  'Table',
)

const GameState = schema(
  {
    players: t.map(PlayerState),
    /** Keyed by table id as a string. */
    tables: t.map(TableState),
  },
  'GameState',
)

module.exports = { PlayerState, TableState, GameState }
