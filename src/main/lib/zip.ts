import fs from 'node:fs/promises'
import zlib from 'node:zlib'

/**
 * Just enough ZIP to read a package.
 *
 * A GoodNotes document is a zip, and so is nearly every other document package
 * worth opening. Node ships the hard part — `inflateRaw` — so what is missing is
 * only the container format: a central directory at the end of the file listing
 * every entry and where its data starts.
 *
 * Written by hand rather than pulled in, for the same reason the graph's force
 * simulation was: this is a few hundred lines against a stable 30-year-old
 * format, and the alternative is a dependency in the trusted main process that
 * parses hostile input.
 *
 * Reading is lazy — the directory is parsed up front, and an entry's bytes are
 * only inflated when asked for. A 300MB notebook whose thumbnail is all anyone
 * wants should not cost 300MB of memory.
 */

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

/** Zip64's end-of-central-directory records, used once a file passes 4GB. */
const EOCD64_LOCATOR_SIGNATURE = 0x07064b50
const EOCD64_SIGNATURE = 0x06064b50

export interface ZipEntry {
  name: string
  compressedSize: number
  uncompressedSize: number
  /** 0 stored, 8 deflated. Anything else is not something we can inflate. */
  method: number
  localHeaderOffset: number
}

export class ZipArchive {
  private constructor(
    private readonly handle: fs.FileHandle,
    readonly entries: ZipEntry[]
  ) {}

  static async open(filePath: string): Promise<ZipArchive> {
    const handle = await fs.open(filePath, 'r')
    try {
      const { size } = await handle.stat()
      const entries = await readCentralDirectory(handle, size)
      return new ZipArchive(handle, entries)
    } catch (err) {
      await handle.close()
      throw err
    }
  }

  find(predicate: (name: string) => boolean): ZipEntry | undefined {
    return this.entries.find((e) => predicate(e.name))
  }

  /**
   * The bytes of one entry.
   *
   * The local header has to be re-read even though the central directory
   * already described the entry: only the local header knows how long its own
   * variable-length name and extra fields are, and therefore where the data
   * actually begins.
   */
  async read(entry: ZipEntry, maxBytes = 64 * 1024 * 1024): Promise<Buffer> {
    if (entry.uncompressedSize > maxBytes) {
      throw new Error(`${entry.name} is too large to read (${entry.uncompressedSize} bytes).`)
    }

    const header = Buffer.alloc(30)
    await this.handle.read(header, 0, 30, entry.localHeaderOffset)
    if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) {
      throw new Error(`Corrupt entry: ${entry.name}`)
    }
    const nameLength = header.readUInt16LE(26)
    const extraLength = header.readUInt16LE(28)
    const start = entry.localHeaderOffset + 30 + nameLength + extraLength

    const compressed = Buffer.alloc(entry.compressedSize)
    await this.handle.read(compressed, 0, entry.compressedSize, start)

    if (entry.method === 0) return compressed
    if (entry.method === 8) return zlib.inflateRawSync(compressed)
    throw new Error(`${entry.name} uses compression method ${entry.method}, which Stone cannot read.`)
  }

  async close(): Promise<void> {
    await this.handle.close()
  }
}

/**
 * Find the end-of-central-directory record.
 *
 * It sits at the very end of the file unless there is a zip comment, in which
 * case it is up to 64KB earlier — so the tail is scanned backwards for the
 * signature rather than assumed.
 */
async function readCentralDirectory(handle: fs.FileHandle, size: number): Promise<ZipEntry[]> {
  const tailLength = Math.min(size, 66 * 1024)
  const tail = Buffer.alloc(tailLength)
  await handle.read(tail, 0, tailLength, size - tailLength)

  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i
      break
    }
  }
  if (eocd === -1) throw new Error('Not a zip archive.')

  let count = tail.readUInt16LE(eocd + 10)
  let directorySize = tail.readUInt32LE(eocd + 12)
  let directoryOffset = tail.readUInt32LE(eocd + 16)

  // The 32-bit fields saturate on large archives and the real values live in a
  // zip64 record just before the locator.
  if (directoryOffset === 0xffffffff || count === 0xffff) {
    for (let i = eocd - 20; i >= 0; i--) {
      if (tail.readUInt32LE(i) !== EOCD64_LOCATOR_SIGNATURE) continue
      const eocd64Offset = Number(tail.readBigUInt64LE(i + 8))
      const record = Buffer.alloc(56)
      await handle.read(record, 0, 56, eocd64Offset)
      if (record.readUInt32LE(0) !== EOCD64_SIGNATURE) break
      count = Number(record.readBigUInt64LE(32))
      directorySize = Number(record.readBigUInt64LE(40))
      directoryOffset = Number(record.readBigUInt64LE(48))
      break
    }
  }

  const directory = Buffer.alloc(directorySize)
  await handle.read(directory, 0, directorySize, directoryOffset)

  const entries: ZipEntry[] = []
  let cursor = 0
  for (let n = 0; n < count && cursor + 46 <= directory.length; n++) {
    if (directory.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) break

    const method = directory.readUInt16LE(cursor + 10)
    let compressedSize = directory.readUInt32LE(cursor + 20)
    let uncompressedSize = directory.readUInt32LE(cursor + 24)
    const nameLength = directory.readUInt16LE(cursor + 28)
    const extraLength = directory.readUInt16LE(cursor + 30)
    const commentLength = directory.readUInt16LE(cursor + 32)
    let localHeaderOffset = directory.readUInt32LE(cursor + 42)

    const name = directory.toString('utf8', cursor + 46, cursor + 46 + nameLength)
    const extraStart = cursor + 46 + nameLength

    // Any saturated field is really in the zip64 extra block, in the fixed
    // order sizes-then-offset, with only the saturated ones present.
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      let p = extraStart
      const extraEnd = extraStart + extraLength
      while (p + 4 <= extraEnd) {
        const tag = directory.readUInt16LE(p)
        const length = directory.readUInt16LE(p + 2)
        if (tag === 0x0001) {
          let q = p + 4
          if (uncompressedSize === 0xffffffff) {
            uncompressedSize = Number(directory.readBigUInt64LE(q))
            q += 8
          }
          if (compressedSize === 0xffffffff) {
            compressedSize = Number(directory.readBigUInt64LE(q))
            q += 8
          }
          if (localHeaderOffset === 0xffffffff) {
            localHeaderOffset = Number(directory.readBigUInt64LE(q))
          }
          break
        }
        p += 4 + length
      }
    }

    // Directory markers carry no data and only get in the way downstream.
    if (!name.endsWith('/')) {
      entries.push({ name, compressedSize, uncompressedSize, method, localHeaderOffset })
    }
    cursor = extraStart + extraLength + commentLength
  }

  return entries
}
