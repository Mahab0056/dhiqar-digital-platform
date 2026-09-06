import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import sharp, { type Sharp } from 'sharp'

/**
 * On-server face verification (no external provider, no image leaves the platform):
 *   SCRFD-500M face detection (+5 landmarks) → similarity-transform alignment to 112×112 →
 *   MobileFaceNet/ArcFace 512-d embedding → cosine similarity.
 * Compares the portrait on the ID document with several frames of the citizen's 7-second face video and
 * also checks that the video frames agree with each other (a cheap liveness/consistency signal).
 *
 * Runs on CPU through onnxruntime-node. ffmpeg (if present) extracts video frames; without it the
 * comparison reports FRAMES_UNAVAILABLE instead of guessing.
 */
const execFileAsync = promisify(execFile)
const currentDir = dirname(fileURLToPath(import.meta.url))
const modelsDir = process.env.FACE_MODELS_DIR?.trim() || join(currentDir, 'assets', 'models')

type Ort = typeof import('onnxruntime-node')
type Session = import('onnxruntime-node').InferenceSession

let ortModule: Ort | null = null
let detector: Promise<Session> | null = null
let recognizer: Promise<Session> | null = null

async function ort() {
  if (!ortModule) {
    const loaded = (await import('onnxruntime-node')) as unknown as { default?: Ort } & Ort
    ortModule = loaded.InferenceSession ? loaded : (loaded.default as Ort)
  }
  return ortModule
}

export function faceMatchAvailable() {
  return existsSync(join(modelsDir, 'det_500m.onnx')) && existsSync(join(modelsDir, 'w600k_mbf.onnx'))
}

async function sessions() {
  const runtime = await ort()
  const options = { executionProviders: ['cpu'], graphOptimizationLevel: 'all' as const, intraOpNumThreads: 2 }
  detector ||= runtime.InferenceSession.create(join(modelsDir, 'det_500m.onnx'), options)
  recognizer ||= runtime.InferenceSession.create(join(modelsDir, 'w600k_mbf.onnx'), options)
  return { runtime, det: await detector, rec: await recognizer }
}

export type DetectedFace = { box: [number, number, number, number]; score: number; kps: Array<[number, number]> }

const DET_SIZE = 640

/** SCRFD decode for strides 8/16/32 with 2 anchors per cell. */
async function detectFaces(image: Sharp, width: number, height: number): Promise<DetectedFace[]> {
  const { runtime, det } = await sessions()
  const scale = Math.min(DET_SIZE / width, DET_SIZE / height)
  const newW = Math.round(width * scale)
  const newH = Math.round(height * scale)
  const { data } = await image
    .clone()
    .resize(newW, newH)
    .extend({ top: 0, left: 0, bottom: DET_SIZE - newH, right: DET_SIZE - newW, background: { r: 0, g: 0, b: 0 } })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const plane = DET_SIZE * DET_SIZE
  const input = new Float32Array(3 * plane)
  for (let index = 0; index < plane; index++) {
    input[index] = (data[index * 3] - 127.5) / 128
    input[plane + index] = (data[index * 3 + 1] - 127.5) / 128
    input[2 * plane + index] = (data[index * 3 + 2] - 127.5) / 128
  }
  const feeds = { [det.inputNames[0]]: new runtime.Tensor('float32', input, [1, 3, DET_SIZE, DET_SIZE]) }
  const output = await det.run(feeds)
  const names = det.outputNames
  const strides = [8, 16, 32]
  const faces: DetectedFace[] = []
  for (let level = 0; level < 3; level++) {
    const stride = strides[level]
    const scores = output[names[level]].data as Float32Array
    const boxes = output[names[level + 3]].data as Float32Array
    const kps = output[names[level + 6]].data as Float32Array
    const cells = DET_SIZE / stride
    for (let index = 0; index < scores.length; index++) {
      const score = scores[index]
      if (score < 0.5) continue
      const cell = Math.floor(index / 2)
      const cx = (cell % cells) * stride
      const cy = Math.floor(cell / cells) * stride
      const x1 = (cx - boxes[index * 4] * stride) / scale
      const y1 = (cy - boxes[index * 4 + 1] * stride) / scale
      const x2 = (cx + boxes[index * 4 + 2] * stride) / scale
      const y2 = (cy + boxes[index * 4 + 3] * stride) / scale
      const points: Array<[number, number]> = []
      for (let k = 0; k < 5; k++)
        points.push([
          (cx + kps[index * 10 + k * 2] * stride) / scale,
          (cy + kps[index * 10 + k * 2 + 1] * stride) / scale,
        ])
      faces.push({ box: [x1, y1, x2, y2], score, kps: points })
    }
  }
  return nms(faces, 0.4)
}

function nms(faces: DetectedFace[], threshold: number) {
  const sorted = [...faces].sort((a, b) => b.score - a.score)
  const kept: DetectedFace[] = []
  for (const face of sorted) {
    if (kept.every(other => iou(face.box, other.box) < threshold)) kept.push(face)
  }
  return kept
}

function iou(a: [number, number, number, number], b: [number, number, number, number]) {
  const x1 = Math.max(a[0], b[0])
  const y1 = Math.max(a[1], b[1])
  const x2 = Math.min(a[2], b[2])
  const y2 = Math.min(a[3], b[3])
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const areaA = (a[2] - a[0]) * (a[3] - a[1])
  const areaB = (b[2] - b[0]) * (b[3] - b[1])
  return inter / (areaA + areaB - inter + 1e-6)
}

/** ArcFace 112×112 reference landmarks (left eye, right eye, nose, mouth left, mouth right). */
const TEMPLATE: Array<[number, number]> = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
]

/** Umeyama similarity transform (rotation + uniform scale + translation) from src → dst. */
function similarityTransform(src: Array<[number, number]>, dst: Array<[number, number]>) {
  const n = src.length
  const meanS = [0, 0]
  const meanD = [0, 0]
  for (let i = 0; i < n; i++) {
    meanS[0] += src[i][0] / n
    meanS[1] += src[i][1] / n
    meanD[0] += dst[i][0] / n
    meanD[1] += dst[i][1] / n
  }
  let sxx = 0
  let sxy = 0
  let syx = 0
  let syy = 0
  let varS = 0
  for (let i = 0; i < n; i++) {
    const sx = src[i][0] - meanS[0]
    const sy = src[i][1] - meanS[1]
    const dx = dst[i][0] - meanD[0]
    const dy = dst[i][1] - meanD[1]
    sxx += dx * sx
    sxy += dx * sy
    syx += dy * sx
    syy += dy * sy
    varS += sx * sx + sy * sy
  }
  // closed form for 2D similarity: rotation angle from the cross-covariance
  const a = sxx + syy
  const b = syx - sxy
  const scale = Math.sqrt(a * a + b * b) / (varS || 1)
  const cos = (a / Math.sqrt(a * a + b * b || 1)) * scale
  const sin = (b / Math.sqrt(a * a + b * b || 1)) * scale
  const tx = meanD[0] - (cos * meanS[0] - sin * meanS[1])
  const ty = meanD[1] - (sin * meanS[0] + cos * meanS[1])
  return { cos, sin, tx, ty }
}

async function alignedFace(image: Sharp, face: DetectedFace, width: number, height: number) {
  const { cos, sin, tx, ty } = similarityTransform(face.kps, TEMPLATE)
  const matrix: [[number, number], [number, number]] = [
    [cos, -sin],
    [sin, cos],
  ]
  // libvips sizes the output to the bounding box of A·input (offsets excluded) and shifts the content by odx/ody,
  // so the translation must be expressed relative to that box's origin.
  const corners = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ].map(([x, y]) => [cos * x - sin * y, sin * x + cos * y])
  const minX = Math.min(...corners.map(corner => corner[0]))
  const minY = Math.min(...corners.map(corner => corner[1]))
  const warped = await image
    .clone()
    .removeAlpha()
    .affine(matrix, { background: '#000', odx: tx + minX, ody: ty + minY, interpolator: sharp.interpolators.bicubic })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return sharp(warped.data, { raw: { width: warped.info.width, height: warped.info.height, channels: 3 } })
    .extend({
      top: 0,
      left: 0,
      right: Math.max(0, 112 - warped.info.width),
      bottom: Math.max(0, 112 - warped.info.height),
      background: '#000',
    })
    .extract({ left: 0, top: 0, width: 112, height: 112 })
    .raw()
    .toBuffer()
}

async function embed(raw112: Buffer) {
  const { runtime, rec } = await sessions()
  const plane = 112 * 112
  const input = new Float32Array(3 * plane)
  for (let index = 0; index < plane; index++) {
    input[index] = (raw112[index * 3] - 127.5) / 127.5
    input[plane + index] = (raw112[index * 3 + 1] - 127.5) / 127.5
    input[2 * plane + index] = (raw112[index * 3 + 2] - 127.5) / 127.5
  }
  const output = await rec.run({ [rec.inputNames[0]]: new runtime.Tensor('float32', input, [1, 3, 112, 112]) })
  const vector = Array.from(output[rec.outputNames[0]].data as Float32Array)
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1
  return vector.map(value => value / norm)
}

const cosine = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + value * b[index], 0)

export type FaceEmbeddingResult = { embedding: number[]; face: DetectedFace; faces: number }

/** Largest detected face → embedding. Returns null when no face is found. */
export async function embedLargestFace(imageBuffer: Buffer): Promise<FaceEmbeddingResult | null> {
  const image = sharp(imageBuffer, { failOn: 'none' }).rotate()
  const meta = await image.metadata()
  if (!meta.width || !meta.height) return null
  const faces = await detectFaces(image, meta.width, meta.height)
  if (!faces.length) return null
  const largest = faces.reduce((best, face) =>
    (face.box[2] - face.box[0]) * (face.box[3] - face.box[1]) >
    (best.box[2] - best.box[0]) * (best.box[3] - best.box[1])
      ? face
      : best
  )
  const embedding = await embed(await alignedFace(image, largest, meta.width, meta.height))
  return { embedding, face: largest, faces: faces.length }
}

async function ffmpegAvailable() {
  try {
    await execFileAsync('ffmpeg', ['-version'])
    return true
  } catch {
    return false
  }
}

/** Extracts up to `count` evenly spaced JPEG frames from a short video. */
export async function extractVideoFrames(video: Buffer, count = 5): Promise<Buffer[]> {
  if (!(await ffmpegAvailable())) return []
  const dir = mkdtempSync(join(tmpdir(), 'dhiqar-face-'))
  try {
    const input = join(dir, 'input.webm')
    await import('node:fs/promises').then(fs => fs.writeFile(input, video))
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-i',
        input,
        '-vf',
        `fps=${count}/7,scale=640:-2`,
        '-frames:v',
        String(count),
        '-q:v',
        '3',
        join(dir, 'frame-%02d.jpg'),
      ],
      { timeout: 20_000 }
    )
    return readdirSync(dir)
      .filter(name => name.startsWith('frame-'))
      .sort()
      .map(name => readFileSync(join(dir, name)))
  } catch {
    return []
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export type FaceVerification = {
  status:
    | 'MATCH'
    | 'UNCERTAIN'
    | 'NO_MATCH'
    | 'NO_FACE_ON_DOCUMENT'
    | 'NO_FACE_IN_VIDEO'
    | 'FRAMES_UNAVAILABLE'
    | 'UNAVAILABLE'
  similarity: number | null
  /** 0–100 confidence presented to reviewers */
  score: number | null
  framesAnalysed: number
  framesWithFace: number
  frameConsistency: number | null
  documentFaces: number
  provider: 'insightface-buffalo_sc-onnx'
  thresholds: { match: number; uncertain: number }
}

const THRESHOLD_MATCH = 0.42
const THRESHOLD_UNCERTAIN = 0.28

/** Maps cosine similarity to a reviewer-facing 0–100 confidence (0.28 → ~35, 0.42 → ~70, 0.6 → ~92). */
const toScore = (similarity: number) =>
  Math.round(Math.max(0, Math.min(100, 100 / (1 + Math.exp(-14 * (similarity - 0.36))))))

export async function verifyFaceAgainstDocument(input: {
  documentImage: Buffer
  faceVideo?: Buffer | null
  faceImages?: Buffer[]
}): Promise<FaceVerification> {
  const base: FaceVerification = {
    status: 'UNAVAILABLE',
    similarity: null,
    score: null,
    framesAnalysed: 0,
    framesWithFace: 0,
    frameConsistency: null,
    documentFaces: 0,
    provider: 'insightface-buffalo_sc-onnx',
    thresholds: { match: THRESHOLD_MATCH, uncertain: THRESHOLD_UNCERTAIN },
  }
  if (!faceMatchAvailable()) return base
  const document = await embedLargestFace(input.documentImage)
  if (!document) return { ...base, status: 'NO_FACE_ON_DOCUMENT' }
  base.documentFaces = document.faces
  let frames = input.faceImages || []
  if (!frames.length && input.faceVideo) frames = await extractVideoFrames(input.faceVideo, 5)
  if (!frames.length) return { ...base, status: 'FRAMES_UNAVAILABLE' }
  const embeddings: number[][] = []
  for (const frame of frames) {
    const result = await embedLargestFace(frame).catch(() => null)
    if (result) embeddings.push(result.embedding)
  }
  base.framesAnalysed = frames.length
  base.framesWithFace = embeddings.length
  if (!embeddings.length) return { ...base, status: 'NO_FACE_IN_VIDEO' }
  const similarities = embeddings.map(vector => cosine(document.embedding, vector))
  // median is robust against one blurry/turned frame
  const sorted = [...similarities].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const best = sorted[sorted.length - 1]
  const similarity = Math.round(((median + best) / 2) * 1000) / 1000
  let consistency: number | null = null
  if (embeddings.length > 1) {
    let total = 0
    let pairs = 0
    for (let i = 0; i < embeddings.length; i++)
      for (let j = i + 1; j < embeddings.length; j++) {
        total += cosine(embeddings[i], embeddings[j])
        pairs++
      }
    consistency = Math.round((total / pairs) * 1000) / 1000
  }
  return {
    ...base,
    similarity,
    score: toScore(similarity),
    frameConsistency: consistency,
    status: similarity >= THRESHOLD_MATCH ? 'MATCH' : similarity >= THRESHOLD_UNCERTAIN ? 'UNCERTAIN' : 'NO_MATCH',
  }
}
