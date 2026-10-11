import QRCode from 'qrcode'
import bwipjs from 'bwip-js'
import { drawLatin, latinWidth } from './text.js'

/** Security printing drawn as vectors: guilloche mesh, rosettes, microtext, QR modules and the linear barcode. */

type Box = { x: number; y: number; w: number; h: number }

/** Two families of phase-shifted sine waves crossing each other: the classic banknote mesh. */
export function guilloche(
  pdf: PDFKit.PDFDocument,
  box: Box,
  options: {
    color: string
    spacing?: number
    amplitude?: number
    wavelength?: number
    width?: number
    opacity?: number
  }
) {
  const spacing = options.spacing ?? 9
  const amplitude = options.amplitude ?? 7
  const wavelength = options.wavelength ?? 64
  pdf.save()
  pdf.rect(box.x, box.y, box.w, box.h).clip()
  pdf
    .lineWidth(options.width ?? 0.28)
    .strokeColor(options.color)
    .strokeOpacity(options.opacity ?? 1)
  const count = Math.ceil(box.h / spacing) + 4
  for (const family of [1, -1]) {
    for (let k = -2; k < count; k += 1) {
      const baseY = box.y + k * spacing
      const phase = family * k * 0.55
      for (let x = box.x - 4; x <= box.x + box.w + 4; x += 3) {
        const y =
          baseY +
          amplitude * Math.sin(((x - box.x) / wavelength) * Math.PI * 2 + phase) +
          amplitude * 0.35 * Math.sin(((x - box.x) / (wavelength * 0.37)) * Math.PI * 2 - phase * 1.7)
        if (x === box.x - 4) pdf.moveTo(x, y)
        else pdf.lineTo(x, y)
      }
      pdf.stroke()
    }
  }
  pdf.restore()
}

/** Spirograph-like rosette (epitrochoid family) centred on (cx, cy). */
export function rosette(
  pdf: PDFKit.PDFDocument,
  cx: number,
  cy: number,
  radius: number,
  options: { color: string; petals?: number; rings?: number; width?: number; opacity?: number }
) {
  const petals = options.petals ?? 18
  const rings = options.rings ?? 5
  pdf.save()
  pdf
    .lineWidth(options.width ?? 0.3)
    .strokeColor(options.color)
    .strokeOpacity(options.opacity ?? 1)
  for (let ring = 0; ring < rings; ring += 1) {
    const b = radius * (0.12 + ring * 0.045)
    const a = radius - b
    const turn = (ring * Math.PI) / (petals * rings)
    for (let step = 0; step <= 720; step += 1) {
      const t = (step / 720) * Math.PI * 2
      const x = cx + a * Math.cos(t + turn) + b * Math.cos(petals * t + turn)
      const y = cy + a * Math.sin(t + turn) - b * Math.sin(petals * t + turn)
      if (step === 0) pdf.moveTo(x, y)
      else pdf.lineTo(x, y)
    }
    pdf.stroke()
  }
  pdf.restore()
}

/** A line of 2–3pt repeated text: reads as a thin rule unless magnified, and does not survive photocopying. */
export function microtext(
  pdf: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  text: string,
  options: { color: string; size?: number }
) {
  const size = options.size ?? 2.4
  const unit = `${text} • `
  const unitWidth = latinWidth(pdf, unit, size, 'semibold')
  const repeat = Math.max(1, Math.ceil(width / Math.max(1, unitWidth)) + 1)
  pdf.save()
  pdf.rect(x, y - 1, width, size * 2).clip()
  drawLatin(pdf, unit.repeat(repeat), x, y, { size, style: 'semibold', color: options.color })
  pdf.restore()
}

/** QR drawn as vector modules (crisp at any print size), with an optional quiet emblem in the middle. */
export function drawQr(
  pdf: PDFKit.PDFDocument,
  payload: string,
  x: number,
  y: number,
  size: number,
  options: { color: string; emblem?: string | null }
) {
  const qr = QRCode.create(payload, { errorCorrectionLevel: options.emblem ? 'H' : 'M' })
  const count = qr.modules.size
  const quiet = 2
  const cell = size / (count + quiet * 2)
  pdf.save()
  pdf.rect(x, y, size, size).fill('#FFFFFF')
  pdf.fillColor(options.color)
  for (let row = 0; row < count; row += 1) {
    let start = -1
    for (let col = 0; col <= count; col += 1) {
      const dark = col < count && qr.modules.get(row, col)
      if (dark && start < 0) start = col
      if (!dark && start >= 0) {
        pdf.rect(x + (quiet + start) * cell, y + (quiet + row) * cell, (col - start) * cell + 0.05, cell + 0.05)
        start = -1
      }
    }
  }
  pdf.fill()
  if (options.emblem) {
    const box = cell * Math.max(5, Math.round(count * 0.2))
    const bx = x + size / 2 - box / 2
    const by = y + size / 2 - box / 2
    pdf.rect(bx - cell * 0.5, by - cell * 0.5, box + cell, box + cell).fill('#FFFFFF')
    try {
      pdf.image(options.emblem, bx, by, { fit: [box, box], align: 'center', valign: 'center' })
    } catch {
      // a missing emblem leaves the white box: still scannable at level H
    }
  }
  pdf.restore()
}

/** Code 128 of an opaque code (never personal data), rendered by bwip-js as a high-resolution PNG. */
export async function code128Png(text: string) {
  return bwipjs.toBuffer({
    bcid: 'code128',
    text,
    scale: 4,
    height: 9,
    includetext: false,
    barcolor: '0B3B2E',
    backgroundcolor: 'FFFFFF',
    paddingwidth: 0,
    paddingheight: 0,
  })
}

/** Diagonal "specimen" overlay for gallery samples and pre-issue previews. */
export function diagonalStamp(
  pdf: PDFKit.PDFDocument,
  page: { w: number; h: number },
  draw: (x: number, y: number, width: number) => void,
  angle = -32
) {
  pdf.save()
  pdf.rotate(angle, { origin: [page.w / 2, page.h / 2] })
  draw(page.w * 0.04, page.h / 2 - 40, page.w * 0.92)
  pdf.restore()
}
