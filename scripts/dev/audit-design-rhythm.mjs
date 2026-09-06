import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
for (const path of [
  '/',
  '/directory',
  '/service/muni-dir-complaint-against-municipality',
  '/departments/dhiqar-municipalities',
]) {
  await p.goto('http://localhost:8787' + path, { waitUntil: 'networkidle' })
  const out = await p.evaluate(() => {
    const rows = []
    for (const s of document.querySelectorAll(
      'main > section, main section.gov-band, .gov-home main > *, footer, header'
    )) {
      const cs = getComputedStyle(s)
      const r = s.getBoundingClientRect()
      const c = s.querySelector('.gov-container, .container') || s
      const cr = c.getBoundingClientRect()
      rows.push(
        `${s.tagName.toLowerCase()}#${s.id || ''}.${String(s.className).split(' ')[0]} h=${Math.round(r.height)} pad=${cs.paddingTop}/${cs.paddingBottom} container=${Math.round(cr.width)} bg=${cs.backgroundColor}`
      )
    }
    const h2 = [...document.querySelectorAll('h2')].slice(0, 8).map(h => {
      const cs = getComputedStyle(h)
      return `h2 ${cs.fontSize} mb=${cs.marginBottom} mt=${cs.marginTop}`
    })
    return rows.concat(h2)
  })
  console.log('==', path)
  console.log(out.join('\n'))
}
await b.close()
