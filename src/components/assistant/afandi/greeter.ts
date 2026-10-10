/**
 * أفندي greeter — rules (no React). Modelled on the owner's أفندي greeter (barmjini-site greeter/gate.ts +
 * greeterRules.ts): a short greeting bubble grows out of the orb on the first visit, never on forms, at most once per
 * browser session, and a «لا شكراً» keeps it quiet for a week. Every storage access is guarded; blocked storage = no
 * greeting at all (never a greeting on every page).
 *
 *   sessionStorage dqa-greeter        "1" — a greeting was shown this session
 *   sessionStorage dqa-chat-opened    "1" — the chat was opened this session (no greeting needed any more)
 *   sessionStorage dqa-orb-arrived    "1" — the orb's arrival flourish played
 *   localStorage   dqa-greeter-quiet  epoch ms until which the greeter stays quiet («لا شكراً»)
 */
export const GREETER_KEY = 'dqa-greeter'
export const CHAT_OPENED_KEY = 'dqa-chat-opened'
export const ARRIVED_KEY = 'dqa-orb-arrived'
export const QUIET_KEY = 'dqa-greeter-quiet'
export const QUIET_DAYS = 7

export type GreeterKind = 'home' | 'services' | 'departments' | 'news' | 'tenders' | 'guides' | 'citizen'

/** Pages that may greet: browsing pages only — never forms, sign-in, payment, identity capture or staff tools. */
export function greeterKind(path: string): GreeterKind | null {
  const p = (path.split(/[?#]/)[0] || '/').replace(/\/+$/, '') || '/'
  if (p === '/') return 'home'
  if (p === '/directory' || p.startsWith('/government-services/')) return 'services'
  if (p === '/departments' || /^\/departments\/[^/]+$/.test(p)) return 'departments'
  if (p === '/news') return 'news'
  if (p === '/tenders' || /^\/tenders\/[^/]+$/.test(p)) return 'tenders'
  if (p === '/guides') return 'guides'
  if (p === '/citizen') return 'citizen'
  return null
}

/** Short, page-aware lines (Iraqi-friendly Arabic). The first sentence is what the voice reads. */
export const GREETER_COPY: Record<GreeterKind, { line: string; prompt?: string }> = {
  home: {
    line: 'هلا بيك! آني أفندي، مساعد منصة ذي قار. أدلّك على أي خدمة: شنو المستمسكات، شنو الخطوات، ووين تراجع.',
  },
  services: {
    line: 'تدوّر على خدمة؟ اكتبلي اسمها بكلامك، وأطلعلك المستمسكات والخطوات وأفتحلك الخدمة.',
  },
  departments: { line: 'تريد تعرف وين الدائرة أو شنو خدماتها؟ اسألني وأدلّك عليها.' },
  news: { line: 'هلا بيك! إذا عندك سؤال عن خدمة أو معاملة، آني أفندي وحاضر أساعدك.' },
  tenders: { line: 'هلا بيك! أكدر أدلّك على صفحة المناقصات وأي خدمة بالمنصة. اسألني بكلامك.' },
  guides: { line: 'تريد أختصرلك الشرح؟ اسألني أي سؤال عن التسجيل أو الخدمات وأجاوبك بسطرين.' },
  citizen: { line: 'أتابع وياك معاملاتك. اسألني: شنو صار بطلبي؟', prompt: 'شنو صار بطلباتي؟' },
}

const session = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}
const local = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** May this page view greet on its own? */
export function canGreet(path: string, now = Date.now()): GreeterKind | null {
  const kind = greeterKind(path)
  const store = session()
  if (!kind || !store) return null
  try {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    if (connection?.saveData) return null
    if (store.getItem(GREETER_KEY) || store.getItem(CHAT_OPENED_KEY)) return null
    const quiet = Number(local()?.getItem(QUIET_KEY) || 0)
    if (quiet && quiet > now) return null
    return kind
  } catch {
    return null
  }
}

export function markGreeted() {
  try {
    session()?.setItem(GREETER_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function markChatOpened() {
  try {
    session()?.setItem(CHAT_OPENED_KEY, '1')
  } catch {
    /* ignore */
  }
}

/** «لا شكراً»: no greeting for QUIET_DAYS. */
export function quietGreeter(now = Date.now()) {
  try {
    local()?.setItem(QUIET_KEY, String(now + QUIET_DAYS * 86_400_000))
  } catch {
    /* ignore */
  }
}

/** Has the orb's arrival played this session? Blocked storage counts as yes (the orb simply sits there). */
export function hasArrived() {
  try {
    const store = session()
    return !store || store.getItem(ARRIVED_KEY) === '1'
  } catch {
    return true
  }
}

export function markArrived() {
  try {
    session()?.setItem(ARRIVED_KEY, '1')
  } catch {
    /* ignore */
  }
}

/** An Arabic system voice for the optional spoken greeting (null = no voice button). */
export function arabicVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null
  const voices = window.speechSynthesis.getVoices()
  return (
    voices.find(voice => /^ar[-_]IQ/i.test(voice.lang)) ||
    voices.find(voice => /^ar[-_]/i.test(voice.lang)) ||
    voices.find(voice => /^ar$/i.test(voice.lang)) ||
    null
  )
}
