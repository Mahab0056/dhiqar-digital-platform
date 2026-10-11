// Renders one watermarked sample PDF per official document template, then (when Python + PyMuPDF are available)
// PNG previews and the gallery thumbnails in public/document-templates/ (the only output that is committed).
// The PDFs and PNGs go to .qa-tmp/document-samples/ (git-ignored): they are rewritten whenever the renderer changes,
// so regenerate them on demand instead of committing megabytes of binaries.
// Usage: npx tsx scripts/generate-document-samples.mts [--out <dir>] [template-id …]
// An --out inside the repository must be git-ignored (e.g. not docs/ or public/): the script refuses otherwise.
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { documentTemplates } from '../server/documents/templates.ts'
import { renderDocumentPdf } from '../server/documents/render.ts'
import { sampleModel } from '../server/documents/samples.ts'

const root = process.cwd()
const args = process.argv.slice(2)
const outFlag = args.indexOf('--out')
const outDir =
  outFlag >= 0 && args[outFlag + 1] ? resolve(args[outFlag + 1]) : join(root, '.qa-tmp', 'document-samples')
const pngDir = join(outDir, 'png')
const thumbDir = join(root, 'public', 'document-templates')

// samples are throwaway renders: inside the repository they may only go to a git-ignored folder, never to a
// committed one (docs/) nor to public/, which is copied into the served build
const inRepo = relative(root, outDir)
if (inRepo && !inRepo.startsWith('..') && !isAbsolute(inRepo)) {
  const probe = join(inRepo, 'sample.pdf').replaceAll('\\', '/')
  const check = spawnSync('git', ['check-ignore', '-q', '--no-index', probe], { cwd: root })
  if (check.status === 1 || /^public([\\/]|$)/.test(inRepo)) {
    console.error(`${inRepo} is not git-ignored (or is served from public/): use the default .qa-tmp/document-samples.`)
    process.exit(1)
  }
}
for (const dir of [outDir, pngDir, thumbDir]) mkdirSync(dir, { recursive: true })

const only = args.filter((_, index) => outFlag < 0 || (index !== outFlag && index !== outFlag + 1))
const files: string[] = []
for (const [index, template] of documentTemplates.entries()) {
  if (only.length && !only.includes(template.id)) continue
  const pdf = await renderDocumentPdf(sampleModel(template.id))
  const file = join(outDir, `${String(index + 1).padStart(2, '0')}-${template.id}.pdf`)
  writeFileSync(file, pdf)
  files.push(file)
  console.log(`${template.id.padEnd(22)} ${(pdf.length / 1024).toFixed(0).padStart(4)} KB  ${file}`)
}

const python = spawnSync('python', [join(root, 'scripts', 'render-pdf-previews.py'), pngDir, thumbDir, ...files], {
  stdio: 'inherit',
})
if (python.status !== 0) console.warn('PNG previews skipped (needs python + pymupdf).')
