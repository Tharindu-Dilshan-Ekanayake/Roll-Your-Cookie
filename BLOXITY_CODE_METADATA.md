---
gameSlug: slap-chips
clientDir: client
buildCommand: npm ci && npm run build
distDir: client/dist
multiplayer: true
roomSize: 20
canDie: false
hasScore: true
leaderboards:
  - id: wins
    label: Wins
    order: desc
    mode: sum
    reset: weekly
  - id: best_streak
    label: Best Streak
    order: desc
    mode: best
    reset: none
  - id: level
    label: Level
    order: desc
    mode: best
    reset: none
  - id: playtime
    label: Minutes Played
    order: desc
    mode: sum
    reset: none
notApplicable:
  deathScreen: >-
    A player cannot die. Losing a duel launches the player out of their chair
    (a short cartoon ejection) and sends them back to the lobby; it is not a death.
  rewardedAds: >-
    The game has no reward earned by watching an ad yet. Add a "watch ad" reward
    (e.g. open the mystery gift early) before turning rewarded ads on.
  gemsPurchases: >-
    No Gems products are in the catalogue yet; shop items cost in-game cash. The
    Gems webhook (/api/legion-webhook) already records grants by transactionId.
---

# Bloxity integration notes

- Leaderboard scores are submitted by the game server from its own state
  (`server/src/bloxity/leaderboards.js`), never from a client message.
- Players join through Bloxity's matchmaker (`Legion.SDK.net.resolveEndpoint`)
  when `VITE_BLOXITY_HOSTING_ID` is set at build time (the deploy workflow sets it
  from the `BLOXITY_GAME_ID` repository variable).
- The game server verifies every signed-in player's Bloxity token
  (`/v1/auth/game-token/verify`) and carries guest progress into a new account
  (`carriedFrom`).
