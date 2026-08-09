import fs from 'node:fs/promises'
import path from 'node:path'
import type { ThemeInfo } from '@shared/types'

/**
 * Themes.
 *
 * A snippet and a theme are the same technology and different intents, which is
 * why they are not the same feature: snippets stack, and you keep adding them,
 * whereas exactly one theme is in force and picking a new one replaces it.
 * Collapsing the two would mean a user who wanted a different look had to
 * remember which of their stylesheets to turn off first.
 *
 * A theme is one `.css` file in a folder inside the vault, so it syncs with the
 * notes and can be edited in place. The first comment block, if it names things,
 * becomes the theme's metadata — the same convention userstyles have used for
 * years, and it means a theme is still a single file you can email someone.
 */

const META_RE = /^\s*\/\*([\s\S]*?)\*\//

function readMeta(css: string, fallbackName: string): Omit<ThemeInfo, 'relPath'> {
  const block = META_RE.exec(css)?.[1] ?? ''
  const field = (key: string): string | null =>
    new RegExp(`^\\s*\\*?\\s*${key}\\s*:\\s*(.+)$`, 'im').exec(block)?.[1]?.trim() ?? null
  return {
    name: field('name') ?? fallbackName,
    author: field('author'),
    description: field('description')
  }
}

/** Every theme in the vault's theme folder. Missing folder is not an error. */
export async function listThemes(vaultPath: string, folder: string): Promise<ThemeInfo[]> {
  const dir = path.join(vaultPath, folder)
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return []
  }

  const themes: ThemeInfo[] = []
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.css')) continue
    const abs = path.join(dir, name)
    try {
      const css = await fs.readFile(abs, 'utf8')
      themes.push({
        relPath: `${folder}/${name}`,
        ...readMeta(css, name.replace(/\.css$/i, ''))
      })
    } catch {
      // An unreadable file simply is not offered.
    }
  }
  return themes.sort((a, b) => a.name.localeCompare(b.name))
}

/** The active theme's CSS, or empty when none is set or it has gone missing. */
export async function readTheme(vaultPath: string, relPath: string | null): Promise<string> {
  if (!relPath) return ''
  const absolute = path.resolve(vaultPath, ...relPath.split('/'))
  const root = path.resolve(vaultPath)
  // Themes are vault files, and the setting is user-editable text — so the same
  // containment check every other path crossing IPC gets applies here too.
  if (!absolute.startsWith(root + path.sep)) return ''
  try {
    return await fs.readFile(absolute, 'utf8')
  } catch {
    return ''
  }
}
