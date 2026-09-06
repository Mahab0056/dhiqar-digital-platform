import { chromium } from 'playwright'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
await page.goto('http://localhost:8787/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
for (let y = 0; y < 4000; y += 300) { await page.evaluate(y => window.scrollTo(0, y), y); await page.waitForTimeout(250) }
await page.waitForTimeout(1000)
const info = await page.evaluate(() => [...document.querySelectorAll('[data-reveal]')].map(el => ({ tag: el.tagName, cls: String(el.className).slice(0, 40), revealed: el.classList.contains('is-revealed'), opacity: getComputedStyle(el).opacity, top: Math.round(el.getBoundingClientRect().top + scrollY) })))
console.log(JSON.stringify(info, null, 0))
await page.evaluate(() => scrollTo(0, 0))
await page.screenshot({ path: 'qa-screens/audit/home-desktop-after-slow-scroll.png', fullPage: true })
await browser.close()
