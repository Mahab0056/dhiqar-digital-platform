import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { CalendarClock, ChevronLeft, Globe2, Info, Mic, MicOff, Search, X } from 'lucide-react'
import { api } from '../../api'
import type { CatalogService } from '../../types'

type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
}

const speechConstructor = (): (new () => SpeechRecognitionLike) | null => {
  const scope = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }
  return scope.SpeechRecognition || scope.webkitSpeechRecognition || null
}

const channelIcon = { ONLINE_SUBMISSION: Globe2, APPOINTMENT_REQUIRED: CalendarClock, INFORMATION_ONLY: Info } as const
const channelShort = { ONLINE_SUBMISSION: 'إلكترونية', APPOINTMENT_REQUIRED: 'إلكترونية + حضور', INFORMATION_ONLY: 'معلوماتية' } as const

/**
 * Smart search box: ranked server search (synonyms + fuzzy), voice input (Web Speech API, ar-IQ), keyboard
 * navigation and a results dropdown. Enter with one result opens it; otherwise goes to the directory.
 */
export function SmartSearch({
  value,
  onChange,
  placeholder = 'ما الخدمة التي تريد إنجازها؟ اكتب أو تكلّم…',
  autoFocus = false,
  variant = 'hero',
  onSubmitQuery,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
  variant?: 'hero' | 'compact'
  /** Called on Enter when no single result is chosen; default navigates to /directory?q= */
  onSubmitQuery?: (query: string) => void
}) {
  const [, navigate] = useLocation()
  const [results, setResults] = useState<CatalogService[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [listening, setListening] = useState(false)
  const [voiceSupported] = useState(() => Boolean(speechConstructor()))
  const [voiceError, setVoiceError] = useState('')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const boxRef = useRef<HTMLFormElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    const term = value.trim()
    if (term.length < 2) {
      setResults([])
      return
    }
    const id = ++requestId.current
    const timer = window.setTimeout(() => {
      api
        .searchServices(term, 7)
        .then(items => {
          if (requestId.current === id) {
            setResults(items)
            // only pop the panel while the citizen is actually in the field (not for a prefilled ?q= on load)
            setOpen(document.activeElement === inputRef.current)
            setActive(-1)
          }
        })
        .catch(() => {})
    }, 160)
    return () => window.clearTimeout(timer)
  }, [value])

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const stopVoice = useCallback(() => {
    recognitionRef.current?.stop()
    setListening(false)
  }, [])

  const startVoice = () => {
    const Ctor = speechConstructor()
    if (!Ctor) return
    setVoiceError('')
    const recognition = new Ctor()
    recognition.lang = 'ar-IQ'
    recognition.interimResults = true
    recognition.continuous = false
    recognition.maxAlternatives = 1
    recognition.onresult = event => {
      let transcript = ''
      for (let index = 0; index < event.results.length; index++) transcript += event.results[index][0].transcript
      onChange(transcript.trim())
    }
    recognition.onerror = event => {
      setListening(false)
      setVoiceError(
        event.error === 'not-allowed'
          ? 'اسمح باستخدام المايكروفون من إعدادات المتصفح.'
          : event.error === 'no-speech'
            ? 'لم يُلتقط أي صوت. حاول مرة أخرى بالقرب من المايكروفون.'
            : 'تعذر التعرف على الصوت. اكتب الخدمة بدلاً من ذلك.'
      )
    }
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    try {
      recognition.start()
      setListening(true)
    } catch {
      setListening(false)
    }
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const term = value.trim()
    if (active >= 0 && results[active]) {
      navigate(`/service/${results[active].key}`)
      setOpen(false)
      return
    }
    if (results.length === 1) {
      navigate(`/service/${results[0].key}`)
      setOpen(false)
      return
    }
    if (onSubmitQuery) onSubmitQuery(term)
    else navigate(`/directory${term ? `?q=${encodeURIComponent(term)}` : ''}`)
    setOpen(false)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || !results.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive(current => (current + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive(current => (current - 1 + results.length) % results.length)
    } else if (event.key === 'Escape') setOpen(false)
  }

  return (
    <form
      className={`gov-search smart-search ${variant} ${listening ? 'is-listening' : ''}`}
      onSubmit={submit}
      role="search"
      ref={boxRef}
    >
      <Search className="gov-search-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        value={value}
        onChange={event => onChange(event.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={listening ? 'أنا أسمعك… قل اسم الخدمة' : placeholder}
        aria-label="ابحث عن خدمة"
        aria-autocomplete="list"
        aria-expanded={open}
        autoComplete="off"
        autoFocus={autoFocus}
        enterKeyHint="search"
      />
      {value && (
        <button type="button" className="gov-search-clear" onClick={() => onChange('')} aria-label="مسح">
          <X size={16} />
        </button>
      )}
      {voiceSupported && (
        <button
          type="button"
          className={`gov-search-voice ${listening ? 'active' : ''}`}
          onClick={listening ? stopVoice : startVoice}
          aria-label={listening ? 'إيقاف الاستماع' : 'البحث بالصوت'}
          title={listening ? 'إيقاف الاستماع' : 'البحث بالصوت'}
        >
          {listening ? <MicOff size={18} /> : <Mic size={18} />}
          {listening && <span className="voice-pulse" aria-hidden="true" />}
        </button>
      )}
      <button type="submit" className="gov-search-submit" aria-label="بحث">
        <Search />
      </button>
      {voiceError && <div className="smart-search-hint error">{voiceError}</div>}
      {open && results.length > 0 && (
        <ul className="gov-search-results" role="listbox">
          {results.map((service, index) => {
            const Icon = channelIcon[service.channel]
            return (
              <li key={service.key} className={index === active ? 'active' : ''} role="option" aria-selected={index === active}>
                <Link href={`/service/${service.key}`} onClick={() => setOpen(false)}>
                  <span className={`gov-chip channel-${service.channel.toLowerCase()}`}>
                    <Icon size={12} /> {channelShort[service.channel]}
                  </span>
                  <strong>{service.title}</strong>
                  <small>{service.departmentName}</small>
                  <ChevronLeft size={16} />
                </Link>
              </li>
            )
          })}
          <li className="gov-search-more">
            <Link href={`/directory?q=${encodeURIComponent(value.trim())}`} onClick={() => setOpen(false)}>
              عرض كل النتائج في دليل الخدمات
            </Link>
          </li>
        </ul>
      )}
    </form>
  )
}
