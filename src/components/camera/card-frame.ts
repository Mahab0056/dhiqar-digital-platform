import { grayFromRgba, type Region, type SlotId } from './card-quality'

/**
 * One picture per tick. The video is drawn once — at full resolution, with the margin kept for the photo — and the
 * small analysis picture is drawn from that canvas, never from the video again: the video moves on between two draws
 * (by 20–500 ms on a busy phone), so measuring one frame and keeping another delivered blurred photos that had been
 * scored as sharp.
 */

/** A kept frame: its full-resolution canvas and what was measured on exactly that picture. */
export type HeldFrame = {
  canvas: HTMLCanvasElement
  /** the analysis picture (grey levels) the frame was scored on */
  gray: Uint8ClampedArray
  sharpness: number
  /** light × reflections × presence, to compare a still photo with */
  conditions: number
}

type Area = { inner: Region; outer: Region }

/**
 * Draws this tick's video frame into `target` (the outer region, full resolution) and its inner region from there
 * into the analysis context. Returns the analysis picture in grey levels, or null without a 2D context.
 */
export function grabFrame(
  video: CanvasImageSource,
  area: Area,
  target: HTMLCanvasElement,
  analysis: CanvasRenderingContext2D,
  size: { width: number; height: number }
): Uint8ClampedArray | null {
  const { inner, outer } = area
  const width = Math.max(1, Math.round(outer.w))
  const height = Math.max(1, Math.round(outer.h))
  if (target.width !== width) target.width = width
  if (target.height !== height) target.height = height
  const context = target.getContext('2d')
  if (!context) return null
  context.drawImage(video, outer.x, outer.y, outer.w, outer.h, 0, 0, width, height)
  const scaleX = width / outer.w
  const scaleY = height / outer.h
  analysis.drawImage(
    target,
    (inner.x - outer.x) * scaleX,
    (inner.y - outer.y) * scaleY,
    inner.w * scaleX,
    inner.h * scaleY,
    0,
    0,
    size.width,
    size.height
  )
  return grayFromRgba(analysis.getImageData(0, 0, size.width, size.height).data, size.width * size.height)
}

/**
 * The best-frame buffer's pictures: two kept frames and one scratch canvas that every tick draws into. Keeping this
 * tick's frame is a pointer swap — the scratch canvas becomes the slot's, and the canvas it replaces becomes the next
 * scratch — so nothing is copied and no canvas is created after the first few ticks.
 */
export function createFrameStore(make: () => HTMLCanvasElement) {
  const slots: Array<HeldFrame | undefined> = [undefined, undefined]
  let scratch: HTMLCanvasElement | null = null
  return {
    /** the canvas to draw this tick's frame into */
    scratch: () => (scratch ??= make()),
    /** keeps the scratch canvas (this tick's frame) in `slot`, with what was measured on it */
    keep(slot: SlotId, measured: Omit<HeldFrame, 'canvas'>) {
      const canvas = scratch ?? make()
      scratch = slots[slot]?.canvas ?? null
      slots[slot] = { ...measured, canvas }
    },
    get: (slot: SlotId) => slots[slot],
  }
}

export type FrameStore = ReturnType<typeof createFrameStore>
