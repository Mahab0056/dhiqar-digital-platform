import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'

export type PushState = 'unsupported' | 'disabled' | 'denied' | 'idle' | 'subscribed' | 'working'

const urlBase64ToUint8Array = (base64: string) => {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)))
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

/** Citizen-side hook: subscribe this device to push notifications. */
export function usePushNotifications() {
  const [state, setState] = useState<PushState>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setState('unsupported')
      return
    }
    api
      .getPushConfig()
      .then(async config => {
        if (!active) return
        if (!config.enabled || !config.publicKey) return setState('disabled')
        if (Notification.permission === 'denied') return setState('denied')
        const registration = await navigator.serviceWorker.ready
        const existing = await registration.pushManager.getSubscription()
        if (!active) return
        setState(existing ? 'subscribed' : 'idle')
      })
      .catch(() => {
        if (active) setState('disabled')
      })
    return () => {
      active = false
    }
  }, [])

  const subscribe = useCallback(async () => {
    setError('')
    setState('working')
    try {
      const config = await api.getPushConfig()
      if (!config.enabled || !config.publicKey) throw new Error('إشعارات المتصفح غير مفعّلة على الخادم.')
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState('denied')
        return
      }
      const registration = await navigator.serviceWorker.ready
      const subscription =
        (await registration.pushManager.getSubscription()) ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(config.publicKey),
        }))
      const json = subscription.toJSON()
      await api.subscribePush({
        endpoint: subscription.endpoint,
        keys: { p256dh: json.keys?.p256dh || '', auth: json.keys?.auth || '' },
      })
      setState('subscribed')
    } catch (err) {
      setError((err as Error).message || 'تعذر تفعيل الإشعارات.')
      setState('idle')
    }
  }, [])

  const unsubscribe = useCallback(async () => {
    setState('working')
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await api.unsubscribePush(subscription.endpoint).catch(() => {})
        await subscription.unsubscribe()
      }
      setState('idle')
    } catch {
      setState('subscribed')
    }
  }, [])

  return { state, error, subscribe, unsubscribe }
}
