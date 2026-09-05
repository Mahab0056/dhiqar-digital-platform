import { BellRing, BellOff, Smartphone, AlertTriangle } from 'lucide-react'
import { usePushNotifications } from '../../lib/push'

/** Lets the citizen enable browser/phone push notifications for this device. Hidden when unsupported/disabled. */
export function PushNotificationsCard({ compact = false }: { compact?: boolean }) {
  const { state, error, subscribe, unsubscribe } = usePushNotifications()
  if (state === 'unsupported' || state === 'disabled') return null
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const standalone = window.matchMedia('(display-mode: standalone)').matches
  return (
    <div className={`push-card ${state === 'subscribed' ? 'is-on' : ''} ${compact ? 'compact' : ''}`}>
      <span className="push-card-icon">{state === 'subscribed' ? <BellRing /> : <Smartphone />}</span>
      <div>
        <strong>
          {state === 'subscribed'
            ? 'إشعارات الهاتف مفعّلة على هذا الجهاز'
            : state === 'denied'
              ? 'الإشعارات محظورة من إعدادات المتصفح'
              : 'فعّل إشعارات الهاتف'}
        </strong>
        <span>
          {state === 'subscribed'
            ? 'يصلك تنبيه فوري عند أي تحديث على معاملتك، حتى والمتصفح مغلق.'
            : state === 'denied'
              ? 'اسمح بالإشعارات لهذا الموقع من إعدادات المتصفح ثم أعد المحاولة.'
              : isIos && !standalone
                ? 'على iPhone: أضف الموقع إلى الشاشة الرئيسية (مشاركة ← إضافة إلى الشاشة الرئيسية) ثم فعّل الإشعارات من داخله.'
                : 'تنبيه فوري على جهازك عند قبول الطلب أو طلب مستمسك أو صدور وثيقة PDF.'}
        </span>
        {error && (
          <em className="push-card-error">
            <AlertTriangle /> {error}
          </em>
        )}
      </div>
      {state === 'subscribed' ? (
        <button className="button outline small" onClick={() => void unsubscribe()}>
          <BellOff /> إيقاف
        </button>
      ) : state !== 'denied' ? (
        <button className="button primary small" disabled={state === 'working'} onClick={() => void subscribe()}>
          <BellRing /> {state === 'working' ? 'جاري التفعيل…' : 'تفعيل'}
        </button>
      ) : null}
    </div>
  )
}
