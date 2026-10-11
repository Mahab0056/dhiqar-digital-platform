// أفندي in voice mode on a device with no Arabic voice (Windows Chrome: English / European voices only): the answer is
// never read by a wrong-language voice (nor by the server voice's browser fallback), the turn still ends so the
// conversation goes on, and the voice stage says up front «جهازك ما بيه صوت عربي؛ الأجوبة تظهر كتابة».
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const server = vi.hoisted(() => ({ fetchServerSpeech: vi.fn() }))
vi.mock('../src/components/assistant/assistant-client', () => ({
  fetchServerSpeech: server.fetchServerSpeech,
}))

type FakeVoice = { lang: string; name: string; localService: boolean; default: boolean; voiceURI: string }
const voice = (lang: string, name: string): FakeVoice => ({
  lang,
  name,
  localService: true,
  default: false,
  voiceURI: name,
})
const WINDOWS_CHROME = [
  voice('en-US', 'Microsoft David - English (United States)'),
  voice('en-US', 'Microsoft Zira - English (United States)'),
  voice('de-DE', 'Google Deutsch'),
  voice('en-GB', 'Google UK English Female'),
]
const WITH_ARABIC = [...WINDOWS_CHROME, voice('ar-SA', 'Microsoft Hamed Online (Natural) - Arabic (Saudi Arabia)')]

class FakeUtterance {
  voice: unknown = null
  lang = ''
  rate = 1
  pitch = 1
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public text: string) {}
}

let voices: FakeVoice[] = []
const synth = {
  queue: [] as FakeUtterance[],
  paused: false,
  speak(utterance: FakeUtterance) {
    this.queue.push(utterance)
  },
  cancel() {
    for (const utterance of this.queue.splice(0)) utterance.onerror?.()
  },
  resume() {},
  getVoices: () => voices,
  addEventListener() {},
  removeEventListener() {},
}
const playNext = () => {
  const utterance = synth.queue.shift()
  utterance?.onstart?.()
  utterance?.onend?.()
  return utterance ?? null
}
const flush = async () => {
  for (let index = 0; index < 20; index++) await Promise.resolve()
}

const globals = globalThis as unknown as Record<string, unknown>
const speakerModule = () => import('../src/components/assistant/voice/speaker')
const arabicModule = () => import('../src/components/assistant/voice/arabic-voice')

describe('the answer voice on this device', () => {
  beforeAll(() => {
    globals.window = { speechSynthesis: synth }
    globals.SpeechSynthesisUtterance = FakeUtterance
  })
  afterAll(() => {
    delete globals.window
    delete globals.SpeechSynthesisUtterance
  })
  beforeEach(() => {
    synth.queue.length = 0
    server.fetchServerSpeech.mockReset()
  })

  it('knows whether the browser can read Arabic (the list loads late; a grown list is looked at again)', async () => {
    const { arabicVoice } = await speakerModule()
    const { arabicSpeechNow } = await arabicModule()
    voices = []
    expect(arabicSpeechNow(true)).toBe('unknown')
    expect(arabicVoice()).toBeUndefined()
    voices = WINDOWS_CHROME
    expect(arabicSpeechNow(true)).toBe('no')
    expect(arabicVoice()).toBeNull()
    // the Arabic voice arrives later (Edge's online voices): the speaker is not stuck on the first «none»
    voices = WITH_ARABIC
    expect(arabicSpeechNow(true)).toBe('yes')
    expect((arabicVoice() as FakeVoice | null)?.lang).toBe('ar-SA')
    // no speech synthesis at all: no voice
    expect(arabicSpeechNow(false)).toBe('no')
  })

  it('answers are text only when there is no Arabic voice and no server voice', async () => {
    const { answerVoice } = await arabicModule()
    expect(answerVoice({ serverTts: false, arabic: 'no' })).toBe('text')
    expect(answerVoice({ serverTts: false, arabic: 'yes' })).toBe('browser')
    // still loading: the browser is asked for lang="ar" (it picks its own Arabic voice if it has one)
    expect(answerVoice({ serverTts: false, arabic: 'unknown' })).toBe('browser')
    expect(answerVoice({ serverTts: true, arabic: 'no' })).toBe('server')
  })

  it('never reads an Arabic answer with an English voice — and the turn still ends', async () => {
    const { createSpeaker } = await speakerModule()
    voices = WINDOWS_CHROME
    const events: string[] = []
    const speaker = createSpeaker({
      serverTts: false,
      handlers: { onStart: () => events.push('start'), onEnd: reason => events.push(`end:${reason}`) },
    })
    speaker.feed('تكدر تجدد جوازك من المنصة. ')
    speaker.finish('تكدر تجدد جوازك من المنصة. وبعدها تراجع بموعد.')
    expect(synth.queue).toHaveLength(0)
    expect(events).toEqual(['end:done'])
    expect(speaker.speaking).toBe(false)
  })

  it('the server voice failing is not covered by a wrong-language browser voice', async () => {
    const { createSpeaker } = await speakerModule()
    voices = WINDOWS_CHROME
    server.fetchServerSpeech.mockRejectedValue(new Error('429'))
    const events: string[] = []
    const speaker = createSpeaker({
      serverTts: true,
      handlers: { onStart: () => events.push('start'), onEnd: reason => events.push(`end:${reason}`) },
    })
    speaker.feed('الجواب من المنصة. ')
    speaker.finish('الجواب من المنصة.')
    await flush()
    expect(synth.queue).toHaveLength(0)
    expect(events).toEqual(['end:done'])
  })

  it('with an Arabic voice the answer is read by that voice', async () => {
    const { createSpeaker } = await speakerModule()
    voices = WITH_ARABIC
    const events: string[] = []
    const speaker = createSpeaker({
      serverTts: false,
      handlers: { onStart: () => events.push('start'), onEnd: reason => events.push(`end:${reason}`) },
    })
    speaker.feed('إجازة البناء تقدّمها من المنصة. ')
    speaker.finish('إجازة البناء تقدّمها من المنصة.')
    const spoken = playNext()
    expect(spoken?.text).toBe('إجازة البناء تقدّمها من المنصة.')
    expect((spoken?.voice as FakeVoice | null)?.lang).toBe('ar-SA')
    expect(spoken?.lang).toBe('ar-SA')
    expect(events).toEqual(['start', 'end:done'])
  })
})

describe('the voice stage says it', () => {
  const props = (textOnly: boolean) => ({
    orbRef: { current: null },
    stageRef: { current: null },
    phase: 'idle' as const,
    partial: '',
    message: '',
    engine: 'speech' as const,
    provider: null,
    serverVoice: false,
    textOnly,
    continuous: true,
    onContinuous: () => {},
    onPressStart: () => {},
    onPressEnd: () => {},
    onToggle: () => {},
    onSkip: () => {},
    onKeyboard: () => {},
    onAccept: () => {},
    onDecline: () => {},
  })

  it('shows «جهازك ما بيه صوت عربي؛ الأجوبة تظهر كتابة» only on a device without an Arabic voice', async () => {
    const { VoiceStage, NO_ARABIC_VOICE } = await import('../src/components/assistant/voice/VoiceStage')
    expect(NO_ARABIC_VOICE).toBe('جهازك ما بيه صوت عربي؛ الأجوبة تظهر كتابة')
    const without = renderToStaticMarkup(createElement(VoiceStage, props(true)))
    expect(without).toContain(NO_ARABIC_VOICE)
    expect(without).toMatch(/class="afd-voice-note" role="status"/)
    const withVoice = renderToStaticMarkup(createElement(VoiceStage, props(false)))
    expect(withVoice).not.toContain(NO_ARABIC_VOICE)
    // the mic still works: speaking to أفندي needs no voice of his own
    expect(without).toMatch(/aria-label="تكلّم مع أفندي"/)
  })
})
