/**
 * This frame's cookies, waiting to be drawn by CookieInstances. Anything that wants
 * a cookie on screen calls `drawCookie(type, matrix)` from a frame callback with
 * priority COOKIE_PRODUCER, which runs before CookieInstances flushes the list into
 * its batched mesh (and empties it for the next frame). Preallocated: nothing is
 * allocated per frame.
 */

/** Most cookies drawn at once, of every kind together (15 tables, the showroom, the giants...). */
export const MAX_COOKIES = 48
/** useFrame priority for code that calls drawCookie: runs before the flush. */
export const COOKIE_PRODUCER = -1

export const queue = {
  count: 0,
  types: new Int16Array(MAX_COOKIES),
  matrices: new Float32Array(MAX_COOKIES * 16),
}

/** Queues cookie type `type` (a DATA.cookies index) at a world matrix for this frame. */
export function drawCookie(type, matrix) {
  if (queue.count >= MAX_COOKIES || type < 0) return
  queue.types[queue.count] = type
  matrix.toArray(queue.matrices, queue.count * 16)
  queue.count += 1
}
