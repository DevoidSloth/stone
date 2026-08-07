import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import type { Comment } from '@shared/types'

/**
 * Comments.
 *
 * The one piece of Stone's data that deliberately does not live in the markdown
 * file. A comment is a conversation *about* a note, not part of it — writing it
 * inline would change the document every time someone annotated it, and would
 * show up as noise in every other editor the vault is opened in.
 *
 * They live in `.stone/comments.json` inside the vault, so they travel with it
 * through whichever sync engine is replicating the folder.
 */

function commentsFile(vaultPath: string): string {
  return path.join(vaultPath, '.stone', 'comments.json')
}

async function readAll(vaultPath: string): Promise<Comment[]> {
  try {
    const raw = await fs.readFile(commentsFile(vaultPath), 'utf8')
    const parsed = JSON.parse(raw) as Comment[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeAll(vaultPath: string, comments: Comment[]): Promise<void> {
  const file = commentsFile(vaultPath)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(comments, null, 2), 'utf8')
  await fs.rename(tmp, file)
}

export async function listComments(vaultPath: string, relPath: string): Promise<Comment[]> {
  const all = await readAll(vaultPath)
  return all
    .filter((c) => c.relPath === relPath)
    .sort((a, b) => a.createdAt - b.createdAt)
}

export async function addComment(
  vaultPath: string,
  relPath: string,
  anchor: string,
  body: string
): Promise<Comment> {
  const comment: Comment = {
    id: crypto.randomUUID(),
    relPath,
    anchor: anchor.slice(0, 400),
    body: body.trim(),
    createdAt: Date.now(),
    resolved: false
  }
  const all = await readAll(vaultPath)
  all.push(comment)
  await writeAll(vaultPath, all)
  return comment
}

export async function updateComment(
  vaultPath: string,
  id: string,
  patch: Partial<Pick<Comment, 'body' | 'resolved'>>
): Promise<Comment | null> {
  const all = await readAll(vaultPath)
  const index = all.findIndex((c) => c.id === id)
  if (index === -1) return null
  all[index] = { ...all[index], ...patch }
  await writeAll(vaultPath, all)
  return all[index]
}

export async function removeComment(vaultPath: string, id: string): Promise<boolean> {
  const all = await readAll(vaultPath)
  const next = all.filter((c) => c.id !== id)
  if (next.length === all.length) return false
  await writeAll(vaultPath, next)
  return true
}

/** Drop every comment attached to a note that no longer exists. */
export async function pruneComments(vaultPath: string, livePaths: Set<string>): Promise<number> {
  const all = await readAll(vaultPath)
  const next = all.filter((c) => livePaths.has(c.relPath))
  if (next.length === all.length) return 0
  await writeAll(vaultPath, next)
  return all.length - next.length
}
