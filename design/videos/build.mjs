// Builds register.html and protect.html from their templates (inlines the TQ logo layers and a real QR code).
// Usage (from the project root): node design/videos/build.mjs
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'

const dir = fileURLToPath(new URL('.', import.meta.url))
const logoPage = fs.readFileSync(dir + '../../public/brand/motion/tq-logo-motion.html', 'utf8')
const tqm = logoPage
  .slice(logoPage.indexOf('<svg viewBox'), logoPage.indexOf('<!-- … to here'))
  .replace(/<\/div>\s*$/, '')
  .replace(/src="tq-/g, 'src="../../public/brand/motion/tq-')
const qr = (await QRCode.toString('https://www.thi-qar.com/verify', { type: 'svg', margin: 0 })).replace('<svg', '<svg class="qr"')

for (const name of ['register', 'protect']) {
  const html = fs.readFileSync(`${dir}${name}.template.html`, 'utf8').replace('__TQM__', tqm).replace('__QR__', qr)
  fs.writeFileSync(`${dir}${name}.html`, html)
  console.log(`${name}.html written`)
}
