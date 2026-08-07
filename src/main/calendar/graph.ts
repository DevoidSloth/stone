import { app, safeStorage } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { CalEvent, CalendarAccount } from '@shared/types'

/**
 * Microsoft Graph is the real native calendar on Windows: the built-in Calendar
 * app and Outlook are both views onto the same Microsoft account. Device-code
 * flow is used because it needs no client secret and no loopback listener —
 * the user approves once in a browser and Stone holds a refresh token.
 *
 * The client ID belongs to the user's own Azure app registration. Shipping a
 * shared one would put every install behind one quota and one revocation.
 */
const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const GRAPH = 'https://graph.microsoft.com/v1.0'
const SCOPES = 'offline_access User.Read Calendars.ReadWrite'

interface StoredToken {
  refreshToken: string
  clientId: string
  account: string
}

interface LiveToken {
  accessToken: string
  expiresAt: number
}

let live: LiveToken | null = null

function tokenFile(): string {
  return path.join(app.getPath('userData'), 'graph-token.bin')
}

async function writeToken(token: StoredToken): Promise<void> {
  const json = JSON.stringify(token)
  const file = tokenFile()
  await fs.mkdir(path.dirname(file), { recursive: true })
  if (safeStorage.isEncryptionAvailable()) {
    await fs.writeFile(file, safeStorage.encryptString(json))
  } else {
    // No OS keychain (some Linux setups). Still better than losing the session.
    await fs.writeFile(file, json, 'utf8')
  }
}

async function readToken(): Promise<StoredToken | null> {
  try {
    const buf = await fs.readFile(tokenFile())
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString('utf8')
    return JSON.parse(json) as StoredToken
  } catch {
    return null
  }
}

export async function signOut(): Promise<void> {
  live = null
  try {
    await fs.unlink(tokenFile())
  } catch {
    // Already gone.
  }
}

export async function isConnected(): Promise<boolean> {
  return (await readToken()) !== null
}

async function form(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(30_000)
  })
  return (await response.json()) as Record<string, unknown>
}

export interface DeviceCodePrompt {
  userCode: string
  verificationUri: string
  expiresIn: number
  message: string
}

/**
 * Two-step sign-in. Step one returns a code to show the user; step two polls
 * until they finish approving in the browser.
 */
export async function beginSignIn(clientId: string): Promise<DeviceCodePrompt & { deviceCode: string; interval: number }> {
  const data = await form(`${AUTHORITY}/devicecode`, { client_id: clientId, scope: SCOPES })
  if (typeof data.error === 'string') {
    throw new Error(String(data.error_description ?? data.error))
  }
  return {
    deviceCode: String(data.device_code),
    userCode: String(data.user_code),
    verificationUri: String(data.verification_uri),
    expiresIn: Number(data.expires_in ?? 900),
    interval: Number(data.interval ?? 5),
    message: String(data.message ?? '')
  }
}

export async function completeSignIn(
  clientId: string,
  deviceCode: string,
  intervalSeconds: number,
  expiresIn: number
): Promise<{ account: string }> {
  const deadline = Date.now() + expiresIn * 1000
  let wait = Math.max(intervalSeconds, 3) * 1000

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, wait))
    const data = await form(`${AUTHORITY}/token`, {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: clientId,
      device_code: deviceCode
    })

    if (typeof data.access_token === 'string') {
      live = {
        accessToken: data.access_token,
        expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000 - 60_000
      }
      const account = await fetchAccountName(data.access_token)
      await writeToken({
        refreshToken: String(data.refresh_token ?? ''),
        clientId,
        account
      })
      return { account }
    }

    const error = String(data.error ?? '')
    if (error === 'authorization_pending') continue
    if (error === 'slow_down') {
      wait += 5000
      continue
    }
    throw new Error(String(data.error_description ?? error ?? 'Sign-in failed.'))
  }
  throw new Error('The sign-in code expired. Start again when you are ready.')
}

async function fetchAccountName(accessToken: string): Promise<string> {
  try {
    const response = await fetch(`${GRAPH}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000)
    })
    const data = (await response.json()) as Record<string, unknown>
    return String(data.userPrincipalName ?? data.mail ?? data.displayName ?? 'Microsoft account')
  } catch {
    return 'Microsoft account'
  }
}

async function accessToken(): Promise<string> {
  if (live && live.expiresAt > Date.now()) return live.accessToken

  const stored = await readToken()
  if (!stored) throw new Error('Connect a Microsoft account first.')

  const data = await form(`${AUTHORITY}/token`, {
    grant_type: 'refresh_token',
    client_id: stored.clientId,
    refresh_token: stored.refreshToken,
    scope: SCOPES
  })

  if (typeof data.access_token !== 'string') {
    await signOut()
    throw new Error('The Microsoft sign-in expired. Connect the account again.')
  }

  live = {
    accessToken: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000 - 60_000
  }
  if (typeof data.refresh_token === 'string') {
    await writeToken({ ...stored, refreshToken: data.refresh_token })
  }
  return live.accessToken
}

async function graphGet<T>(pathAndQuery: string): Promise<T> {
  const token = await accessToken()
  const response = await fetch(`${GRAPH}${pathAndQuery}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      // Ask Graph to return wall-clock times in the machine's own zone.
      Prefer: `outlook.timezone="${Intl.DateTimeFormat().resolvedOptions().timeZone}"`
    },
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Microsoft Graph returned ${response.status}: ${body.slice(0, 200)}`)
  }
  return (await response.json()) as T
}

interface GraphCalendar {
  id: string
  name: string
  hexColor?: string
  canEdit?: boolean
}

interface GraphEvent {
  id: string
  subject?: string
  isAllDay?: boolean
  bodyPreview?: string
  location?: { displayName?: string }
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
}

const GRAPH_PALETTE = ['#6E7BFF', '#3FBF8F', '#D9A441', '#E36A6A', '#B07CE0', '#4FA8D8']

export async function listGraphCalendars(): Promise<CalendarAccount[]> {
  const data = await graphGet<{ value: GraphCalendar[] }>('/me/calendars?$top=50')
  return data.value.map((c, i) => ({
    id: c.id,
    source: 'graph' as const,
    name: c.name,
    color: c.hexColor && c.hexColor.startsWith('#') ? c.hexColor : GRAPH_PALETTE[i % GRAPH_PALETTE.length],
    writable: c.canEdit !== false,
    enabled: true
  }))
}

/** Graph returns naive local strings once the Prefer header is set. */
function graphToLocalISO(value: string, allDay: boolean): string {
  const trimmed = value.replace(/\.\d+$/, '').replace(/Z$/, '')
  return allDay ? trimmed.slice(0, 10) : trimmed.slice(0, 16)
}

export async function listGraphEvents(
  startISO: string,
  endISO: string,
  calendarIds: string[]
): Promise<CalEvent[]> {
  const calendars = calendarIds.length
    ? calendarIds
    : (await listGraphCalendars()).map((c) => c.id)

  const results = await Promise.allSettled(
    calendars.map(async (calendarId) => {
      const query =
        `/me/calendars/${encodeURIComponent(calendarId)}/calendarView` +
        `?startDateTime=${encodeURIComponent(startISO)}` +
        `&endDateTime=${encodeURIComponent(endISO)}` +
        `&$top=500&$orderby=start/dateTime`
      const data = await graphGet<{ value: GraphEvent[] }>(query)
      return data.value.map<CalEvent>((e) => {
        const allDay = Boolean(e.isAllDay)
        return {
          id: `graph:${e.id}`,
          accountId: calendarId,
          source: 'graph',
          title: e.subject || '(no title)',
          start: graphToLocalISO(e.start.dateTime, allDay),
          end: graphToLocalISO(e.end.dateTime, allDay),
          allDay,
          location: e.location?.displayName || null,
          notes: e.bodyPreview || null,
          relPath: null,
          readOnly: false,
          color: null
        }
      })
    })
  )

  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}

export async function saveGraphEvent(input: {
  id?: string
  calendarId: string
  title: string
  start: string
  end: string
  allDay: boolean
  location?: string | null
  notes?: string | null
}): Promise<string> {
  const token = await accessToken()
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const body = {
    subject: input.title,
    isAllDay: input.allDay,
    start: { dateTime: input.allDay ? `${input.start.slice(0, 10)}T00:00:00` : input.start, timeZone: zone },
    end: { dateTime: input.allDay ? `${input.end.slice(0, 10)}T00:00:00` : input.end, timeZone: zone },
    location: input.location ? { displayName: input.location } : undefined,
    body: input.notes ? { contentType: 'text', content: input.notes } : undefined
  }

  const isUpdate = Boolean(input.id)
  const url = isUpdate
    ? `${GRAPH}/me/events/${encodeURIComponent(input.id!.replace(/^graph:/, ''))}`
    : `${GRAPH}/me/calendars/${encodeURIComponent(input.calendarId)}/events`

  const response = await fetch(url, {
    method: isUpdate ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) {
    throw new Error(`Microsoft Graph rejected the event: ${(await response.text()).slice(0, 200)}`)
  }
  const data = (await response.json()) as { id: string }
  return `graph:${data.id}`
}

export async function removeGraphEvent(id: string): Promise<void> {
  const token = await accessToken()
  const response = await fetch(`${GRAPH}/me/events/${encodeURIComponent(id.replace(/^graph:/, ''))}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok && response.status !== 404) {
    throw new Error(`Could not delete the event: ${response.status}`)
  }
}
