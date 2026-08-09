import http from 'node:http'
import crypto from 'node:crypto'
import { htmlToMarkdown } from './html-markdown'

/**
 * The web clipper's receiving end.
 *
 * A bookmarklet cannot write to disk, and a custom URL scheme cannot carry an
 * article — browsers cap a location at a few thousand characters and silently
 * truncate past it. So the page is POSTed to a loopback listener instead, which
 * is the same shape every other clipper on the desktop uses.
 *
 * That is an inbound socket in an app that otherwise has none, so it is fenced
 * in deliberately:
 *
 *   - off unless the user turns it on, and stopped the moment they turn it off;
 *   - bound to 127.0.0.1, so nothing off this machine can reach it at all;
 *   - a shared secret on every request, because *any* page in the browser can
 *     reach a localhost port, and the token is what separates the bookmarklet
 *     the user installed from a site that guessed the port number;
 *   - a hard body cap, so a hostile or broken page cannot exhaust memory;
 *   - a fixed set of three routes, none of which read from disk.
 *
 * The token is compared with a timing-safe equality rather than `===`, since a
 * local attacker can measure a loopback response often enough to matter.
 */

const MAX_BODY = 8 * 1024 * 1024

export interface ClipRequest {
  title?: string
  url?: string
  /** The page, or the user's selection within it, as HTML. */
  html?: string
  /** Plain text, used when the caller could not give HTML. */
  text?: string
  tags?: string[]
}

export interface ClipperHooks {
  /** Write the clipping into the vault, returning where it landed. */
  saveClip: (clip: { title: string; url: string; markdown: string; tags: string[] }) => Promise<string>
  /** Add a task, exactly as quick-add would. */
  saveTask: (text: string) => Promise<string>
}

let server: http.Server | null = null

export function newToken(): string {
  return crypto.randomBytes(24).toString('base64url')
}

function tokenMatches(expected: string, given: string | undefined): boolean {
  if (!given || !expected) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(given)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('That page is too large to clip.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Turn a clip payload into the note body, keeping the source in frontmatter. */
export function clipToMarkdown(clip: ClipRequest): string {
  if (clip.html?.trim()) return htmlToMarkdown(clip.html)
  return (clip.text ?? '').trim()
}

export function stopClipper(): void {
  server?.close()
  server = null
}

export function clipperRunning(): boolean {
  return server !== null
}

export async function startClipper(
  port: number,
  token: string,
  hooks: ClipperHooks
): Promise<void> {
  stopClipper()

  const send = (res: http.ServerResponse, status: number, body: unknown): void => {
    const payload = JSON.stringify(body)
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      // The bookmarklet runs on whatever page the user is reading, so its
      // origin is never predictable. Echoing it keeps the browser happy without
      // widening anything: the token, not the origin, is the actual gate.
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Stone-Token',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    })
    res.end(payload)
  }

  const next = http.createServer((req, res) => {
    void (async () => {
      try {
        if (req.method === 'OPTIONS') {
          send(res, 204, {})
          return
        }

        const url = new URL(req.url ?? '/', 'http://127.0.0.1')

        // Unauthenticated, and deliberately says nothing about the vault: the
        // bookmarklet needs to know whether Stone is listening before it offers
        // to clip, and a bare liveness bit is all that requires.
        if (req.method === 'GET' && url.pathname === '/ping') {
          send(res, 200, { ok: true, app: 'stone' })
          return
        }

        if (req.method !== 'POST') {
          send(res, 405, { ok: false, error: 'Method not allowed.' })
          return
        }

        const header = req.headers['x-stone-token']
        const given = Array.isArray(header) ? header[0] : header
        if (!tokenMatches(token, given)) {
          send(res, 401, { ok: false, error: 'Bad or missing token.' })
          return
        }

        const raw = await readBody(req)
        const body = JSON.parse(raw || '{}') as ClipRequest & { text?: string }

        if (url.pathname === '/clip') {
          const relPath = await hooks.saveClip({
            title: (body.title ?? '').trim() || 'Clipping',
            url: (body.url ?? '').trim(),
            markdown: clipToMarkdown(body),
            tags: body.tags ?? []
          })
          send(res, 200, { ok: true, relPath })
          return
        }

        if (url.pathname === '/task') {
          const text = (body.text ?? '').trim()
          if (!text) {
            send(res, 400, { ok: false, error: 'A task needs some text.' })
            return
          }
          const relPath = await hooks.saveTask(text)
          send(res, 200, { ok: true, relPath })
          return
        }

        send(res, 404, { ok: false, error: 'No such endpoint.' })
      } catch (err) {
        send(res, 400, { ok: false, error: (err as Error).message })
      }
    })()
  })

  await new Promise<void>((resolve, reject) => {
    next.once('error', reject)
    // Loopback only. Passing no host would bind every interface and put the
    // clipper on the local network, which is not what "on this machine" means.
    next.listen(port, '127.0.0.1', () => {
      next.removeListener('error', reject)
      resolve()
    })
  })

  server = next
}

/**
 * The bookmarklet, with this vault's token baked in.
 *
 * It prefers the user's selection and falls back to the article body, which is
 * the behaviour people expect from every other clipper: highlight something and
 * you get that, highlight nothing and you get the page.
 */
export function bookmarkletSource(port: number, token: string): string {
  const script = `
(function(){
  var sel = window.getSelection();
  var html = '';
  if (sel && sel.rangeCount && String(sel).trim()) {
    var box = document.createElement('div');
    for (var i = 0; i < sel.rangeCount; i++) box.appendChild(sel.getRangeAt(i).cloneContents());
    html = box.innerHTML;
  } else {
    var main = document.querySelector('article') || document.querySelector('main') || document.body;
    html = main.innerHTML;
  }
  fetch('http://127.0.0.1:${port}/clip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Stone-Token': '${token}' },
    body: JSON.stringify({ title: document.title, url: location.href, html: html })
  })
    .then(function(r){ return r.json(); })
    .then(function(d){ if (!d.ok) throw new Error(d.error); })
    .catch(function(e){ alert('Stone could not clip this page: ' + e.message); });
})();`
  return `javascript:${encodeURIComponent(script.replace(/\n\s*/g, ''))}`
}
