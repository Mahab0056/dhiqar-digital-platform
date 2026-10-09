import { randomInt, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { db } from './db.js'
import { embedLargestFace, yawOf } from './face-match.js'

/**
 * Active liveness: the server picks the order of head movements for each attempt (look ahead, then left/right in a
 * random order), the phone guides the citizen through them while recording, and the server checks — frame by frame,
 * at the moment each move was shown — that the head really pointed that way. A video recorded in advance cannot know
 * the order, and a printed photo cannot turn.
 */
export type LivenessStep = 'CENTER' | 'LEFT' | 'RIGHT'
export type LivenessTimelineEntry = { step: LivenessStep; startMs: number; endMs: number }

db.exec(`
  CREATE TABLE IF NOT EXISTS liveness_challenges (
    id TEXT PRIMARY KEY,
    citizen_id INTEGER NOT NULL,
    steps TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_liveness_challenges_citizen ON liveness_challenges(citizen_id, created_at);
`)

export const STEP_MS = 1800
const CHALLENGE_TTL_MS = 10 * 60_000

export function createLivenessChallenge(citizenId: number) {
  const turns: LivenessStep[] = randomInt(2) === 0 ? ['LEFT', 'RIGHT'] : ['RIGHT', 'LEFT']
  const steps: LivenessStep[] = ['CENTER', ...turns, 'CENTER']
  const id = `lvc_${randomUUID().replaceAll('-', '')}`
  const now = Date.now()
  db.prepare(
    `INSERT INTO liveness_challenges (id, citizen_id, steps, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`
  ).run(
    id,
    citizenId,
    JSON.stringify(steps),
    new Date(now).toISOString(),
    new Date(now + CHALLENGE_TTL_MS).toISOString()
  )
  return { id, steps, stepMs: STEP_MS, expiresInSeconds: CHALLENGE_TTL_MS / 1000 }
}

/** Takes a challenge for this citizen exactly once; null when unknown, foreign, expired or already used. */
export function consumeLivenessChallenge(id: string, citizenId: number): LivenessStep[] | null {
  const now = new Date().toISOString()
  const claimed = db
    .prepare(
      `UPDATE liveness_challenges SET used_at = ? WHERE id = ? AND citizen_id = ? AND used_at IS NULL AND expires_at > ?`
    )
    .run(now, id, citizenId, now)
  if (!claimed.changes) return null
  const row = db.prepare('SELECT steps FROM liveness_challenges WHERE id = ?').get(id) as { steps: string }
  return JSON.parse(row.steps) as LivenessStep[]
}

const execFileAsync = promisify(execFile)

/** One frame at each requested second of the video (ffmpeg seek per timestamp). */
async function framesAt(video: Buffer, seconds: number[]) {
  const dir = mkdtempSync(join(tmpdir(), 'dhiqar-live-'))
  try {
    const input = join(dir, 'input.video')
    writeFileSync(input, video)
    const frames: Array<Buffer | null> = []
    for (const [index, second] of seconds.entries()) {
      const out = join(dir, `f${index}.jpg`)
      try {
        await execFileAsync(
          'ffmpeg',
          [
            '-y',
            '-loglevel',
            'error',
            '-ss',
            second.toFixed(2),
            '-i',
            input,
            '-frames:v',
            '1',
            '-vf',
            'scale=640:-2',
            '-q:v',
            '3',
            out,
          ],
          { timeout: 15_000 }
        )
        frames.push(readFileSync(out))
      } catch {
        frames.push(null)
      }
    }
    return frames
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Head turn needed to count as "looking left/right", and the most a "look ahead" may deviate (eye-distance units). */
export const TURN_MIN_YAW = 0.12
export const CENTER_MAX_YAW = 0.15

export type ActiveLiveness = {
  passed: boolean
  steps: Array<{ step: LivenessStep; yaw: number | null; ok: boolean }>
  reasons: string[]
}

/**
 * Whether one frame's head pose satisfies the step. The recording is the camera's raw (unmirrored) view: when the
 * citizen turns to their own left, their nose moves to the right of the image, so yaw is positive.
 */
export const stepSatisfied = (step: LivenessStep, yaw: number) =>
  step === 'CENTER' ? Math.abs(yaw) <= CENTER_MAX_YAW : step === 'LEFT' ? yaw >= TURN_MIN_YAW : yaw <= -TURN_MIN_YAW

export function judgeActiveLiveness(
  expected: LivenessStep[],
  timeline: LivenessTimelineEntry[],
  yaws: Array<number | null>
): ActiveLiveness {
  const reasons: string[] = []
  const sameOrder =
    timeline.length === expected.length && timeline.every((entry, index) => entry.step === expected[index])
  if (!sameOrder) reasons.push('ترتيب الحركات في التسجيل لا يطابق التحدي المرسل')
  const steps = expected.map((step, index) => {
    const yaw = yaws[index] ?? null
    return {
      step,
      yaw: yaw === null ? null : Math.round(yaw * 1000) / 1000,
      ok: yaw !== null && stepSatisfied(step, yaw),
    }
  })
  if (steps.some(item => item.yaw === null)) reasons.push('لم يظهر الوجه بوضوح أثناء بعض الحركات')
  if (steps.some(item => item.yaw !== null && !item.ok)) reasons.push('لم تُنفَّذ حركات الرأس المطلوبة بالترتيب')
  return { passed: reasons.length === 0, steps, reasons: [...new Set(reasons)] }
}

/** Measures the head pose in the middle of each step of the recording and judges it against the challenge. */
export async function verifyActiveLiveness(input: {
  video: Buffer
  expected: LivenessStep[]
  timeline: LivenessTimelineEntry[]
}): Promise<ActiveLiveness> {
  const usable = input.timeline.slice(0, input.expected.length)
  const middles = usable.map(entry => Math.max(0, (entry.startMs + (entry.endMs - entry.startMs) * 0.6) / 1000))
  const frames = await framesAt(input.video, middles)
  const yaws: Array<number | null> = []
  for (const frame of frames) {
    const result = frame ? await embedLargestFace(frame).catch(() => null) : null
    yaws.push(result ? yawOf(result.face) : null)
  }
  return judgeActiveLiveness(input.expected, usable, yaws)
}
