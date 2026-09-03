/**
 * Folder notes — the note that defines a folder.
 *
 * The convention is the one Obsidian's folder-note plugins settled on: a note
 * inside the folder sharing its name. `Projects/Q3 Launch` is defined by
 * `Projects/Q3 Launch/Q3 Launch.md`. Nothing but the filename marks it, so a
 * vault full of folder notes still opens cleanly in any other markdown app.
 *
 * The link every child holds back to its folder note is *derived* from the
 * path rather than written into the file. That keeps a move from rewriting
 * every note it touches, and keeps the breadcrumb from ever disagreeing with
 * where the note actually sits.
 */

/** The path a folder's defining note would have. Empty folder = vault root. */
export function folderNotePath(folderRel: string): string | null {
  const clean = folderRel.replace(/\/+$/, '')
  if (!clean) return null
  const name = clean.split('/').pop()!
  return `${clean}/${name}.md`
}

/** The folder a note defines, or null when it is an ordinary note. */
export function folderDefinedBy(relPath: string): string | null {
  const parts = relPath.replace(/\.md$/i, '').split('/')
  if (parts.length < 2) return null
  if (parts[parts.length - 1] !== parts[parts.length - 2]) return null
  return parts.slice(0, -1).join('/')
}

export function isFolderNote(relPath: string): boolean {
  return folderDefinedBy(relPath) !== null
}

/** The folder holding a note, `''` for the vault root. */
export function parentFolder(relPath: string): string {
  const cut = relPath.lastIndexOf('/')
  return cut === -1 ? '' : relPath.slice(0, cut)
}

/**
 * The folder a note answers to.
 *
 * For an ordinary note that is simply the directory holding it. For a folder
 * note it is the folder *above* the one it defines — otherwise a folder note
 * would be its own parent and the breadcrumb would loop.
 */
export function homeFolder(relPath: string): string {
  const defines = folderDefinedBy(relPath)
  return defines ? parentFolder(defines) : parentFolder(relPath)
}

/**
 * The folders a note sits under, outermost first — the breadcrumb trail.
 *
 * A folder note is excluded from its own trail: `Projects/Q3/Q3.md` leads back
 * to `Projects`, not to `Projects/Q3`, because that is the folder it *is*.
 */
export function ancestorFolders(relPath: string): string[] {
  const start = homeFolder(relPath)
  if (!start) return []
  const parts = start.split('/')
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

/** Display name for a folder — its last segment. */
export function folderName(folderRel: string): string {
  return folderRel.split('/').pop() ?? folderRel
}
