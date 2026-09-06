import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
for (const path of ['/', '/login', '/staff/login', '/onboarding', '/verify', '/service/store-license']) {
  await p.goto('http://localhost:8787' + path, { waitUntil: 'networkidle' })
  const out = await p.evaluate(() => {
    const r = []
    for (const el of document.querySelectorAll('body *')) {
      if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue
      const ff = getComputedStyle(el).fontFamily
      if (/Inter|Lucida|Helvetica|monospace/.test(ff))
        r.push(
          `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')} [${ff.split(',')[0]}] «${el.textContent.trim().slice(0, 25)}»`
        )
    }
    return [...new Set(r)]
  })
  console.log(path, out)
}
await b.close()
