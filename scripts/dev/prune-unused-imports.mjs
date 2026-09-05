// Removes import specifiers reported by tsc as TS6133 (declared but never read).
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
let out = ''
try { execSync('npx tsc -p tsconfig.app.json', { encoding: 'utf8' }) } catch (e) { out = e.stdout }
const byFile = new Map()
for (const m of out.matchAll(/^(.+?)\((\d+),\d+\): error TS6133: '([\w$]+)' is declared/gm)) {
  const [, file, line, name] = m
  byFile.set(file, [...(byFile.get(file) || []), { line: Number(line), name }])
}
for (const [file, items] of byFile) {
  const lines = readFileSync(file, 'utf8').split('\n')
  for (const { line, name } of items) {
    // find import statement containing this line
    let start = line - 1
    while (start > 0 && !/^import\b/.test(lines[start])) start--
    if (!/^import\b/.test(lines[start])) continue
    let end = start
    while (!/from '/.test(lines[end])) end++
    let stmt = lines.slice(start, end + 1).join('\n')
    stmt = stmt.replace(new RegExp(`(?<=[{,\\s])(?:type\\s+)?(?:\\w+\\s+as\\s+)?${name}\\s*,?`), '')
    stmt = stmt.replace(/,\s*}/, ' }').replace(/{\s*}/, '{}')
    if (/import\s+(type\s+)?\{\}\s+from/.test(stmt)) stmt = ''
    lines.splice(start, end - start + 1, ...(stmt ? stmt.split('\n') : []))
    // adjust subsequent line numbers for this file
    const delta = (stmt ? stmt.split('\n').length : 0) - (end - start + 1)
    for (const other of items) if (other.line > line) other.line += delta
  }
  writeFileSync(file, lines.join('\n'))
}
console.log(`pruned in ${byFile.size} files`)
