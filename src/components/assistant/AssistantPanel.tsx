import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import {
  ArrowLeft,
  ArrowUp,
  Building2,
  CalendarClock,
  ClipboardCheck,
  ExternalLink,
  FileText,
  Globe2,
  Info,
  MessageSquareWarning,
  Mic,
  RotateCcw,
  Send,
  ShieldCheck,
  Square,
  UserPlus,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { useSession } from '../../lib/session'
import { AssistantMarkdown } from './AssistantMarkdown'
import { AfandiMark } from './afandi/AfandiMark'
import { AfandiOrb } from './afandi/AfandiOrb'
import { buildSchedule, createOrbVoice, splitWords, type OrbVoice } from './afandi/orbEngine'
import { playAfandiSound, useAfandiMuted } from './afandi/sound'
import { applyAssistantEvent, emptyReply, splitAction, type AssistantAction } from './assistant-reducer'
import { useVoiceConversation } from './voice/useVoiceConversation'
import { VoiceStage } from './voice/VoiceStage'
import { browserTtsSupported, unlockServerAudio } from './voice/speaker'
import {
  getAssistantConfig,
  handDraftToServicePage,
  streamAssistantChat,
  type AssistantChannel,
  type AssistantDraft,
  type AssistantEvent,
  type AssistantVoiceConfig,
  type AssistantRequestSummary,
  type AssistantServiceCard,
  type AssistantTurn,
  type AssistantUiPayload,
} from './assistant-client'

export const ASSISTANT_NAME = 'أفندي — مساعد ذي قار'

type UiMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  ui: AssistantUiPayload[]
  status?: string
  streaming?: boolean
  notice?: string
  error?: string
  /** the question came by voice (shown with a small mic mark) */
  voice?: boolean
}

// v2: v1 conversations may hold answers stored with the repeated text of the old stream handling
const STORAGE_KEY = 'dqa-chat-v2'
const MAX_STORED = 30
const GREETING: UiMessage = {
  id: 'greeting',
  role: 'assistant',
  text: 'هلا بيك، آني **أفندي** — المساعد الآلي لمنصة ذي قار الرقمية. أدلّك على المستمسكات والخطوات لأي خدمة، أفتحلك الخدمة مباشرة، وأتابع وياك معاملاتك. شتحتاج اليوم؟',
  ui: [],
}
const SUGGESTIONS = ['كيف أسجّل؟', 'أريد أطلع جواز', 'شنو المستمسكات لإجازة بناء؟', 'شلون أدفع الرسم؟', 'تابع معاملتي']

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

function readStored(): UiMessage[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null') as UiMessage[] | null
    return Array.isArray(saved) && saved.length ? saved : [GREETING]
  } catch {
    return [GREETING]
  }
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
  const [voiceMode, setVoiceMode] = useState(false)
  const [voiceConfig, setVoiceConfig] = useState<AssistantVoiceConfig>({ transcribe: false, serverTts: false })
  const listRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)
  const promptRef = useRef<string | null>(null)
  const orbRef = useRef<HTMLSpanElement | null>(null)
  const voiceRef = useRef<OrbVoice | null>(null)
  const stageOrbRef = useRef<HTMLSpanElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const stageVoiceRef = useRef<OrbVoice | null>(null)
  const voiceHandlersRef = useRef<ReturnType<typeof useVoiceConversation> | null>(null)
  const [muted, setMuted] = useAfandiMuted()

  useEffect(() => {
    const orb = orbRef.current
    if (!orb) return
    const voice = createOrbVoice(orb)
    voiceRef.current = voice
    return () => {
      voice.destroy()
      voiceRef.current = null
    }
  }, [])

  // the voice stage's own orb: live microphone level while listening, أفندي's voice while he answers
  useEffect(() => {
    const orb = stageOrbRef.current
    if (!voiceMode || !orb) return
    const voice = createOrbVoice(orb)
    stageVoiceRef.current = voice
    return () => {
      voice.destroy()
      stageVoiceRef.current = null
    }
  }, [voiceMode])

  useEffect(() => {
    if (!open || mode) return
    getAssistantConfig()
      .then(config => {
        setMode(config.mode)
        if (config.voice) setVoiceConfig(config.voice)
      })
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
    /** `turn`: the voice turn that asked (voice channel); it comes back with every voice handler call */
    async (raw: string, channel: AssistantChannel = 'text', turn = 0) => {
      const text = raw.trim().slice(0, 2000)
      // a ref, not the state: a double Enter / click (or a re-run effect) in the same frame must not send twice
      if (!text || busyRef.current) return
      busyRef.current = true
      const user: UiMessage = { id: newId(), role: 'user', text, ui: [], voice: channel === 'voice' || undefined }
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
      let finalText = ''
      let failed = false
      // the reply is folded here (outside React state) so the voice can read it as it streams
      let local = emptyReply()
      const onEvent = (event: AssistantEvent) => {
        if (event.type === 'meta') {
          setMode(event.mode)
          return
        }
        local = applyAssistantEvent(local, event)
        if (event.type === 'done') finalText = local.text
        if (event.type === 'error') failed = true
        const snapshot = local
        update(reply.id, message => ({ ...message, ...snapshot }))
        if (channel === 'voice') voiceHandlersRef.current?.onReplyEvent(event, local.text, turn)
      }
      try {
        await streamAssistantChat(history, onEvent, controller.signal, channel)
      } catch (error) {
        failed = true
        if (!controller.signal.aborted)
          update(reply.id, message => ({
            ...message,
            error: error instanceof Error ? error.message : 'تعذر الوصول إلى المساعد.',
          }))
      } finally {
        if (channel === 'voice')
          voiceHandlersRef.current?.onReplyDone({
            text: finalText || local.text,
            ui: local.ui,
            failed: failed || controller.signal.aborted,
            turn,
          })
        update(reply.id, message => ({
          ...message,
          streaming: false,
          status: undefined,
          text: message.text || (controller.signal.aborted ? 'أوقفت الرد.' : message.text),
        }))
        busyRef.current = false
        setBusy(false)
        abortRef.current = null
        if (!controller.signal.aborted && finalText && channel === 'text') {
          voiceRef.current?.burst(finalText.length)
          playAfandiSound('notify')
        }
      }
    },
    [messages]
  )

  useEffect(() => {
    // the ref makes the hand-off idempotent (StrictMode re-runs effects; the parent clears the prompt a render later)
    if (!open || !initialPrompt || busy || promptRef.current === initialPrompt) return
    promptRef.current = initialPrompt
    onInitialPromptUsed?.()
    void send(initialPrompt)
  }, [open, initialPrompt, busy, send, onInitialPromptUsed])
  useEffect(() => {
    if (!initialPrompt) promptRef.current = null
  }, [initialPrompt])

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

  // ---- voice mode ---------------------------------------------------------------------------------------
  const sendRef = useRef(send)
  useLayoutEffect(() => {
    sendRef.current = send
  })
  const voice = useVoiceConversation({
    active: open && voiceMode,
    transcribe: voiceConfig.transcribe,
    serverTts: voiceConfig.serverTts,
    muted,
    send: async (text, channel, turn) => {
      // a reply still streaming (the citizen talked over it) is stopped first; its late end carries its own turn
      abortRef.current?.abort()
      for (let wait = 0; wait < 60 && busyRef.current; wait++) await new Promise(resolve => setTimeout(resolve, 50))
      // still busy (the old stream did not stop): this question was not sent — end its turn instead of «thinking»
      if (busyRef.current) {
        voiceHandlersRef.current?.onReplyDone({ text: '', ui: [], failed: true, turn })
        return
      }
      await sendRef.current(text, channel, turn)
    },
    abort: () => abortRef.current?.abort(),
    onLevel: level => {
      stageRef.current?.style.setProperty('--afd-level', level.toFixed(3))
      if (level > 0) stageVoiceRef.current?.live(level)
      else stageVoiceRef.current?.endLive()
    },
    onSentence: text => stageVoiceRef.current?.speak(buildSchedule(splitWords(text), { lead: 0 })),
  })
  useLayoutEffect(() => {
    voiceHandlersRef.current = voice
  })

  const enterVoice = useCallback(() => {
    // iOS / Safari only let speech play after a press: a silent utterance inside this press unlocks it
    if (browserTtsSupported())
      try {
        const unlock = new SpeechSynthesisUtterance(' ')
        unlock.volume = 0
        window.speechSynthesis.speak(unlock)
      } catch {
        /* no speech synthesis */
      }
    // the optional server voice plays on one element that must first play inside this press (iOS)
    if (voiceConfig.serverTts) unlockServerAudio()
    setVoiceMode(true)
  }, [voiceConfig.serverTts])

  const leaveVoice = useCallback(() => {
    setVoiceMode(false)
    window.setTimeout(() => inputRef.current?.focus(), 30)
  }, [])

  // Alt+M: talk to أفندي from anywhere in the panel (layout-independent: the physical M key)
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.code !== 'KeyM') return
      event.preventDefault()
      if (!voiceMode) enterVoice()
      else voiceHandlersRef.current?.toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, voiceMode, enterVoice])

  const lastAssistantId = [...messages].reverse().find(message => message.role === 'assistant')?.id
  const answerChip = (option: string) => {
    if (voiceMode) voice.sendFromChip(option)
    else void send(option)
  }

  const onlyGreeting = messages.length === 1 && messages[0].id === GREETING.id

  return (
    <section
      className={`dqa-panel${open ? ' is-open' : ''}`}
      role="dialog"
      aria-modal="false"
      aria-label={ASSISTANT_NAME}
      hidden={!open}
    >
      <header className="dqa-head">
        <span className="dqa-avatar afd-head-orb">
          <AfandiOrb ref={orbRef} state={busy ? 'typing' : 'idle'} rest={!open} markSize={30} />
        </span>
        <div className="dqa-head-text">
          <strong>
            أفندي <span className="afd-head-sub">— مساعد ذي قار</span>
          </strong>
          <small className={`dqa-mode ${mode === 'fallback' ? 'is-basic' : ''}`}>
            <i aria-hidden="true" />
            {mode === 'fallback' ? 'بحث سريع في دليل الخدمات' : mode === 'ai' ? 'متصل — ذكاء اصطناعي' : 'جارٍ الاتصال…'}
          </small>
        </div>
        <button
          type="button"
          className="dqa-icon-button"
          onClick={() => setMuted(!muted)}
          aria-label={muted ? 'تشغيل أصوات أفندي' : 'كتم أصوات أفندي'}
          aria-pressed={muted}
          title={muted ? 'تشغيل الصوت' : 'كتم الصوت'}
        >
          {muted ? <VolumeX /> : <Volume2 />}
        </button>
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
              <AssistantReply
                message={message}
                isLast={message.id === lastAssistantId}
                busy={busy}
                isCitizen={isCitizen}
                go={go}
                onNavigate={closeOnPhone}
                onChip={answerChip}
              />
            ) : (
              <div className="dqa-bubble">
                {message.voice && <Mic className="dqa-voice-mark" aria-label="بالصوت" />}
                {message.text}
              </div>
            )}
          </article>
        ))}
        {onlyGreeting && (
          <div className="dqa-chips" aria-label="اقتراحات">
            {SUGGESTIONS.map(suggestion => (
              <button key={suggestion} type="button" onClick={() => answerChip(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>

      {voiceMode ? (
        <VoiceStage
          orbRef={stageOrbRef}
          stageRef={stageRef}
          phase={voice.phase}
          partial={voice.partial}
          message={voice.message}
          engine={voice.engine}
          provider={voiceConfig.provider ?? null}
          serverVoice={voiceConfig.serverTts}
          textOnly={voice.textOnly}
          continuous={voice.continuous}
          onContinuous={voice.setContinuous}
          onPressStart={voice.pressStart}
          onPressEnd={voice.pressEnd}
          onToggle={voice.toggle}
          onSkip={voice.stopSpeaking}
          onKeyboard={leaveVoice}
          onAccept={voice.acceptConsent}
          onDecline={() => {
            voice.declineConsent()
            leaveVoice()
          }}
        />
      ) : (
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
            placeholder="اكتب سؤالك… مثلاً: شنو مستمسكات إجازة السوق؟"
            aria-label="رسالتك للمساعد"
            onChange={event => setInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void send(input)
              }
            }}
          />
          <button
            type="button"
            className="dqa-icon-button dqa-mic"
            onClick={enterVoice}
            aria-label="تكلّم مع أفندي بالصوت"
            aria-keyshortcuts="Alt+M"
            title="تكلّم مع أفندي (Alt+M)"
          >
            <Mic />
          </button>
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
      )}
      <p className="dqa-foot">
        <ShieldCheck aria-hidden="true" />{' '}
        {voiceMode
          ? 'لا تقول رمز التحقق أو رقم هويتك بصوت. المساعد قد يخطئ؛ القرار للدائرة.'
          : 'لا تكتب رمز التحقق أو كلمة المرور هنا. المساعد قد يخطئ؛ القرار للدائرة.'}
      </p>
    </section>
  )
}

/** One answer of أفندي: the text, a clarifying question's chips, the cards, and the single primary action. */
function AssistantReply({
  message,
  isLast,
  busy,
  isCitizen,
  go,
  onNavigate,
  onChip,
}: {
  message: UiMessage
  isLast: boolean
  busy: boolean
  isCitizen: boolean
  go: (path: string) => void
  onNavigate: () => void
  onChip: (option: string) => void
}) {
  const { body, action } = message.streaming ? { body: message.text, action: null } : splitAction(message.text)
  const clarify = message.ui.find(item => item.kind === 'clarify') as
    Extract<AssistantUiPayload, { kind: 'clarify' }> | undefined
  return (
    <>
      {message.notice && <p className="dqa-notice">{message.notice}</p>}
      {body ? (
        <div className="dqa-bubble">
          <AssistantMarkdown text={body} onNavigate={onNavigate} />
          {message.streaming && <span className="dqa-caret" aria-hidden="true" />}
        </div>
      ) : message.streaming ? (
        <div className="dqa-bubble dqa-typing" role="status" aria-label="أفندي يكتب">
          <AfandiMark size={22} motion="typing" className="afd-typing-mark" />
          <span />
          <span />
          <span />
          {message.status && <em>{message.status}</em>}
        </div>
      ) : null}
      {message.status && message.text && <p className="dqa-status">{message.status}</p>}
      {clarify && isLast && !busy && (
        <div className="dqa-chips dqa-clarify" role="group" aria-label={clarify.question}>
          {clarify.options.map(option => (
            <button key={option} type="button" onClick={() => onChip(option)}>
              {option}
            </button>
          ))}
        </div>
      )}
      {action && <ActionCard action={action} go={go} />}
      {message.ui.map((payload, index) =>
        payload.kind === 'clarify' ? null : (
          <UiBlock
            key={`${payload.kind}-${index}`}
            payload={payload}
            isCitizen={isCitizen}
            go={go}
            hasAction={Boolean(action)}
          />
        )
      )}
      {message.error && (
        <p className="dqa-error" role="alert">
          {message.error}
        </p>
      )}
    </>
  )
}

function ActionIcon({ path }: { path: string }) {
  if (path.startsWith('/onboarding')) return <UserPlus />
  if (path.startsWith('/citizen/feedback')) return <MessageSquareWarning />
  if (path.startsWith('/citizen')) return <ClipboardCheck />
  if (path.startsWith('/service/')) return <FileText />
  if (path.startsWith('/departments')) return <Building2 />
  return <ExternalLink />
}

/** The answer's single primary next step, as a button card. */
function ActionCard({ action, go }: { action: AssistantAction; go: (path: string) => void }) {
  return (
    <div className="dqa-card dqa-action">
      <span className="dqa-card-icon" aria-hidden="true">
        <ActionIcon path={action.path} />
      </span>
      <small>الخطوة الجاية</small>
      <button type="button" className="dqa-btn is-primary" onClick={() => go(action.path)}>
        {action.label}
        <ArrowLeft aria-hidden="true" />
      </button>
    </div>
  )
}

function UiBlock({
  payload,
  isCitizen,
  go,
  hasAction,
}: {
  payload: AssistantUiPayload
  isCitizen: boolean
  go: (path: string) => void
  hasAction: boolean
}) {
  if (payload.kind === 'services')
    return (
      <div className="dqa-cards">
        {payload.items.map(item => (
          <ServiceCard key={item.key} item={item} isCitizen={isCitizen} go={go} secondary={hasAction} />
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
  if (payload.kind === 'clarify') return null
  return (
    <div className="dqa-card dqa-card-cta">
      <UserPlus aria-hidden="true" />
      <div>
        <strong>حساب واحد لكل خدمات ذي قار</strong>
        <small>الهاتف ← البطاقة الوطنية ← الاسم ← فيديو الوجه</small>
      </div>
      {!hasAction && (
        <button type="button" className="dqa-btn is-primary" onClick={() => go('/onboarding')}>
          ابدأ التسجيل
        </button>
      )}
    </div>
  )
}

function ServiceCard({
  item,
  isCitizen,
  go,
  secondary,
}: {
  item: AssistantServiceCard
  isCitizen: boolean
  go: (path: string) => void
  /** the answer already has its primary action: the card keeps only «افتح الخدمة» */
  secondary: boolean
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
        {item.channel !== 'INFORMATION_ONLY' && !secondary && (
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
