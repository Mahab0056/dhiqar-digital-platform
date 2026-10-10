// Renders a tutorial video end to end: frames (deterministic seek, like design/explainer/render.mjs),
// original sound design generated with ffmpeg (UI clicks, whooshes, chimes, a soft music bed), optional
// voice-over from design/videos/vo/<name>/NN.mp3, Arabic captions, MP4 + WebM + poster into public/media.
//
// Usage (from the project root; needs Microsoft Edge and ffmpeg on PATH):
//   node design/videos/build.mjs && node design/explainer/build.mjs
//   node design/videos/make.mjs register|protect|explainer [--stills 3,7.5,12] [--skip-frames]
// The explainer keeps its already-published picture (public/media/explainer.*) and only gets a new soundtrack.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const name = process.argv[2]
const flag = key => {
  const i = process.argv.indexOf(key)
  return i < 0 ? null : process.argv[i + 1] || ''
}
if (!['register', 'protect', 'explainer'].includes(name)) throw new Error('usage: make.mjs register|protect|explainer')
const htmlFile = name === 'explainer' ? path.join(root, 'design/explainer/explainer.html') : path.join(root, `design/videos/${name}.html`)
const media = path.join(root, 'public/media')
const work = path.join(process.env.VIDEO_TMP || path.join(os.tmpdir(), 'dhiqar-videos'), name)
const FPS = 25
fs.mkdirSync(work, { recursive: true })

const ff = (args, opts = {}) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 1 << 26, ...opts })
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`)
  return r.stderr
}

// ---------- 1. page: timeline, captions, sound cues, frames ----------
const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(pathToFileURL(htmlFile).href)
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(400)
const seek = ms => page.evaluate(ms => document.getAnimations().forEach(a => { a.pause(); a.currentTime = ms }), ms)
const meta = await page.evaluate(() => {
  const sec = v => parseFloat(v) || 0
  const scenes = [...document.querySelectorAll('.scene')].map(s => {
    const cs = getComputedStyle(s)
    return { t: sec(cs.getPropertyValue('--t')), len: sec(cs.getPropertyValue('--len')), cap: s.dataset.cap || '', vo: s.dataset.vo || '' }
  })
  const cues = [...document.querySelectorAll('[data-sfx]')].map(el => {
    const cs = getComputedStyle(el)
    return { type: el.dataset.sfx, t: sec(cs.getPropertyValue('--t')) + sec(cs.getPropertyValue('--at')), dur: sec(cs.getPropertyValue('--dur')) || 1.4 }
  })
  return { total: +document.body.dataset.total, poster: +document.body.dataset.poster, scenes, cues }
})
for (const s of meta.scenes.slice(1)) meta.cues.push({ type: 'whoosh', t: Math.max(0, s.t - 0.25) })
meta.cues.sort((a, b) => a.t - b.t)

const stills = flag('--stills')
if (stills !== null) {
  const out = flag('--out') || work
  fs.mkdirSync(out, { recursive: true })
  for (const s of stills.split(',').map(Number)) {
    await seek(s * 1000)
    await page.screenshot({ path: path.join(out, `${name}-${String(s).replace('.', '_')}s.jpg`), type: 'jpeg', quality: 85 })
  }
  await browser.close()
  console.log('stills written to', out)
  process.exit(0)
}

const frames = path.join(work, 'frames')
if (name !== 'explainer' && !process.argv.includes('--skip-frames')) {
  fs.rmSync(frames, { recursive: true, force: true })
  fs.mkdirSync(frames, { recursive: true })
  const total = Math.round(meta.total * FPS)
  for (let f = 0; f < total; f++) {
    await seek((f * 1000) / FPS)
    await page.screenshot({ path: path.join(frames, `f${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 })
  }
  console.log('frames', total)
}
await browser.close()

// ---------- 2. captions ----------
const ts = s => {
  const ms = Math.round(s * 1000)
  const mm = String(Math.floor(ms / 60000)).padStart(2, '0')
  const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')
  return `${mm}:${ss}.${String(ms % 1000).padStart(3, '0')}`
}
const vtt = ['WEBVTT', '']
for (const s of meta.scenes) vtt.push(`${ts(s.t + 0.2)} --> ${ts(Math.min(meta.total, s.t + s.len - 0.1))}`, s.cap, '')
fs.writeFileSync(path.join(media, `${name}.ar.vtt`), vtt.join('\n'))
// narration script for design/videos/tts.py (one line per scene)
const voDir = path.join(root, 'design/videos/vo', name)
fs.mkdirSync(voDir, { recursive: true })
fs.writeFileSync(path.join(voDir, 'script.json'), JSON.stringify(meta.scenes.map(s => ({ t: s.t, len: s.len, text: s.vo })), null, 2) + '\n')

// ---------- 3. sound design (all generated here, no stock audio) ----------
const SR = 48000
const sfxDir = path.join(work, 'sfx')
fs.mkdirSync(sfxDir, { recursive: true })
const tone = (file, expr, d, post = '') =>
  ff(['-f', 'lavfi', '-i', `aevalsrc='${expr}':s=${SR}:d=${d}`, ...(post ? ['-af', post] : []), '-ac', '2', path.join(sfxDir, file)])
const noise = (file, d, color, post) =>
  ff(['-f', 'lavfi', '-i', `anoisesrc=d=${d}:c=${color}:r=${SR}:a=0.8:seed=7`, '-af', post, '-ac', '2', path.join(sfxDir, file)])
tone('click.wav', '0.55*sin(2*PI*1750*t)*exp(-t*95)+0.3*sin(2*PI*880*t)*exp(-t*55)', 0.09)
tone('pop.wav', '0.5*sin(2*PI*(420*t+2300*t*t))*exp(-t*26)', 0.18)
tone('chime.wav', '0.34*sin(2*PI*659.25*t)*exp(-t*4.5)+0.08*sin(2*PI*1318.5*t)*exp(-t*7)+gte(t,0.13)*(0.32*sin(2*PI*987.77*(t-0.13))*exp(-(t-0.13)*3.8)+0.07*sin(2*PI*1975.5*(t-0.13))*exp(-(t-0.13)*6))', 1.4, 'afade=t=out:st=1.1:d=0.3')
tone('ding.wav', '0.38*sin(2*PI*1174.66*t)*exp(-t*5.5)+0.12*sin(2*PI*2349.3*t)*exp(-t*9)+0.1*sin(2*PI*587.33*t)*exp(-t*7)', 1, 'afade=t=out:st=0.8:d=0.2')
tone('scan.wav', '0.16*sin(2*PI*(380*t+520*t*t))*sin(PI*t/0.9)+0.05*sin(2*PI*(760*t+1040*t*t))*sin(PI*t/0.9)', 0.9)
tone('error.wav', '0.3*(sin(2*PI*233*t)+0.25*sin(2*PI*699*t))*exp(-t*9)+gte(t,0.15)*0.3*(sin(2*PI*196*(t-0.15))+0.25*sin(2*PI*588*(t-0.15)))*exp(-(t-0.15)*8)', 0.6)
tone('lock.wav', '0.5*sin(2*PI*110*t)*exp(-t*22)+0.32*sin(2*PI*2100*t)*exp(-t*110)+gte(t,0.09)*0.25*sin(2*PI*1500*(t-0.09))*exp(-(t-0.09)*120)', 0.35)
noise('shutter.wav', 0.16, 'white', `highpass=f=1800,volume='exp(-mod(t,0.075)*55)':eval=frame,volume=0.5`)
noise('whoosh.wav', 0.75, 'pink', `bandpass=f=900:width_type=o:w=2.2,volume='pow(sin(PI*t/0.75),2)*1.6':eval=frame,afade=t=out:st=0.6:d=0.15`)
const typeFile = dur => {
  const f = `type-${dur.toFixed(2)}.wav`
  if (!fs.existsSync(path.join(sfxDir, f)))
    tone(f, '0.22*sin(2*PI*(2300+400*sin(t*37))*t)*exp(-mod(t,0.105)*150)+0.12*sin(2*PI*1400*t)*exp(-mod(t+0.05,0.105)*170)', dur, 'afade=t=out:st=' + (dur - 0.05).toFixed(2) + ':d=0.05')
  return f
}
const gains = { click: 0.9, pop: 0.8, chime: 0.75, ding: 0.7, scan: 0.9, error: 0.8, lock: 0.9, shutter: 0.8, whoosh: 0.55, type: 0.7 }

// music bed: two crossfading layers of a slow i–VI–iv–V (D minor, Hijaz-coloured V) pad over a D drone
const chords = [
  [146.83, 174.61, 220.0, 293.66], // Dm
  [116.54, 146.83, 174.61, 233.08], // Bb
  [98.0, 116.54, 146.83, 196.0], // Gm
  [110.0, 138.59, 164.81, 220.0], // A (C# = Hijaz colour)
]
const pick = (idx, n) => chords.reduceRight((acc, c, i) => (acc === null ? `${c[n]}` : `if(eq(${idx},${i}),${c[n]},${acc})`), null)
const layer = (shift, env) => {
  const idx = `mod(floor((t+${shift})/8),4)`
  const notes = [0, 1, 2, 3].map(n => {
    const f = pick(idx, n)
    return `(sin(2*PI*${f}*t)+0.5*sin(2*PI*${f}*1.003*t)+0.12*sin(2*PI*${f}*2*t))*${[0.22, 0.2, 0.18, 0.12][n]}`
  })
  return `(${notes.join('+')})*${env}`
}
const musicExpr = [
  layer(0, 'pow(sin(PI*t/8),2)'),
  layer(4, 'pow(cos(PI*t/8),2)'),
  '0.16*sin(2*PI*73.42*t)+0.08*sin(2*PI*36.71*t)',
].join('+')
const music = path.join(work, 'music.wav')
ff([
  '-f', 'lavfi', '-i', `aevalsrc='(${musicExpr})*(0.82+0.18*sin(2*PI*0.23*t))*0.5':s=${SR}:d=${meta.total}`,
  '-af', `lowpass=f=1800,aecho=0.8:0.6:420|700:0.22|0.14,afade=t=in:d=2,afade=t=out:st=${meta.total - 3}:d=3`,
  '-ac', '2', music,
])

// voice-over (optional): NN.mp3 per scene, placed 0.35 s after the scene starts
const voFiles = meta.scenes.map((s, i) => ({ s, f: path.join(voDir, `${String(i).padStart(2, '0')}.mp3`) })).filter(v => fs.existsSync(v.f))
const hasVoice = voFiles.length > 0

const inputs = ['-i', music]
const graph = []
const sfxLabels = []
meta.cues.forEach((c, i) => {
  const file = c.type === 'type' ? typeFile(c.dur) : `${c.type}.wav`
  if (!fs.existsSync(path.join(sfxDir, file))) throw new Error(`unknown sfx ${c.type}`)
  inputs.push('-i', path.join(sfxDir, file))
  const ms = Math.max(0, Math.round(c.t * 1000))
  graph.push(`[${i + 1}:a]adelay=${ms}|${ms},volume=${gains[c.type] ?? 0.8}[s${i}]`)
  sfxLabels.push(`[s${i}]`)
})
graph.push(`${sfxLabels.join('')}amix=inputs=${sfxLabels.length}:normalize=0,apad=whole_dur=${meta.total},volume=${hasVoice ? 0.6 : 0.85}[sfx]`)
if (hasVoice) {
  const base = meta.cues.length + 1
  voFiles.forEach((v, i) => {
    inputs.push('-i', v.f)
    const ms = Math.round((v.s.t + 0.35) * 1000)
    graph.push(`[${base + i}:a]aresample=${SR},aformat=channel_layouts=stereo,adelay=${ms}|${ms}[v${i}]`)
  })
  graph.push(`${voFiles.map((_, i) => `[v${i}]`).join('')}amix=inputs=${voFiles.length}:normalize=0,apad=whole_dur=${meta.total},loudnorm=I=-16:TP=-1.5:LRA=11,asplit=2[voice][key]`)
  graph.push(`[0:a]loudnorm=I=-27:TP=-6,volume=1[bed];[bed][key]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=500[music]`)
  graph.push(`[voice][music][sfx]amix=inputs=3:normalize=0,alimiter=limit=0.89,atrim=0:${meta.total}[out]`)
} else {
  graph.push(`[0:a]loudnorm=I=-20:TP=-5[music]`)
  graph.push(`[music][sfx]amix=inputs=2:normalize=0,alimiter=limit=0.89,atrim=0:${meta.total}[out]`)
}
const graphFile = path.join(work, 'mix.txt')
fs.writeFileSync(graphFile, graph.join(';\n'))
const audio = path.join(work, 'mix.wav')
ff([...inputs, '-/filter_complex', graphFile, '-map', '[out]', '-ar', String(SR), '-ac', '2', audio])
console.log(`audio mixed: ${meta.cues.length} sound cues, voice-over ${hasVoice ? `${voFiles.length} lines` : 'none'}`)

// ---------- 4. encode ----------
const mp4 = path.join(media, `${name}.mp4`)
const webm = path.join(media, `${name}.webm`)
if (name === 'explainer') {
  // keep the published picture: take the video streams from a one-time copy of the silent originals
  const silentMp4 = path.join(work, 'explainer.silent.mp4')
  const silentWebm = path.join(work, 'explainer.silent.webm')
  if (!fs.existsSync(silentMp4)) ff(['-i', mp4, '-map', '0:v', '-c', 'copy', silentMp4])
  if (!fs.existsSync(silentWebm)) ff(['-i', webm, '-map', '0:v', '-c', 'copy', silentWebm])
  ff(['-i', silentMp4, '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-shortest', mp4])
  ff(['-i', silentWebm, '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'libopus', '-b:a', '96k', '-shortest', webm])
} else {
  const frameIn = ['-framerate', String(FPS), '-i', path.join(frames, 'f%05d.jpg')]
  ff([...frameIn, '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-tune', 'animation', '-crf', '26',
    '-maxrate', '420k', '-bufsize', '840k', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-shortest', mp4])
  ff([...frameIn, '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40', '-row-mt', '1',
    '-deadline', 'good', '-cpu-used', '2', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', '96k', '-shortest', webm])
  ff(['-ss', String(meta.poster), '-i', mp4, '-frames:v', '1', '-q:v', '3', path.join(media, `${name}-poster.jpg`)])
}
console.log('done', name)
