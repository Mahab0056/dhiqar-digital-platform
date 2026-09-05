import { useEffect, useState } from 'react'
import { api } from '../api'
import type { StaffSession } from '../types'

let cached: StaffSession | null | undefined
let inflight: Promise<StaffSession | null> | null = null
const listeners = new Set<(session: StaffSession | null) => void>()

export function loadSession(force = false) {
  if (!force && cached !== undefined) return Promise.resolve(cached)
  if (!inflight)
    inflight = api
      .getSession()
      .then(session => session)
      .catch(() => null)
      .then(session => {
        cached = session
        inflight = null
        for (const listener of listeners) listener(session)
        return session
      })
  return inflight
}

export function clearSessionCache() {
  cached = null
  for (const listener of listeners) listener(null)
}

/** Shared session state across components — one request per page load, refreshed on login/logout. */
export function useSession() {
  const [session, setSession] = useState<StaffSession | null | undefined>(cached)
  useEffect(() => {
    listeners.add(setSession)
    void loadSession()
    return () => {
      listeners.delete(setSession)
    }
  }, [])
  return { session: session ?? null, loading: session === undefined, refresh: () => loadSession(true) }
}

export async function logoutAndRedirect(navigate: (path: string) => void, to = '/login') {
  try {
    await api.logout()
  } finally {
    clearSessionCache()
    navigate(to)
  }
}
