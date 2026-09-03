/**
 * Fail the build on a CSS custom property that is used but never defined.
 *
 * This exists because that mistake is invisible at runtime. A `var(--gone)`
 * with no definition is not a parse error and warns nowhere — the declaration
 * is dropped at computed-value time and the property silently falls back to
 * whatever it inherits. A whole palette of calendar chips rendered colourless
 * for exactly this reason, and the `var(--x, fallback)` written to guard it did
 * not help: the fallback only fires when the property is *undefined*, not when
 * it is defined to something invalid, so an inline `--chip: var(--iris)` sails
 * straight past it.
 *
 * Properties set from JS inline styles are legitimately absent from the
 * stylesheets, so they are listed here rather than discovered.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'src')

/** Custom properties assigned by a component's inline `style`, not by CSS. */
const SET_INLINE = new Set(['--chip', '--viz-hue', '--cols', '--depth', '--pct'])

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.(css|ts|tsx|html)$/.test(entry.name)) out.push(full)
  }
  return out
}

const files = walk(src)
const defined = new Set()
const used = new Map()

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')

  // A definition is a declaration in a rule block; a JS inline style counts too,
  // which is why `'--chip': value` in a tsx object is picked up here.
  for (const m of text.matchAll(/(?:^|[;{\s'"])(--[a-zA-Z0-9-]+)\s*:/gm)) defined.add(m[1])

  for (const m of text.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
    const line = text.slice(0, m.index).split('\n').length
    if (!used.has(m[1])) used.set(m[1], [])
    used.get(m[1]).push(`${path.relative(root, file)}:${line}`)
  }
}

const missing = [...used.keys()].filter((name) => !defined.has(name) && !SET_INLINE.has(name)).sort()

if (missing.length === 0) {
  console.log(`tokens ok — ${used.size} custom properties, all defined`)
  process.exit(0)
}

console.error('Undefined CSS custom properties:\n')
for (const name of missing) {
  console.error(`  ${name}`)
  for (const where of used.get(name).slice(0, 6)) console.error(`      ${where}`)
}
console.error('\nDefine them in styles/tokens.css, or use a token that exists.')
process.exit(1)
