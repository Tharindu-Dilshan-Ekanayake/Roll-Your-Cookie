const path = require('path')
const { pathToFileURL } = require('url')

/**
 * The board's physics live in shared/plinko.mjs, an ES module the client imports
 * too, so both run the very same simulation. This CommonJS server loads it once at
 * start-up (see server.js); everything after that is synchronous.
 */
let mod = null

async function loadPlinko() {
  if (!mod) mod = await import(pathToFileURL(path.join(__dirname, '..', '..', '..', 'shared', 'plinko.mjs')).href)
  return mod
}

function plinko() {
  if (!mod) throw new Error('plinko.mjs not loaded yet: call loadPlinko() at start-up')
  return mod
}

module.exports = { loadPlinko, plinko }
