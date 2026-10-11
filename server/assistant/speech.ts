/**
 * Voice for أفندي. Claude reads text only, so speech travels through separate, pluggable providers:
 *
 * - Speech-to-text: the browser's own recognition (Web Speech API) does it on Chrome / Edge / Android / iOS Safari.
 *   Browsers without it (Firefox, some iOS builds) record a short clip and POST it to /api/assistant/transcribe,
 *   which uses an OpenAI-compatible transcription API ONLY when OPENAI_API_KEY is set; otherwise 501 and the panel
 *   tells the citizen to type.
 * - Text-to-speech: the browser's speechSynthesis by default. A server voice (/api/assistant/speak) is an optional
 *   hook, off unless ASSISTANT_SERVER_TTS=true (and the key is set).
 *
 * Environment:
 * - OPENAI_API_KEY          enables the server transcription fallback (and the optional server voice)
 * - OPENAI_BASE_URL         optional OpenAI-compatible base URL (default https://api.openai.com/v1)
 * - ASSISTANT_STT_MODEL     transcription model (default gpt-4o-mini-transcribe; whisper-1 also works)
 * - ASSISTANT_SERVER_TTS    "true" turns the server voice on (default off)
 * - ASSISTANT_TTS_MODEL     default gpt-4o-mini-tts · ASSISTANT_TTS_VOICE default "onyx"
 * - ASSISTANT_DAILY_STT_LIMIT  cost guard: clips per day sent to the paid transcription (default 1000;
 *                              "unlimited" removes the cap). Past it the endpoint answers 503 and the panel says «اكتب».
 * - ASSISTANT_STT_PROVIDER_LABEL  name shown to citizens for a custom OPENAI_BASE_URL (default «OpenAI»)
 *
 * Audio is never stored: it lives in memory for the length of the request and is dropped.
 */
export const VOICE_LIMITS = {
  /**
   * hard cap on one clip (bytes). The recorder writes opus at 32 kbps (≈ 240 KB a minute); 1 MB leaves room for a
   * browser that ignores the bitrate (128 kbps) without letting a script post a long recording.
   */
  maxBytes: 1024 * 1024,
  /** hard cap on one clip (ms); the client stops at the same limit */
  maxDurationMs: 60_000,
  /** tolerance on the duration (the recorder's clock vs the container) */
  durationSlackMs: 1500,
  /** bytes per declared second a real clip can need (128 kbps), plus a container allowance */
  maxBytesPerSecond: 16 * 1024,
  byteSlack: 16 * 1024,
  /** text sent to the optional server voice */
  maxSpeakChars: 600,
}

const DEFAULT_DAILY_STT_LIMIT = 1000

/** Clips per day that may reach the paid transcription provider (null: no cap). */
export function dailyTranscribeLimit(): number | null {
  const raw = process.env.ASSISTANT_DAILY_STT_LIMIT?.trim().toLowerCase()
  if (raw === 'unlimited') return null
  const value = Number(raw)
  return raw && Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_DAILY_STT_LIMIT
}

export const ACCEPTED_AUDIO = /^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|x-m4a|m4a|aac)(;.*)?$/i

export type TranscribeInput = { audio: Buffer; mimeType: string; filename: string }

export interface SpeechProvider {
  readonly name: string
  /** who processes the audio, as told to the citizen before he talks (e.g. «OpenAI») */
  readonly label?: string
  transcribe(input: TranscribeInput, signal?: AbortSignal): Promise<string>
  /** optional server voice; resolves with mp3 bytes */
  speak?(text: string, signal?: AbortSignal): Promise<Buffer>
}

/** Words that help the recogniser with local names (a prompt bias, not a constraint). */
const STT_HINT =
  'منصة ذي قار الرقمية، أفندي، الناصرية، الشطرة، الرفاعي، سوق الشيوخ، الجبايش، الغراف، جواز، هوية، بطاقة وطنية، مستمسكات، معاملة، إجازة بناء، طابو'

const baseUrl = () => (process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '')

class OpenAiSpeech implements SpeechProvider {
  readonly name = 'openai'
  private readonly key: string
  constructor(key: string) {
    this.key = key
  }

  get label() {
    const custom = process.env.ASSISTANT_STT_PROVIDER_LABEL?.trim().slice(0, 60)
    if (custom) return custom
    return /^https:\/\/api\.openai\.com\//.test(`${baseUrl()}/`) ? 'OpenAI' : 'مزوّد خارجي لتحويل الكلام'
  }

  async transcribe(input: TranscribeInput, signal?: AbortSignal) {
    const form = new FormData()
    const model = process.env.ASSISTANT_STT_MODEL?.trim() || 'gpt-4o-mini-transcribe'
    form.append('file', new Blob([new Uint8Array(input.audio)], { type: input.mimeType }), input.filename)
    form.append('model', model)
    form.append('language', 'ar')
    form.append('prompt', STT_HINT)
    form.append('response_format', 'json')
    const response = await fetch(`${baseUrl()}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}` },
      body: form,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new SpeechProviderError(response.status)
    const payload = (await response.json()) as { text?: string }
    return String(payload.text || '').trim()
  }

  async speak(text: string, signal?: AbortSignal) {
    const response = await fetch(`${baseUrl()}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.ASSISTANT_TTS_MODEL?.trim() || 'gpt-4o-mini-tts',
        voice: process.env.ASSISTANT_TTS_VOICE?.trim() || 'onyx',
        input: text,
        response_format: 'mp3',
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new SpeechProviderError(response.status)
    return Buffer.from(await response.arrayBuffer())
  }
}

export class SpeechProviderError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`speech provider HTTP ${status}`)
    this.status = status
  }
}

let injected: SpeechProvider | null | undefined
let cached: { key: string; provider: SpeechProvider } | null = null

/** Test hook: inject a fake provider (null = none); undefined restores the env-based resolution. */
export function setSpeechProvider(provider: SpeechProvider | null | undefined) {
  injected = provider
}

/** The server speech provider, or null (no key): the transcribe endpoint answers 501. */
export function getSpeechProvider(): SpeechProvider | null {
  if (injected !== undefined) return injected
  const key = process.env.OPENAI_API_KEY?.trim()
  if (!key) return null
  if (!cached || cached.key !== key) cached = { key, provider: new OpenAiSpeech(key) }
  return cached.provider
}

export const serverTtsEnabled = () =>
  process.env.ASSISTANT_SERVER_TTS?.trim().toLowerCase() === 'true' && Boolean(getSpeechProvider()?.speak)

/**
 * What the widget may use (no secrets). `provider` names the external service that receives the clip (recorder
 * engine) or the answer text (server voice), so the consent sheet can say who processes it.
 */
export const voiceConfig = () => {
  const provider = getSpeechProvider()
  return {
    transcribe: Boolean(provider),
    serverTts: serverTtsEnabled(),
    provider: provider ? provider.label || provider.name : null,
  }
}

/** Cheap container sniffing: the declared type must match the bytes (webm/ogg/mp4/mp3/wav). */
export function looksLikeAudio(buffer: Buffer) {
  if (buffer.length < 12) return false
  const ascii = (start: number, end: number) => buffer.subarray(start, end).toString('latin1')
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return true // webm/mkv
  if (ascii(0, 4) === 'OggS') return true
  if (ascii(4, 8) === 'ftyp') return true // mp4 / m4a
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return true
  if (ascii(0, 3) === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return true // mp3 / aac adts
  return false
}

/**
 * Length of the clip read from the container itself (webm/mkv block timestamps, ogg granule positions, wav data
 * size, mp4 movie header), in ms — the client's `durationMs` is not trusted alone. null: the container does not say
 * (mp3, a fragmented mp4 without a movie duration); the byte limits still apply.
 */
export function audioDurationMs(buffer: Buffer): number | null {
  try {
    if (buffer.length < 12) return null
    if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3)
      return webmDuration(buffer)
    const ascii = (start: number, end: number) => buffer.subarray(start, end).toString('latin1')
    if (ascii(0, 4) === 'OggS') return oggDuration(buffer)
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return wavDuration(buffer)
    if (ascii(4, 8) === 'ftyp') return mp4Duration(buffer)
  } catch {
    /* malformed container: unknown length */
  }
  return null
}

/** EBML variable-length integer (an element id keeps its length marker; a size drops it). */
function readVint(buffer: Buffer, pos: number, isId: boolean) {
  const first = buffer[pos]
  if (first === undefined || first === 0) return null
  let length = 1
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++
  if (length > (isId ? 4 : 8) || pos + length > buffer.length) return null
  let value = isId ? first : first & (0xff >> length)
  let allOnes = value === 0xff >> length
  for (let index = 1; index < length; index++) {
    value = value * 256 + buffer[pos + index]
    if (buffer[pos + index] !== 0xff) allOnes = false
  }
  return { value, length, unknown: !isId && allOnes }
}

const readUint = (buffer: Buffer, start: number, length: number) => {
  if (length < 1 || length > 6 || start + length > buffer.length) return 0
  return buffer.readUIntBE(start, length)
}

const EBML_ID = {
  segment: 0x18538067,
  cluster: 0x1f43b675,
  info: 0x1549a966,
  blockGroup: 0xa0,
  timecodeScale: 0x2ad7b1,
  duration: 0x4489,
  timecode: 0xe7,
  simpleBlock: 0xa3,
  block: 0xa1,
}
/** masters whose children are read in place (MediaRecorder writes the segment and clusters with unknown sizes) */
const EBML_DESCEND = new Set([EBML_ID.segment, EBML_ID.cluster, EBML_ID.info, EBML_ID.blockGroup])

function webmDuration(buffer: Buffer): number | null {
  let pos = 0
  let scale = 1_000_000 // ns per timestamp tick (the default: 1 ms)
  let declared = 0
  let clusterTime = 0
  let first = Infinity
  let last = -Infinity
  for (let steps = 0; pos < buffer.length && steps < 500_000; steps++) {
    const id = readVint(buffer, pos, true)
    if (!id) break
    const size = readVint(buffer, pos + id.length, false)
    if (!size) break
    const start = pos + id.length + size.length
    if (EBML_DESCEND.has(id.value)) {
      pos = start
      continue
    }
    if (size.unknown) break
    if (id.value === EBML_ID.timecodeScale) scale = readUint(buffer, start, size.value) || scale
    else if (id.value === EBML_ID.duration && start + size.value <= buffer.length)
      declared = size.value === 4 ? buffer.readFloatBE(start) : size.value === 8 ? buffer.readDoubleBE(start) : 0
    else if (id.value === EBML_ID.timecode) clusterTime = readUint(buffer, start, size.value)
    else if (id.value === EBML_ID.simpleBlock || id.value === EBML_ID.block) {
      const track = readVint(buffer, start, false)
      if (track && start + track.length + 2 <= buffer.length) {
        const time = clusterTime + buffer.readInt16BE(start + track.length)
        first = Math.min(first, time)
        last = Math.max(last, time)
      }
    }
    pos = start + size.value
  }
  const fromBlocks = last >= first ? ((last - first) * scale) / 1e6 : 0
  const fromHeader = Number.isFinite(declared) && declared > 0 ? (declared * scale) / 1e6 : 0
  if (first === Infinity && !fromHeader) return null
  return Math.max(fromBlocks, fromHeader)
}

function oggDuration(buffer: Buffer): number | null {
  let pos = 0
  let rate = 0
  let firstGranule = -1
  let lastGranule = -1
  while (pos + 27 <= buffer.length && buffer.toString('latin1', pos, pos + 4) === 'OggS') {
    const segments = buffer[pos + 26]
    const bodyStart = pos + 27 + segments
    if (bodyStart > buffer.length) break
    let bodySize = 0
    for (let index = 0; index < segments; index++) bodySize += buffer[pos + 27 + index]
    if (!rate) {
      const body = buffer.subarray(bodyStart, bodyStart + bodySize)
      if (body.toString('latin1', 0, 8) === 'OpusHead') rate = 48_000
      else if (body[0] === 1 && body.toString('latin1', 1, 7) === 'vorbis' && body.length >= 16)
        rate = body.readUInt32LE(12)
    }
    const granule = buffer.readBigInt64LE(pos + 6)
    if (granule > 0n) {
      const value = Number(granule)
      if (firstGranule < 0) firstGranule = value
      lastGranule = Math.max(lastGranule, value)
    }
    pos = bodyStart + bodySize
  }
  if (!rate || lastGranule < 0) return null
  // a lower bound (the first audio page's own length is not counted): enough for a cap check
  return ((lastGranule - firstGranule) / rate) * 1000
}

function wavDuration(buffer: Buffer): number | null {
  let pos = 12
  let byteRate = 0
  while (pos + 8 <= buffer.length) {
    const id = buffer.toString('latin1', pos, pos + 4)
    const size = buffer.readUInt32LE(pos + 4)
    if (id === 'fmt ' && pos + 20 <= buffer.length) byteRate = buffer.readUInt32LE(pos + 16)
    // the bytes actually present count (a streamed wav may declare 0 or 0xffffffff)
    if (id === 'data') return byteRate ? ((buffer.length - pos - 8) / byteRate) * 1000 : null
    pos += 8 + size + (size & 1)
  }
  return null
}

function mp4Duration(buffer: Buffer): number | null {
  const find = (type: string, start: number, end: number): { start: number; end: number } | null => {
    let pos = start
    while (pos + 8 <= end) {
      let size = buffer.readUInt32BE(pos)
      let header = 8
      if (size === 1 && pos + 16 <= end) {
        size = Number(buffer.readBigUInt64BE(pos + 8))
        header = 16
      } else if (size === 0) size = end - pos
      if (size < header) return null
      if (buffer.toString('latin1', pos + 4, pos + 8) === type)
        return { start: pos + header, end: Math.min(end, pos + size) }
      pos += size
    }
    return null
  }
  const moov = find('moov', 0, buffer.length)
  const mvhd = moov && find('mvhd', moov.start, moov.end)
  if (!mvhd || mvhd.start + 32 > buffer.length) return null
  const version = buffer[mvhd.start]
  const timescale = buffer.readUInt32BE(mvhd.start + (version === 1 ? 20 : 12))
  const duration =
    version === 1 ? Number(buffer.readBigUInt64BE(mvhd.start + 24)) : buffer.readUInt32BE(mvhd.start + 16)
  if (!timescale || !duration || duration === 0xffffffff) return null
  return (duration / timescale) * 1000
}
