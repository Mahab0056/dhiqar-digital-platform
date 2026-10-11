import { useEffect, useState } from 'react'
import { pickArabicVoice } from './speech-text'

/**
 * Can this device read أفندي's answers aloud in Arabic? Many cannot — Windows Chrome ships English / European voices
 * only — and an Arabic answer handed to a wrong-language voice is read as gibberish or not at all. Then the answers
 * stay text, and voice mode says so up front («جهازك ما بيه صوت عربي؛ الأجوبة تظهر كتابة»); the citizen can still
 * talk to أفندي (the microphone does not need a voice).
 */
export type ArabicSpeech = 'yes' | 'no' | 'unknown'

/** A browser that has not filled its voice list by then has no voice to read with. */
export const VOICE_LIST_WAIT = 2500

/**
 * What the browser's voice list says now. `ttsSupported`: the browser has speech synthesis at all ('no' without
 * it). An empty list is 'unknown' — Chromium fills it late (voiceschanged).
 */
export function arabicSpeechNow(ttsSupported: boolean): ArabicSpeech {
  if (!ttsSupported) return 'no'
  const synth = typeof window === 'undefined' ? undefined : window.speechSynthesis
  const voices = synth?.getVoices?.() ?? []
  if (!voices.length) return 'unknown'
  return pickArabicVoice(voices) ? 'yes' : 'no'
}

/**
 * How the answers are voiced here: the deployment's server voice, the browser's Arabic voice, or not at all —
 * «text» when the browser has no Arabic voice. A list still loading is given the benefit of the doubt (the browser is
 * asked for lang="ar" and picks its own Arabic voice if it has one).
 */
export function answerVoice(options: { serverTts: boolean; arabic: ArabicSpeech }): 'server' | 'browser' | 'text' {
  if (options.serverTts) return 'server'
  return options.arabic === 'no' ? 'text' : 'browser'
}

/** Follows the voice list while voice mode is open; a list that never arrives means there is no voice at all. */
export function useArabicSpeech(active: boolean, ttsSupported: boolean): ArabicSpeech {
  const [arabic, setArabic] = useState<ArabicSpeech>(() => arabicSpeechNow(ttsSupported))
  useEffect(() => {
    if (!active) return
    const update = () => setArabic(arabicSpeechNow(ttsSupported))
    update()
    const synth = ttsSupported && typeof window !== 'undefined' ? window.speechSynthesis : undefined
    if (!synth) return
    synth.addEventListener?.('voiceschanged', update)
    const timer = window.setTimeout(() => {
      const now = arabicSpeechNow(ttsSupported)
      setArabic(now === 'unknown' ? 'no' : now)
    }, VOICE_LIST_WAIT)
    return () => {
      synth.removeEventListener?.('voiceschanged', update)
      window.clearTimeout(timer)
    }
  }, [active, ttsSupported])
  return arabic
}
