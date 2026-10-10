// Builds explainer.html from template.html (inlines the logo layers, the district map and a real QR code).
// Usage: node design/explainer/build.mjs
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'
const dir = fileURLToPath(new URL('.', import.meta.url))
const geo = JSON.parse(fs.readFileSync(dir + 'dhiqar-geo.json', 'utf8'))
const logoPage = fs.readFileSync(dir + '../../public/brand/motion/tq-logo-motion.html', 'utf8')
const tqm = logoPage.slice(logoPage.indexOf('<svg viewBox'), logoPage.indexOf('<!-- … to here')).replace(/<\/div>\s*$/, '')
  .replace(/src="tq-/g, 'src="../../public/brand/motion/tq-')
const districts = geo.districts.map((d, i) => `<path class="d" d="${d.d}" style="--at:${(0.2 + i * 0.06).toFixed(2)}s"/>`).join('')
const pts = geo.points.map((p, i) => `<circle class="pt" cx="${p.p[0]}" cy="${p.p[1]}" r="5" style="--at:${(1.6 + i * 0.03).toFixed(2)}s"/>`).join('')
const map = `<svg viewBox="0 0 ${geo.W} ${geo.H}">${districts}<path class="g" d="${geo.gov}"/>${pts}</svg>`
const qr = (await QRCode.toString('https://www.thi-qar.com/verify', { type: 'svg', margin: 0 })).replace('<svg', '<svg class="qr"')
let html = fs.readFileSync(dir + 'template.html', 'utf8')
html = html.replace('__TQM__', tqm).replace('__MAP__', map).replace('__QR__', qr).replace('__POINTS__', geo.points.length.toLocaleString('ar-IQ'))
fs.writeFileSync(dir + 'explainer.html', html)
console.log('explainer.html written')
