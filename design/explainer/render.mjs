// Deterministic frame renderer: pauses every CSS/Web animation and seeks it frame by frame.
// Usage: node design/explainer/render.mjs <file.html[?query]> <seconds> <fps> <width> <height> <outDir> [transparent]
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs'
const [file, seconds, fps, width, height, outDir, transparent] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: +width, height: +height } })
const [fpath, query = ''] = file.split('?')
await page.goto('file://' + path.resolve(fpath) + (query ? '?' + query : ''))
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(400)
const total = Math.round(+seconds * +fps)
for (let f = 0; f < total; f++) {
  const ms = (f * 1000) / +fps
  await page.evaluate(ms => document.getAnimations().forEach(a => { a.pause(); a.currentTime = ms }), ms)
  await page.screenshot({
    path: `${outDir}/f${String(f).padStart(5, '0')}.${transparent ? 'png' : 'jpg'}`,
    ...(transparent ? { omitBackground: true } : { type: 'jpeg', quality: 92 }),
  })
}
await browser.close()
console.log('frames', total)
