import { useEffect, useState } from 'react'

export const money = (n) => `$${Math.floor(n).toLocaleString('en-US')}`

/** "HH:MM:SS" above an hour, else "MM:SS". */
export function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const pad = (n) => String(n).padStart(2, '0')
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${pad(h)}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`
}

/** Re-renders on an interval; for countdown displays only. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** A stopwatch reading in seconds and milliseconds, "SS.mmm" (capped at 99.999). */
export function stopwatch(ms) {
  const t = Math.min(99999, Math.max(0, Math.floor(ms)))
  return `${String(Math.floor(t / 1000)).padStart(2, '0')}.${String(t % 1000).padStart(3, '0')}`
}

/** What a stopwatch shows instead of a time: "??.???" while blind, "--.---" for none. */
export const BLIND_READING = '??.???'
export const NO_READING = '--.---'

/** How far a stop was from its target, "+0.123s" / "−0.407s". */
export function offBy(ms) {
  return `${ms >= 0 ? '+' : '−'}${(Math.abs(ms) / 1000).toFixed(3)}s`
}
