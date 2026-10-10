import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import {
  ArrowUp,
  Building2,
  CalendarClock,
  ClipboardCheck,
  ExternalLink,
  FileText,
  Globe2,
  Info,
  Mic,
  MicOff,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  UserPlus,
  X,
} from 'lucide-react'
import { useSession } from '../../lib/session'
import { AssistantMarkdown } from './AssistantMarkdown'
import {
  getAssistantConfig,
  handDraftToServicePage,
  streamAssistantChat,
  type AssistantDraft,
  type AssistantEvent,
  type AssistantRequestSummary,
  type AssistantServiceCard,
  type AssistantTurn,
  type AssistantUiPayload,
} from './assistant-client'

type UiMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  ui: AssistantUiPayload[]
  status?: string
  streaming?: boolean
  notice?: string
  error?: string
}

const STORAGE_KEY = 'dqa-chat-v1'
const MAX_STORED = 30
const GREETING: UiMessage = {
  id: 'greeting',
  role: 'assistant',
  text: 'هلا بيك، آني **مساعد ذي قار الآلي**. أدلّك على المستمسكات والخطوات لأي خدمة، أفتحلك الخدمة مباشرة، وأتابع وياك معاملاتك. شتحتاج اليوم؟',
  ui: [],
}
const SUGGESTIONS = ['كيف أسجّل؟', 'أريد أطلع جواز', 'شنو المستمسكات لإجازة بناء؟', 'تابع معاملتي']

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

function readStored(): UiMessage[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null') as UiMessage[] | null
    return Array.isArray(saved) && saved.length ? saved : [GREETING]
  } catch {
    return [GREETING]
  }
}

/** Several tool results of one answer become one set of cards (newest first, no duplicates). */
function mergeUi(list: AssistantUiPayload[], payload: AssistantUiPayload): AssistantUiPayload[] {
  if (payload.kind === 'services') {
    const previous = list.find(item => item.kind === 'services') as
      Extract<AssistantUiPayload, { kind: 'services' }> | undefined
    const items = [...payload.items, ...(previous?.items || [])].filter(
      (item, index, all) => all.findIndex(other => other.key === item.key) === index
    )
    return [...list.filter(item => item.kind !== 'services'), { kind: 'services', items: items.slice(0, 3) }]
  }
  if (payload.kind === 'registration' && list.some(item => item.kind === 'registration')) return list
  return [...list.filter(item => item.kind !== payload.kind), payload]
}

type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
}
const speechConstructor = (): (new () => SpeechRecognitionLike) | null => {
  if (typeof window === 'undefined') return null
  const scope = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return scope.SpeechRecognition || scope.webkitSpeechRecognition || null
}

const channelIcon = { ONLINE_SUBMISSION: Globe2, APPOINTMENT_REQUIRED: CalendarClock, INFORMATION_ONLY: Info } as const

export function AssistantPanel({
  open,
  onClose,
  initialPrompt,
  onInitialPromptUsed,
}: {
  open: boolean
  onClose: () => void
  initialPrompt?: string | null
  onInitialPromptUsed?: () => void
}) {
  const [, navigate] = useLocation()
  const { session } = useSession()
  const isCitizen = session?.role === 'CITIZEN'
  const [messages, setMessages] = useState<UiMessage[]>(readStored)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'ai' | 'fallback' | null>(null)
  const [listening, setListening] = useState(false)
  const [voiceSupported] = useState(() => Boolean(speechConstructor()))
  const listRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  useEffect(() => {
    if (!open || mode) return
    getAssistantConfig()
      .then(config => setMode(config.mode))
      .catch(() => setMode('fallback'))
  }, [open, mode])

  // keep the conversation for this tab (finished messages only), capped
  useEffect(() => {
    if (busy) return
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(
          messages.slice(-MAX_STORED).map(message => ({ ...message, streaming: false, status: undefined }))
        )
      )
    } catch {
      /* storage blocked: the chat still works for this page */
    }
  }, [messages, busy])

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    // keep the latest question and the start of its answer in view; long answers are read from the top
    const questions = list.querySelectorAll<HTMLElement>('.dqa-msg.is-user')
    const lastQuestion = questions[questions.length - 1]
    list.scrollTop = lastQuestion ? Math.max(0, lastQuestion.offsetTop - 12) : list.scrollHeight
  }, [messages, open])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  useEffect(() => () => abortRef.current?.abort(), [])

  const closeOnPhone = useCallback(() => {
    if (window.matchMedia('(max-width: 640px)').matches) onClose()
  }, [onClose])

  const go = useCallback(
    (path: string) => {
      navigate(path)
      closeOnPhone()
    },
    [navigate, closeOnPhone]
  )

  const update = (id: string, change: (message: UiMessage) => UiMessage) =>
    setMessages(current => current.map(message => (message.id === id ? change(message) : message)))

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim().slice(0, 2000)
      if (!text || busy) return
      const user: UiMessage = { id: newId(), role: 'user', text, ui: [] }
      const reply: UiMessage = { id: newId(), role: 'assistant', text: '', ui: [], streaming: true }
      const history: AssistantTurn[] = [...messages.filter(message => message.id !== GREETING.id), user]
        .filter(message => message.text.trim() && !message.error)
        .slice(-16)
        .map(message => ({ role: message.role, text: message.text }))
      setMessages(current => [...current, user, reply])
      setInput('')
      setBusy(true)
      const controller = new AbortController()
      abortRef.current = controller
      const onEvent = (event: AssistantEvent) => {
        switch (event.type) {
          case 'meta':
            setMode(event.mode)
            break
          case 'text':
            update(reply.id, message => ({ ...message, text: message.text + event.delta, status: undefined }))
            break
          case 'status':
            update(reply.id, message => ({ ...message, status: event.label }))
            break
          case 'ui':
            update(reply.id, message => ({ ...message, ui: mergeUi(message.ui, event.payload) }))
            break
          case 'reset':
            update(reply.id, message => ({ ...message, text: '', ui: [] }))
            break
          case 'notice':
            update(reply.id, message => ({ ...message, notice: event.message }))
            break
          case 'error':
            update(reply.id, message => ({ ...message, error: event.message }))
            break
        }
      }
      try {
        await streamAssistantChat(history, onEvent, controller.signal)
      } catch (error) {
        if (!controller.signal.aborted)
          update(reply.id, message => ({
            ...message,
            error: error instanceof Error ? error.message : 'تعذر الوصول إلى المساعد.',
          }))
      } finally {
        update(reply.id, message => ({
          ...message,
          streaming: false,
          status: undefined,
          text: message.text || (controller.signal.aborted ? 'أوقفت الرد.' : message.text),
        }))
        setBusy(false)
        abortRef.current = null
      }
    },
    [busy, messages]
  )

  useEffect(() => {
    if (open && initialPrompt && !busy) {
      onInitialPromptUsed?.()
      void send(initialPrompt)
    }
  }, [open, initialPrompt, busy, send, onInitialPromptUsed])

  const reset = () => {
    abortRef.current?.abort()
    setMessages([GREETING])
    setInput('')
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      /* nothing stored */
    }
    inputRef.current?.focus()
  }

  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const Speech = speechConstructor()
    if (!Speech) return
    const recognition = new Speech()
    recognition.lang = 'ar-IQ'
    recognition.interimResults = true
    recognition.continuous = false
    recognition.maxAlternatives = 1
    recognition.onresult = event => {
      const transcript = Array.from(event.results)
        .map(result => result[0]?.transcript || '')
        .join(' ')
      setInput(transcript.slice(0, 2000))
    }
    recognition.onend = () => setListening(false)
    recognition.onerror = () => setListening(false)
    recognitionRef.current = recognition
    try {
      recognition.start()
      setListening(true)
    } catch {
      setListening(false)
    }
  }

  const onlyGreeting = messages.length === 1 && messages[0].id === GREETING.id

  return (
    <section
      className={`dqa-panel${open ? ' is-open' : ''}`}
      role="dialog"
      aria-modal="false"
      aria-label="مساعد ذي قار الآلي"
      hidden={!open}
    >
      <header className="dqa-head">
        <span className="dqa-avatar" aria-hidden="true">
          <Sparkles />
        </span>
        <div className="dqa-head-text">
          <strong>مساعد ذي قار الآلي</strong>
          <small className={`dqa-mode ${mode === 'fallback' ? 'is-basic' : ''}`}>
            <i aria-hidden="true" />
            {mode === 'fallback'
              ? 'وضع البحث السريع في دليل الخدمات'
              : mode === 'ai'
                ? 'متصل — ذكاء اصطناعي'
                : 'جارٍ الاتصال…'}
          </small>
        </div>
        <button
          type="button"
          className="dqa-icon-button"
          onClick={reset}
          aria-label="محادثة جديدة"
          title="محادثة جديدة"
        >
          <RotateCcw />
        </button>
        <button type="button" className="dqa-icon-button" onClick={onClose} aria-label="إغلاق المساعد" title="إغلاق">
          <X />
        </button>
      </header>

      <div className="dqa-list" ref={listRef} aria-live="polite" aria-busy={busy}>
        {messages.map(message => (
          <article key={message.id} className={`dqa-msg is-${message.role}`}>
            {message.role === 'assistant' ? (
              <>
                {message.notice && <p className="dqa-notice">{message.notice}</p>}
                {message.text ? (
                  <div className="dqa-bubble">
                    <AssistantMarkdown text={message.text} onNavigate={closeOnPhone} />
                    {message.streaming && <span className="dqa-caret" aria-hidden="true" />}
                  </div>
                ) : message.streaming ? (
                  <div className="dqa-bubble dqa-typing" aria-label="المساعد يكتب">
                    <span />
                    <span />
                    <span />
                    {message.status && <em>{message.status}</em>}
                  </div>
                ) : null}
                {message.status && message.text && <p className="dqa-status">{message.status}</p>}
                {message.ui.map((payload, index) => (
                  <UiBlock key={`${payload.kind}-${index}`} payload={payload} isCitizen={isCitizen} go={go} />
                ))}
                {message.error && (
                  <p className="dqa-error" role="alert">
                    {message.error}
                  </p>
                )}
              </>
            ) : (
              <div className="dqa-bubble">{message.text}</div>
            )}
          </article>
        ))}
        {onlyGreeting && (
          <div className="dqa-chips" aria-label="اقتراحات">
            {SUGGESTIONS.map(suggestion => (
              <button key={suggestion} type="button" onClick={() => void send(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>

      <form
        className="dqa-composer"
        onSubmit={event => {
          event.preventDefault()
          void send(input)
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          rows={1}
          maxLength={2000}
          placeholder={listening ? 'أسمعك… تكلّم' : 'اكتب سؤالك… مثلاً: شنو مستمسكات إجازة السوق؟'}
          aria-label="رسالتك للمساعد"
          onChange={event => setInput(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void send(input)
            }
          }}
        />
        {voiceSupported && (
          <button
            type="button"
            className={`dqa-icon-button dqa-mic${listening ? ' is-on' : ''}`}
            onClick={toggleVoice}
            aria-label={listening ? 'إيقاف الإدخال الصوتي' : 'تكلّم بدل الكتابة'}
            aria-pressed={listening}
          >
            {listening ? <MicOff /> : <Mic />}
          </button>
        )}
        {busy ? (
          <button
            type="button"
            className="dqa-send is-stop"
            onClick={() => abortRef.current?.abort()}
            aria-label="إيقاف الرد"
          >
            <Square />
          </button>
        ) : (
          <button type="submit" className="dqa-send" disabled={!input.trim()} aria-label="إرسال">
            {input.trim() ? <ArrowUp /> : <Send />}
          </button>
        )}
      </form>
      <p className="dqa-foot">
        <ShieldCheck aria-hidden="true" /> لا تكتب رمز التحقق أو كلمة المرور هنا. المساعد قد يخطئ؛ القرار للدائرة.
      </p>
    </section>
  )
}

function UiBlock({
  payload,
  isCitizen,
  go,
}: {
  payload: AssistantUiPayload
  isCitizen: boolean
  go: (path: string) => void
}) {
  if (payload.kind === 'services')
    return (
      <div className="dqa-cards">
        {payload.items.map(item => (
          <ServiceCard key={item.key} item={item} isCitizen={isCitizen} go={go} />
        ))}
      </div>
    )
  if (payload.kind === 'requests')
    return (
      <div className="dqa-cards">
        {payload.items.map(item => (
          <RequestCard key={item.reference} item={item} go={go} />
        ))}
      </div>
    )
  if (payload.kind === 'draft') return <DraftCard draft={payload.draft} go={go} />
  return (
    <div className="dqa-card dqa-card-cta">
      <UserPlus aria-hidden="true" />
      <div>
        <strong>حساب واحد لكل خدمات ذي قار</strong>
        <small>الهاتف ← البطاقة الوطنية ← الاسم ← فيديو الوجه</small>
      </div>
      <button type="button" className="dqa-btn is-primary" onClick={() => go('/onboarding')}>
        ابدأ التسجيل
      </button>
    </div>
  )
}

function ServiceCard({
  item,
  isCitizen,
  go,
}: {
  item: AssistantServiceCard
  isCitizen: boolean
  go: (path: string) => void
}) {
  const Icon = channelIcon[item.channel] || Info
  const servicePath = `/service/${encodeURIComponent(item.key)}`
  const startPath = isCitizen ? servicePath : `/onboarding?continue=${encodeURIComponent(servicePath)}`
  const extra = item.documents.length - 4
  return (
    <div className="dqa-card">
      <div className="dqa-card-top">
        <span className="dqa-card-icon" aria-hidden="true">
          <FileText />
        </span>
        <div>
          <strong>{item.title}</strong>
          <small>
            <Building2 aria-hidden="true" /> {item.departmentName}
          </small>
        </div>
      </div>
      <div className="dqa-tags">
        <span className={`dqa-tag is-${item.channel.toLowerCase()}`}>
          <Icon aria-hidden="true" /> {item.channelLabel}
        </span>
        {item.feeLabel && <span className="dqa-tag">الرسم {item.feeLabel}</span>}
        {item.estimatedDuration && <span className="dqa-tag">{item.estimatedDuration}</span>}
      </div>
      {item.documents.length > 0 && (
        <ul className="dqa-docs" aria-label="المستمسكات">
          {item.documents.slice(0, 4).map(doc => (
            <li key={doc.label}>
              {doc.label}
              {!doc.required && <em> (اختياري)</em>}
            </li>
          ))}
          {extra > 0 && <li className="dqa-more">و{extra.toLocaleString('en-US')} مستمسكات أخرى في صفحة الخدمة</li>}
        </ul>
      )}
      <div className="dqa-actions">
        <button type="button" className="dqa-btn" onClick={() => go(servicePath)}>
          <ExternalLink aria-hidden="true" /> افتح الخدمة
        </button>
        {item.channel !== 'INFORMATION_ONLY' && (
          <button type="button" className="dqa-btn is-primary" onClick={() => go(startPath)}>
            ابدأ الطلب
          </button>
        )}
      </div>
    </div>
  )
}

function RequestCard({ item, go }: { item: AssistantRequestSummary; go: (path: string) => void }) {
  const tone =
    item.status === 'APPROVED'
      ? 'done'
      : item.status === 'REJECTED'
        ? 'rejected'
        : ['ACTION_REQUIRED', 'PAYMENT_PENDING'].includes(item.status)
          ? 'action'
          : 'progress'
  return (
    <div className="dqa-card">
      <div className="dqa-card-top">
        <span className="dqa-card-icon" aria-hidden="true">
          <ClipboardCheck />
        </span>
        <div>
          <strong>{item.serviceName}</strong>
          <small>
            <bdi dir="ltr">{item.reference}</bdi> • {item.departmentName}
          </small>
        </div>
      </div>
      <span className={`dqa-status-pill is-${tone}`}>{item.statusLabel}</span>
      {item.currentAction && <p className="dqa-card-text">{item.currentAction}</p>}
      {item.missingDocuments.length > 0 && <p className="dqa-missing">ناقصة بس: {item.missingDocuments.join('، ')}</p>}
      <div className="dqa-actions">
        <button
          type="button"
          className="dqa-btn is-primary"
          onClick={() => go(`/citizen/request/${encodeURIComponent(item.reference)}`)}
        >
          افتح الطلب
        </button>
      </div>
    </div>
  )
}

function DraftCard({ draft, go }: { draft: AssistantDraft; go: (path: string) => void }) {
  return (
    <div className="dqa-card dqa-draft">
      <div className="dqa-draft-flag">مسودة — لم يُرسل أي شيء بعد</div>
      <strong>{draft.serviceTitle}</strong>
      <small className="dqa-card-sub">{draft.departmentName}</small>
      {draft.answers.length > 0 && (
        <dl className="dqa-answers">
          {draft.answers.map(answer => (
            <div key={answer.key}>
              <dt>{answer.label}</dt>
              <dd>{answer.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {draft.missingFields.length > 0 && (
        <p className="dqa-missing">تكملها بصفحة الخدمة: {draft.missingFields.join('، ')}</p>
      )}
      {draft.documents.length > 0 && (
        <p className="dqa-card-text">
          المرفقات المطلوبة: {draft.documents.map(doc => `${doc.label}${doc.required ? '' : ' (اختياري)'}`).join('، ')}
        </p>
      )}
      <div className="dqa-actions">
        <button
          type="button"
          className="dqa-btn is-primary"
          onClick={() => {
            handDraftToServicePage(draft)
            go(`/service/${encodeURIComponent(draft.serviceKey)}`)
          }}
        >
          <ClipboardCheck aria-hidden="true" /> مراجعة وإرسال
        </button>
      </div>
      <small className="dqa-card-sub">تراجع البيانات وترفق المستمسكات وتضغط إرسال بنفسك من صفحة الخدمة.</small>
    </div>
  )
}
