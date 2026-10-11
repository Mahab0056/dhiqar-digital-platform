// أفندي's voice loop (useVoiceConversation) driven without a browser: a tiny one-component hooks runtime stands in for
// React, and the microphone / speaker modules are fakes that record what the loop asks of them. Regressions:
// - a reply that was talked over (barge-in) ends late and must not end the NEW question's turn (it was never spoken
//   and the continuous conversation stopped);
// - switching «محادثة متواصلة» off while أفندي speaks must close the barge-in mic and not reopen the mic afterwards;
// - a note written before tools (interim) must silence the voice, close the barge-in mic and show «thinking» until
//   the real answer starts speaking again;
// - «تخطي» while the answer still streams must keep أفندي silent for the rest of it.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantEvent } from '../src/components/assistant/assistant-client'

// ---- a one-component hooks runtime -------------------------------------------------------------------------------
const runtime = vi.hoisted(() => {
  type Slot = {
    initialised?: boolean
    value?: unknown
    setter?: (next: unknown) => void
    deps?: unknown[]
    cleanup?: unknown
    ref?: { current: unknown }
  }
  const state = {
    slots: [] as Slot[],
    index: 0,
    pending: [] as Array<() => void>,
    render: null as null | (() => void),
    scheduled: false,
  }
  const same = (left?: unknown[], right?: unknown[]) =>
    Boolean(
      left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
    )
  const slot = (): Slot => {
    const index = state.index++
    state.slots[index] ??= {}
    return state.slots[index]
  }
  const schedule = () => {
    if (state.scheduled) return
    state.scheduled = true
    queueMicrotask(() => {
      state.scheduled = false
      state.render?.()
    })
  }
  const effect = (create: () => unknown, deps?: unknown[]) => {
    const current = slot()
    if (deps && current.deps && same(current.deps, deps)) return
    const previous = current.cleanup
    current.deps = deps
    state.pending.push(() => {
      if (typeof previous === 'function') previous()
      current.cleanup = create()
    })
  }
  const react = {
    useRef: (initial: unknown) => {
      const current = slot()
      current.ref ??= { current: initial }
      return current.ref
    },
    useState: (initial: unknown) => {
      const current = slot()
      if (!current.initialised) {
        current.initialised = true
        current.value = typeof initial === 'function' ? (initial as () => unknown)() : initial
        current.setter = next => {
          const value = typeof next === 'function' ? (next as (value: unknown) => unknown)(current.value) : next
          if (Object.is(value, current.value)) return
          current.value = value
          schedule()
        }
      }
      return [current.value, current.setter]
    },
    useCallback: (callback: unknown, deps: unknown[]) => {
      const current = slot()
      if (current.deps && same(current.deps, deps)) return current.value
      current.deps = deps
      current.value = callback
      return callback
    },
    useEffect: effect,
    useLayoutEffect: effect,
  }
  function mount<P, R>(hook: (props: P) => R, props: P) {
    let result: R | undefined
    let current = props
    state.slots = []
    state.pending = []
    state.render = () => {
      state.index = 0
      result = hook(current)
      for (const run of state.pending.splice(0)) run()
    }
    state.render()
    return {
      get result() {
        return result as R
      },
      rerender(next: Partial<P>) {
        current = { ...current, ...next }
        state.render?.()
      },
      unmount() {
        for (const item of state.slots) if (typeof item.cleanup === 'function') item.cleanup()
        state.render = null
      },
    }
  }
  return { react, mount }
})
vi.mock('react', () => runtime.react)

// ---- fake microphone and speaker -------------------------------------------------------------------------------------
type FakeSession = {
  handlers: { onFinal: (text: string) => void; onError: (code: string, text: string) => void }
  stop: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
}
type FakeSpeaker = {
  handlers: { onStart?: () => void; onEnd?: (reason: 'done' | 'stopped') => void }
  fed: string[]
  finished: { markdown: string; extra?: string } | null
  resets: number
  stopped: boolean
  started: boolean
  end: () => void
}
const fakes = vi.hoisted(() => ({
  sessions: [] as FakeSession[],
  watchers: [] as Array<{ onSpeech: () => void; stop: ReturnType<typeof vi.fn> }>,
  speakers: [] as FakeSpeaker[],
}))

vi.mock('../src/components/assistant/voice/mic-input', () => ({
  VOICE_ERRORS: { unsupported: 'unsupported', 'no-speech': 'no-speech', failed: 'failed' },
  voiceEngine: () => 'speech',
  startListening: async (options: { handlers: FakeSession['handlers'] }) => {
    const session = { handlers: options.handlers, stop: vi.fn(), cancel: vi.fn(), engine: 'speech' }
    fakes.sessions.push(session)
    return session
  },
  watchForBargeIn: async (onSpeech: () => void) => {
    const stop = vi.fn()
    fakes.watchers.push({ onSpeech, stop })
    return stop
  },
}))

vi.mock('../src/components/assistant/voice/speaker', () => ({
  browserTtsSupported: () => true,
  warmVoices: () => undefined,
  createSpeaker: (options: { handlers: FakeSpeaker['handlers'] }) => {
    const speaker = {
      handlers: options.handlers,
      fed: [] as string[],
      finished: null as FakeSpeaker['finished'],
      resets: 0,
      stopped: false,
      started: false,
      // like the real speaker: speaking starts with the first sentence it is given
      feed(text: string) {
        if (this.stopped) return
        this.fed.push(text)
        if (!this.started) {
          this.started = true
          this.handlers.onStart?.()
        }
      },
      finish(markdown: string, extra?: string) {
        this.finished = { markdown, extra }
      },
      reset() {
        this.resets++
        this.started = false
      },
      stop() {
        if (this.stopped) return
        this.stopped = true
        this.handlers.onEnd?.('stopped')
      },
      end() {
        this.stopped = true
        this.handlers.onEnd?.('done')
      },
      get speaking() {
        return this.started && !this.stopped
      },
    }
    fakes.speakers.push(speaker)
    return speaker
  },
}))

// ---- browser globals the hook touches -------------------------------------------------------------------------------
const storage = new Map<string, string>()
const globals = globalThis as unknown as { window?: unknown }
beforeAll(() => {
  globals.window = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
    },
    setTimeout: (callback: () => void, ms?: number) => globalThis.setTimeout(callback, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id),
  }
})
afterAll(() => {
  delete globals.window
})

const { useVoiceConversation } = await import('../src/components/assistant/voice/useVoiceConversation')
type Voice = ReturnType<typeof useVoiceConversation>

const flush = async () => {
  for (let index = 0; index < 8; index++) await Promise.resolve()
}

const text = (delta: string): AssistantEvent => ({ type: 'text', delta })

function setup() {
  const sent: Array<{ text: string; turn: number }> = []
  const view = runtime.mount(useVoiceConversation, {
    active: true,
    transcribe: false,
    serverTts: false,
    muted: false,
    send: async (question: string, _channel: string, turn: number) => {
      sent.push({ text: question, turn })
    },
    abort: () => undefined,
    onLevel: () => undefined,
    onSentence: () => undefined,
  })
  const voice = () => view.result as Voice
  /** the citizen talks: a listening session starts and hears `question` */
  const ask = async (question: string) => {
    if (voice().phase !== 'listening') {
      voice().toggle()
      await flush()
    }
    fakes.sessions.at(-1)!.handlers.onFinal(question)
    await flush()
    return sent.at(-1)!.turn
  }
  return { view, voice, sent, ask }
}

beforeEach(() => {
  vi.useFakeTimers()
  storage.clear()
  storage.set('dqa-voice-consent', '1')
  fakes.sessions.length = 0
  fakes.watchers.length = 0
  fakes.speakers.length = 0
})
afterEach(() => {
  vi.useRealTimers()
})

describe('voice loop: turns, barge-in and the continuous conversation', () => {
  it('a reply that was talked over ends late without ending the new question: the new answer is spoken', async () => {
    const { voice, sent, ask } = setup()
    const first = await ask('أريد أجدد جوازي')
    voice().onReplyEvent(text('تكدر تجدد من المنصة. '), 'تكدر تجدد من المنصة. ', first)
    await flush()
    expect(voice().phase).toBe('speaking')
    expect(fakes.watchers).toHaveLength(1)

    // barge-in while the first answer still streams, then a new question
    fakes.watchers[0].onSpeech()
    await flush()
    expect(voice().phase).toBe('listening')
    const second = await ask('لا، أقصد بدل ضائع')
    expect(sent).toHaveLength(2)
    expect(second).not.toBe(first)

    // the panel aborts the first reply: its end arrives now, tagged with its own turn — and is ignored
    voice().onReplyDone({ text: 'تكدر تجدد من المنصة.', ui: [], failed: true, turn: first })
    await flush()
    expect(voice().phase).toBe('thinking')

    // the second reply is read aloud, and the conversation listens again afterwards
    voice().onReplyEvent(text('بدل الضائع تقدّمه من المنصة. '), 'بدل الضائع تقدّمه من المنصة. ', second)
    await flush()
    expect(voice().phase).toBe('speaking')
    const speaker = fakes.speakers.at(-1)!
    expect(speaker.fed).toContain('بدل الضائع تقدّمه من المنصة. ')
    voice().onReplyDone({ text: 'بدل الضائع تقدّمه من المنصة.', ui: [], failed: false, turn: second })
    expect(speaker.finished?.markdown).toBe('بدل الضائع تقدّمه من المنصة.')
    const sessions = fakes.sessions.length
    speaker.end()
    await vi.advanceTimersByTimeAsync(400)
    expect(voice().phase).toBe('listening')
    expect(fakes.sessions).toHaveLength(sessions + 1)
  })

  it('switching «محادثة متواصلة» off while أفندي speaks closes the barge-in mic and does not listen again', async () => {
    const { voice, ask } = setup()
    expect(voice().continuous).toBe(true)
    const turn = await ask('شنو مستمسكات الجواز؟')
    voice().onReplyEvent(text('جيب البطاقة الوطنية. '), 'جيب البطاقة الوطنية. ', turn)
    await flush()
    expect(voice().phase).toBe('speaking')
    expect(fakes.watchers).toHaveLength(1)

    voice().setContinuous(false)
    await flush()
    expect(fakes.watchers[0].stop).toHaveBeenCalled()
    expect(storage.get('dqa-voice-continuous')).toBe('0')

    voice().onReplyDone({ text: 'جيب البطاقة الوطنية.', ui: [], failed: false, turn })
    const sessions = fakes.sessions.length
    fakes.speakers.at(-1)!.end()
    await vi.advanceTimersByTimeAsync(2000)
    expect(voice().phase).toBe('idle')
    expect(fakes.sessions).toHaveLength(sessions)
  })

  it('a note before tools silences the voice, closes the barge-in mic and shows «thinking» until the answer', async () => {
    const { voice, ask } = setup()
    const turn = await ask('أريد إجازة بناء')
    voice().onReplyEvent(text('خلني أدورلك. '), 'خلني أدورلك. ', turn)
    await flush()
    expect(voice().phase).toBe('speaking')
    const speaker = fakes.speakers.at(-1)!

    voice().onReplyEvent({ type: 'interim', note: 'خلني أدورلك.' }, '', turn)
    await flush()
    expect(speaker.resets).toBe(1)
    expect(fakes.watchers[0].stop).toHaveBeenCalled()
    expect(voice().phase).toBe('thinking')

    // the real answer starts speaking afresh, with a new barge-in watcher
    voice().onReplyEvent(text('إجازة البناء تقدّمها من المنصة. '), 'إجازة البناء تقدّمها من المنصة. ', turn)
    await flush()
    expect(voice().phase).toBe('speaking')
    expect(fakes.watchers).toHaveLength(2)
    expect(fakes.watchers[1].stop).not.toHaveBeenCalled()
  })

  it('«تخطي» while the answer still streams keeps أفندي silent for the rest of it', async () => {
    const { voice, ask } = setup()
    const turn = await ask('شلون أدفع الرسم؟')
    voice().onReplyEvent(text('تدفع من صفحة الطلب. '), 'تدفع من صفحة الطلب. ', turn)
    await flush()
    voice().stopSpeaking()
    await flush()
    expect(voice().phase).toBe('idle')
    voice().onReplyEvent(text('تدفع من صفحة الطلب. وبعدها '), 'تدفع من صفحة الطلب. وبعدها ', turn)
    voice().onReplyDone({ text: 'تدفع من صفحة الطلب. وبعدها تتابع.', ui: [], failed: false, turn })
    await flush()
    expect(fakes.speakers).toHaveLength(1)
    expect(fakes.speakers[0].stopped).toBe(true)
    expect(fakes.speakers[0].finished).toBeNull()
  })
})
