import { arabicCount } from './arabic-count'
import type { TenderStatus, TenderType } from '../types'

const minutes = (n: number) =>
  arabicCount(n, { one: 'دقيقة', two: 'دقيقتين', few: 'دقائق', many: 'دقيقة' }).replace(' واحدة', '')
const hours = (n: number) =>
  arabicCount(n, { one: 'ساعة', two: 'ساعتين', few: 'ساعات', many: 'ساعة' }).replace(' واحدة', '')
const days = (n: number) =>
  arabicCount(n, { one: 'يوم', two: 'يومين', few: 'أيام', many: 'يوماً' }, { feminine: false }).replace(' واحد', '')

/** «قبل ساعتين», «قبل 5 دقائق», «أمس». */
export function relativeTime(iso: string, now = Date.now()) {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return ''
  const diff = Math.max(0, now - time)
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'الآن'
  if (m < 60) return `قبل ${minutes(m)}`
  const h = Math.floor(m / 60)
  if (h < 24) return `قبل ${hours(h)}`
  const d = Math.floor(h / 24)
  if (d === 1) return 'أمس'
  if (d < 30) return `قبل ${days(d)}`
  return new Date(time).toLocaleDateString('ar-IQ', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** «يغلق بعد 5 أيام», «يغلق اليوم», «أُغلق قبل يومين». */
export function closingLabel(iso: string, now = Date.now()) {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return ''
  const diff = time - now
  if (diff <= 0) {
    const ago = relativeTime(iso, now)
    return ago === 'أمس' ? 'أُغلق أمس' : `أُغلق ${ago}`
  }
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return 'يغلق خلال أقل من ساعة'
  if (h < 24) return `يغلق بعد ${hours(h)}`
  const d = Math.floor(h / 24)
  if (d === 1) return 'يغلق غداً'
  return `يغلق بعد ${days(d)}`
}

export const isClosingSoon = (iso: string, now = Date.now()) => {
  const diff = Date.parse(iso) - now
  return diff > 0 && diff < 3 * 86_400_000
}

export const formatDate = (iso: string, withTime = false) =>
  new Date(iso).toLocaleString('ar-IQ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
    numberingSystem: 'latn',
  })

export const formatIqd = (value: number | null) => (value === null ? null : `${value.toLocaleString('en-US')} د.ع`)

export const TENDER_STATUS: Record<TenderStatus, { label: string; tone: string }> = {
  OPEN: { label: 'مفتوحة', tone: 'open' },
  CLOSED: { label: 'مغلقة', tone: 'closed' },
  CANCELLED: { label: 'ملغاة', tone: 'cancelled' },
  AWARDED: { label: 'تمت الإحالة', tone: 'awarded' },
}

export const TENDER_TYPE: Record<TenderType, { label: string; plural: string }> = {
  TENDER: { label: 'مناقصة', plural: 'مناقصات' },
  AUCTION: { label: 'مزايدة', plural: 'مزايدات' },
}

/** Publisher host for attribution («shafaq.com»); Google News wrapper links show the publisher name only. */
export const linkHost = (link: string) => {
  try {
    const host = new URL(link).hostname.replace(/^www\./, '')
    return host === 'news.google.com' ? null : host
  } catch {
    return null
  }
}

/** Scheduled (publication date still ahead). */
export const isFuture = (iso: string, now = Date.now()) => Date.parse(iso) > now
