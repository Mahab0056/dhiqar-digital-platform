import { useSyncExternalStore } from 'react'

/**
 * أفندي's sounds (the same files as the owner's أفندي): a short Hijaz chime when the panel opens, a soft ring when a
 * reply lands. Nothing plays before the citizen has pressed something on the page (browsers block autoplay anyway),
 * every play is quiet and fire-and-forget, and a mute toggle (panel header) is remembered per browser.
 */
const SOURCES = {
  chime: '/brand/afandi/afandi-chime.mp3',
  notify: '/brand/afandi/afandi-notify.mp3',
} as const
export type AfandiSound = keyof typeof SOURCES

const MUTE_KEY = 'dqa-afandi-muted'
const listeners = new Set<() => void>()
let muted = readMuted()

function readMuted() {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

export const isMuted = () => muted

export function setMuted(next: boolean) {
  muted = next
  try {
    window.localStorage.setItem(MUTE_KEY, next ? '1' : '0')
  } catch {
    /* storage blocked: the choice lasts for this page */
  }
  listeners.forEach(listener => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** [muted, setMuted] that re-renders every subscriber (launcher, panel, greeter). */
export function useAfandiMuted(): [boolean, (next: boolean) => void] {
  return [useSyncExternalStore(subscribe, isMuted, () => false), setMuted]
}

const cache = new Map<AfandiSound, HTMLAudioElement>()
const VOLUME: Record<AfandiSound, number> = { chime: 0.32, notify: 0.28 }

/** Plays a sound unless muted / unsupported / blocked. Never throws. */
export function playAfandiSound(sound: AfandiSound) {
  if (muted || typeof window === 'undefined' || typeof window.Audio !== 'function') return
  try {
    let audio = cache.get(sound)
    if (!audio) {
      audio = new Audio(SOURCES[sound])
      audio.preload = 'auto'
      cache.set(sound, audio)
    }
    audio.volume = VOLUME[sound]
    audio.currentTime = 0
    const started = audio.play()
    if (started && typeof started.catch === 'function') started.catch(() => undefined)
  } catch {
    /* autoplay policy or decoding error: silence is fine */
  }
}
