/**
 * Turn a thrown error into something a person can act on.
 *
 * Most failures in Stone originate in the filesystem and arrive as Node's own
 * message — `EACCES: permission denied, open '/Users/you/Vault/Meeting.md'`.
 * That names the problem accurately and tells the reader nothing about what to
 * do next, which is the difference between an error message and a diagnostic.
 *
 * The raw text is not discarded: the error toast keeps its Copy button, so the
 * original is always one click away for a bug report.
 */

interface Errno {
  code?: string
  path?: string
  message?: string
}

/** The file at the end of a Node error, for a message that can name it. */
function subject(err: Errno): string {
  if (!err.path) return 'that file'
  const name = err.path.split(/[\\/]/).filter(Boolean).pop()
  return name ? `“${name}”` : 'that file'
}

const BY_CODE: Record<string, (err: Errno) => string> = {
  EACCES: (e) =>
    `Stone is not allowed to open ${subject(e)}. Check the folder's permissions, or — on macOS — ` +
    `grant Stone access to the disk it lives on in System Settings › Privacy & Security.`,
  EPERM: (e) => `The system refused the change to ${subject(e)}. It may be locked or read-only.`,
  ENOENT: (e) =>
    `${subject(e)} is no longer there. Something outside Stone may have moved or deleted it — ` +
    `rebuilding the vault index will resync the list.`,
  ENOSPC: () => 'The disk is full, so nothing could be written. Free some space and try again.',
  EROFS: (e) => `${subject(e)} is on a read-only disk, so it cannot be saved.`,
  EBUSY: (e) => `${subject(e)} is in use by another program. Close it there and try again.`,
  EMFILE: () =>
    'Too many files are open at once. Restarting Stone will clear them; a very large vault may ' +
    'also need a higher open-file limit.',
  EISDIR: (e) => `${subject(e)} is a folder, not a note.`,
  ENOTDIR: (e) => `Part of the path to ${subject(e)} is a file, not a folder.`,
  EEXIST: (e) => `${subject(e)} already exists. Pick a different name.`,
  ENAMETOOLONG: () => 'That name is too long for the filesystem. Try a shorter one.',
  ETIMEDOUT: () => 'That took too long and was given up on. Try again.',
  ECONNREFUSED: () => 'Nothing answered on that address. Check the service is running.'
}

export function describeError(error: unknown): string {
  const err = (error ?? {}) as Errno
  const raw = typeof err.message === 'string' ? err.message : String(error)

  // Node puts the code on the error object, but an error that has crossed the
  // IPC boundary arrives as a plain message with the code on the front.
  const code = err.code ?? /^([A-Z]{4,12}):/.exec(raw)?.[1]
  const explain = code ? BY_CODE[code] : undefined
  if (!explain) return raw

  // The path survives the boundary the same way the code does.
  const path = err.path ?? /['"]([^'"]+)['"]\s*$/.exec(raw)?.[1]
  return explain({ ...err, path })
}
