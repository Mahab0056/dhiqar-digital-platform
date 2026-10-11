// أفندي's mouth (voice/speaker.ts) with fake browser speech: a retracted note (interim) makes the next answer a new
// start, and the optional server voice never goes silent — a failed /speak (rate limit) is read by the browser voice,
// every sentence plays on the ONE element unlocked by the press that opened voice mode (iOS), and a reset in the
// middle of a clip does not block the sentences that follow.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const server = vi.hoisted(() => ({ fetchServerSpeech: vi.fn() }))
vi.mock('../src/components/assistant/assistant-client', () => ({
  fetchServerSpeech: server.fetchServerSpeech,
}))

class FakeUtterance {
  text: string
  voice: unknown = null
  lang = ''
  rate = 1
  pitch = 1
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}

const synth = {
  queue: [] as FakeUtterance[],
  spoken: [] as string[],
  paused: false,
  speak(utterance: FakeUtterance) {
    this.queue.push(utterance)
  },
  cancel() {
    for (const utterance of this.queue.splice(0)) utterance.onerror?.()
  },
  resume() {},
  getVoices: () => [],
  addEventListener() {},
}

/** the browser voice plays the next queued sentence to its end */
const playNext = () => {
  const utterance = synth.queue.shift()
  if (!utterance) return null
  synth.spoken.push(utterance.text)
  utterance.onstart?.()
  utterance.onend?.()
  return utterance.text
}

const audio = {
  instances: [] as FakeAudio[],
  played: [] as string[],
}
class FakeAudio {
  src = ''
  paused = true
  onplay: (() => void) | null = null
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() {
    audio.instances.push(this)
  }
  play() {
    this.paused = false
    audio.played.push(this.src)
    queueMicrotask(() => this.onplay?.())
    return Promise.resolve()
  }
  pause() {
    this.paused = true
  }
}

const globals = globalThis as unknown as Record<string, unknown>
beforeAll(() => {
  globals.window = { speechSynthesis: synth }
  globals.SpeechSynthesisUtterance = FakeUtterance
  globals.Audio = FakeAudio
})
afterAll(() => {
  delete globals.window
  delete globals.SpeechSynthesisUtterance
  delete globals.Audio
})
beforeEach(() => {
  synth.queue.length = 0
  synth.spoken.length = 0
  server.fetchServerSpeech.mockReset()
})

const { createSpeaker, unlockServerAudio } = await import('../src/components/assistant/voice/speaker')

const flush = async () => {
  for (let index = 0; index < 20; index++) await Promise.resolve()
}

describe('speaker: a retracted note and the server voice', () => {
  it('after reset (a note before tools) the answer is a new start: onStart again, nothing of the note replayed', () => {
    const events: string[] = []
    const speaker = createSpeaker({
      serverTts: false,
      handlers: { onStart: () => events.push('start'), onEnd: reason => events.push(`end:${reason}`) },
    })
    speaker.feed('خلني أدورلك على الخدمة. ')
    expect(playNext()).toBe('خلني أدورلك على الخدمة.')
    expect(speaker.speaking).toBe(true)

    speaker.reset()
    expect(speaker.speaking).toBe(false)
    expect(events).toEqual(['start'])

    speaker.feed('إجازة البناء تقدّمها من المنصة. ')
    speaker.finish('إجازة البناء تقدّمها من المنصة.')
    expect(playNext()).toBe('إجازة البناء تقدّمها من المنصة.')
    expect(events).toEqual(['start', 'start', 'end:done'])
    expect(synth.spoken).toEqual(['خلني أدورلك على الخدمة.', 'إجازة البناء تقدّمها من المنصة.'])
  })

  it('server voice: a refused /speak (429) is read by the browser voice instead of silence', async () => {
    server.fetchServerSpeech.mockRejectedValue(new Error('429'))
    const events: string[] = []
    const speaker = createSpeaker({
      serverTts: true,
      handlers: { onStart: () => events.push('start'), onEnd: reason => events.push(`end:${reason}`) },
    })
    speaker.feed('تكدر تجدد جوازك من المنصة. ')
    speaker.finish('تكدر تجدد جوازك من المنصة. وبعدها تراجع بموعد.')
    await flush()
    expect(playNext()).toBe('تكدر تجدد جوازك من المنصة.')
    await flush()
    // the next sentence is read too (one failure switches the rest of this answer to the browser voice)
    expect(playNext()).toBe('وبعدها تراجع بموعد.')
    await flush()
    expect(events).toEqual(['start', 'end:done'])
  })

  it('server voice: every clip plays on the element unlocked by the press, and a reset mid-clip does not block', async () => {
    unlockServerAudio()
    expect(audio.instances).toHaveLength(1)
    const unlocked = audio.instances[0]
    expect(audio.played).toHaveLength(1)
    server.fetchServerSpeech.mockImplementation(async () => new Blob(['ID3'], { type: 'audio/mpeg' }))
    const events: string[] = []
    const speaker = createSpeaker({
      serverTts: true,
      handlers: { onStart: () => events.push('start'), onEnd: reason => events.push(`end:${reason}`) },
    })
    speaker.feed('خلني أدورلك. ')
    await flush()
    expect(audio.played).toHaveLength(2)
    expect(events).toEqual(['start'])
    // the clip of the retracted note never ends by itself: reset must still let the answer through
    const firstSignal = server.fetchServerSpeech.mock.calls[0][1] as AbortSignal
    speaker.reset()
    expect(firstSignal.aborted).toBe(true)
    expect(unlocked.paused).toBe(true)
    speaker.feed('الجواب من المنصة. ')
    speaker.finish('الجواب من المنصة.')
    await flush()
    expect(audio.played).toHaveLength(3)
    expect(audio.instances).toHaveLength(1)
    expect(events).toEqual(['start', 'start'])
    unlocked.onended?.()
    await flush()
    expect(events).toEqual(['start', 'start', 'end:done'])
  })
})
