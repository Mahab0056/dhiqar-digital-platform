import fs from 'node:fs'
const dir = process.argv[2]
const g = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))
let h = fs.readFileSync(dir + '/template.html', 'utf8')
const minLng = 45.63, maxLat = 32.0, k = Math.cos(31.25 * Math.PI / 180), sx = g.W / ((47.14 - 45.63) * k)
const P = (lng, lat) => [((lng - minLng) * k * sx).toFixed(1), ((maxLat - lat) * sx).toFixed(1)]
const [cx, cy] = P(46.258, 31.045)
const districts = g.districts.map((d, i) => `<path class="d" d="${d.d}" data-name="${d.name}" data-count="${d.count}" style="animation-delay:${(0.15 + i * 0.07).toFixed(2)}s"/>`).join('')
const points = g.points.map((p, i) => `<circle class="pt" cx="${p[0]}" cy="${p[1]}" r="2.6" style="animation-delay:${(1.6 + i * 0.02).toFixed(2)}s"/>`).join('')
const labels = g.districts.map(d => `<text x="${d.c[0]}" y="${d.c[1]}">${d.name}</text>`).join('')
const strip = [...g.districts].sort((a, b) => b.count - a.count).map(d => `<a class="dc"><svg viewBox="0 0 100 100"><path d="${d.solo}"/></svg><b>${d.name}</b><small>${d.count} ${d.count > 10 ? 'دائرة' : d.count > 2 ? 'دوائر' : d.count === 2 ? 'دائرتان' : 'دائرة'} حكومية</small></a>`).join('')
// QR-like module grid
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const n = 21, cells = []
const finder = (x, y) => { for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) if (i === 0 || i === 6 || j === 0 || j === 6 || (i > 1 && i < 5 && j > 1 && j < 5)) cells.push([x + i, y + j]) }
finder(0, 0); finder(n - 7, 0); finder(0, n - 7)
for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const res = (i < 8 && j < 8) || (i >= n - 8 && j < 8) || (i < 8 && j >= n - 8); if (!res && rnd() < 0.48) cells.push([i, j]) }
const qr = `<svg class="qr" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">${cells.map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1"/>`).join('')}</svg>`
h = h.replaceAll('{{W}}', g.W).replaceAll('{{H}}', g.H).replace('{{DISTRICTS}}', districts).replace('{{GOV}}', g.gov).replace('{{POINTS}}', points)
  .replace('{{CX}}', cx).replace('{{CY}}', cy).replace('{{LABELS}}', labels).replace('{{STRIP}}', strip).replace('{{QR}}', qr).replace('{{DATA}}', '{}')
fs.writeFileSync(dir + '/index.html', h)
console.log('built', h.length)
