import { createContext, useContext, useEffect, useState } from 'react'

const KEY = 'tqd-motion-paused'

type MotionPref = { paused: boolean; reduced: boolean; still: boolean; toggle: () => void }

const MotionContext = createContext<MotionPref>({ paused: false, reduced: false, still: false, toggle: () => {} })

/** Visitor-controlled pause for continuous motion, combined with the OS "reduce motion" setting. */
export function useMotionPrefState(): MotionPref {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [paused, setPaused] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const toggle = () =>
    setPaused(current => {
      try {
        localStorage.setItem(KEY, current ? '0' : '1')
      } catch {
        /* storage unavailable: the choice lasts for this visit */
      }
      return !current
    })
  return { paused, reduced, still: paused || reduced, toggle }
}

export const MotionPrefProvider = MotionContext.Provider
export const useMotionPref = () => useContext(MotionContext)
