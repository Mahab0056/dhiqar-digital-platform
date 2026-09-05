// Removes import specifiers reported by tsc as TS6133/TS6192 (unused). Usage: node prune-unused-imports.mjs <tsconfig>
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
const project = process.argv[2] || 'tsconfig.app.json'
let out = ''
try {
  execSync(`npx tsc -p ${project}`, { encoding: 'utf8' })
} catch (e) {
  out = e.stdout
}
const byFile = new Map()
for (const m of out.matchAll(/^(.+?)\((\d+),\d+\): error TS6133: '([\w$]+)' is declared/gm)) {
  const [, file, line, name] = m
  byFile.set(file, [...(byFile.get(file) || []), { line: Number(line), name }])
}
for (const m of out.matchAll(/^(.+?)\((\d+),\d+\): error TS6192: All imports/gm)) {
  const [, file, line] = m
  byFile.set(file, [...(byFile.get(file) || []), { line: Number(line), all: true }])
}
for (const [file, items] of byFile) {
  const lines = readFileSync(file, 'utf8').split('\n')
  items.sort((a, b) => a.line - b.line)
  for (const item of items) {
    const { line, name } = item
    let start = line - 1
    while (start > 0 && !/^import\b/.test(lines[start])) start--
    if (!/^import\b/.test(lines[start])) continue
    let end = start
    while (!/from '/.test(lines[end]) && !/^import '/.test(lines[end])) end++
    let stmt = lines.slice(start, end + 1).join('\n')
    if (item.all) stmt = ''
    else {
      stmt = stmt.replace(new RegExp(`(?<=[{,\\s])(?:type\\s+)?(?:\\w+\\s+as\\s+)?${name}\\s*,?`), '')
      stmt = stmt.replace(/,\s*}/, ' }').replace(/{\s*}/, '{}')
      if (/import\s+(type\s+)?\{\}\s+from/.test(stmt)) stmt = ''
      if (/^import\s+,/.test(stmt)) stmt = stmt.replace(/^import\s+,\s*/, 'import ')
    }
    const newLines = stmt ? stmt.split('\n') : []
    lines.splice(start, end - start + 1, ...newLines)
    const delta = newLines.length - (end - start + 1)
    for (const other of items) if (other.line > line) other.line += delta
  }
  writeFileSync(file, lines.join('\n'))
}
console.log(`pruned in ${byFile.size} files`)
