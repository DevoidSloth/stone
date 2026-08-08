import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { CalEvent, CalendarAccount } from '@shared/types'

const run = promisify(execFile)

/**
 * JXA driving EventKit directly. Scripting Calendar.app through Apple Events is
 * the usual approach and it is painfully slow — EventKit answers a year-wide
 * query in milliseconds and is the same API Apple's own Calendar uses.
 *
 * Access is granted asynchronously, so the run loop is pumped until the
 * completion handler fires. Times cross the boundary as epoch seconds to keep
 * time zones out of the string layer entirely.
 */
const JXA_SOURCE = String.raw`
ObjC.import('EventKit');
ObjC.import('Foundation');
// AppKit, for NSColor and NSCalibratedRGBColorSpace. Without it the colour
// constant is undefined, every lookup throws into the catch below, and each
// calendar silently falls back to the same grey.
ObjC.import('AppKit');

var ENTITY_EVENT = 0;   // EKEntityTypeEvent
var SPAN_THIS = 0;      // EKEventSpanThisEvent

// EKAuthorizationStatus. FullAccess and WriteOnly are not in the bridge's
// metadata, so the raw values are spelled out.
var AUTH_NOT_DETERMINED = 0;
var AUTH_RESTRICTED = 1;
var AUTH_DENIED = 2;
var AUTH_FULL = 3;
var AUTH_WRITE_ONLY = 4;

function pump(isDone, timeoutSeconds) {
  var deadline = $.NSDate.dateWithTimeIntervalSinceNow(timeoutSeconds);
  while (!isDone() && $.NSDate.date.compare(deadline) < 0) {
    $.NSRunLoop.currentRunLoop.runModeBeforeDate(
      $.NSDefaultRunLoopMode,
      $.NSDate.dateWithTimeIntervalSinceNow(0.02)
    );
  }
}

/**
 * Ask for calendar access.
 *
 * The selector is requestFullAccessToEvents_WITH_Completion_. Probing for
 * 'requestFullAccessToEventsCompletion' always misses, which silently drops
 * every macOS 14+ machine onto requestAccessToEntityType:completion: — and
 * since Sonoma that legacy call grants WRITE-ONLY access. Authorisation then
 * appears to succeed while every read returns nothing, which is exactly what a
 * calendar that "does not work" looks like.
 */
/**
 * The bridge hands enum returns back as strings — authorizationStatusForEntityType
 * answers "0", not 0 — so every comparison has to go through Number() or it
 * silently falls through to the wrong branch.
 */
function authStatus() {
  return Number($.EKEventStore.authorizationStatusForEntityType(ENTITY_EVENT));
}

function authorize(store) {
  var status = authStatus();

  if (status === AUTH_FULL) return { ok: true };
  if (status === AUTH_WRITE_ONLY) return { ok: false, code: 'WRITEONLY' };
  if (status === AUTH_DENIED || status === AUTH_RESTRICTED) return { ok: false, code: 'DENIED' };
  if (status !== AUTH_NOT_DETERMINED) return { ok: false, code: 'DENIED' };

  var state = { done: false, granted: false };
  var handler = function (granted) {
    state.granted = granted;
    state.done = true;
  };

  if (typeof store.requestFullAccessToEventsWithCompletion === 'function') {
    store.requestFullAccessToEventsWithCompletion(handler);
  } else {
    // macOS 13 and earlier, where this call is full access.
    store.requestAccessToEntityTypeCompletion(ENTITY_EVENT, handler);
  }

  // The system dialog is modal and a person has to read it.
  pump(function () { return state.done; }, 240);

  if (!state.done) return { ok: false, code: 'TIMEOUT' };

  var settled = authStatus();

  // Refused, but the status never moved off "not determined": the prompt could
  // not be put on screen at all. That is a different problem from a person
  // clicking Don't Allow, and telling them to go un-deny it in System Settings
  // sends them somewhere with nothing to change.
  if (!state.granted && settled === AUTH_NOT_DETERMINED) return { ok: false, code: 'NOPROMPT' };
  if (!state.granted) return { ok: false, code: 'DENIED' };
  if (settled === AUTH_WRITE_ONLY) return { ok: false, code: 'WRITEONLY' };
  return { ok: true };
}

/** The message Calendar itself gives, rather than a guess about what went wrong. */
function errorText(ref, fallback) {
  try {
    if (ref && ref[0] && !ref[0].isNil()) {
      var described = ObjC.unwrap(ref[0].localizedDescription);
      if (described) return described;
    }
  } catch (e) {
    /* fall through */
  }
  return fallback;
}

function colorOf(cal) {
  try {
    var c = cal.color;
    if (!c) return null;
    var rgb = c.colorUsingColorSpaceName($.NSCalibratedRGBColorSpace);
    if (!rgb) return null;
    var to255 = function (v) {
      return Math.max(0, Math.min(255, Math.round(v * 255)));
    };
    var hex = function (v) {
      var s = to255(v).toString(16);
      return s.length === 1 ? '0' + s : s;
    };
    return '#' + hex(rgb.redComponent) + hex(rgb.greenComponent) + hex(rgb.blueComponent);
  } catch (e) {
    return null;
  }
}

function calendarsOf(store) {
  var list = store.calendarsForEntityType(ENTITY_EVENT);
  var out = [];
  for (var i = 0; i < list.count; i++) {
    var cal = list.objectAtIndex(i);
    out.push({
      id: ObjC.unwrap(cal.calendarIdentifier),
      name: ObjC.unwrap(cal.title),
      color: colorOf(cal),
      writable: Boolean(cal.allowsContentModifications)
    });
  }
  return out;
}

function findCalendar(store, id) {
  var list = store.calendarsForEntityType(ENTITY_EVENT);
  for (var i = 0; i < list.count; i++) {
    var cal = list.objectAtIndex(i);
    if (ObjC.unwrap(cal.calendarIdentifier) === id) return cal;
  }
  return store.defaultCalendarForNewEvents;
}

function calendarsFor(store, ids) {
  var all = store.calendarsForEntityType(ENTITY_EVENT);
  var wanted = $.NSMutableArray.alloc.init;
  for (var i = 0; i < all.count; i++) {
    var cal = all.objectAtIndex(i);
    var id = ObjC.unwrap(cal.calendarIdentifier);
    if (!ids || ids.length === 0 || ids.indexOf(id) !== -1) wanted.addObject(cal);
  }
  return wanted;
}

function listEvents(store, args) {
  var start = $.NSDate.dateWithTimeIntervalSince1970(args.start);
  var end = $.NSDate.dateWithTimeIntervalSince1970(args.end);
  var wanted = calendarsFor(store, args.calendarIds);
  if (wanted.count === 0) return [];

  var predicate = store.predicateForEventsWithStartDateEndDateCalendars(start, end, wanted);
  var events = store.eventsMatchingPredicate(predicate);
  var out = [];

  for (var j = 0; j < events.count; j++) {
    var ev = events.objectAtIndex(j);
    if (!ev.startDate || !ev.endDate) continue;
    var startedAt = ev.startDate.timeIntervalSince1970;
    out.push({
      id: ObjC.unwrap(ev.eventIdentifier),
      // Every occurrence of a repeating event carries the SAME eventIdentifier.
      // Without something to tell them apart they collide on the way through
      // the merge and only one instance of a weekly meeting ever appears.
      occurrence: Math.round(startedAt),
      calendarId: ObjC.unwrap(ev.calendar.calendarIdentifier),
      calendarName: ObjC.unwrap(ev.calendar.title),
      title: ObjC.unwrap(ev.title) || '(no title)',
      start: startedAt,
      end: ev.endDate.timeIntervalSince1970,
      allDay: Boolean(ev.isAllDay),
      location: ev.location ? ObjC.unwrap(ev.location) : null,
      notes: ev.notes ? ObjC.unwrap(ev.notes) : null,
      color: colorOf(ev.calendar),
      readOnly: !ev.calendar.allowsContentModifications
    });
  }
  return out;
}

/**
 * eventWithIdentifier: hands back the FIRST occurrence of a series, so editing
 * next week's stand-up would silently rewrite last week's. When an occurrence
 * time is known, the series is searched around that day for the exact instance.
 */
function findEvent(store, id, occurrence) {
  if (!occurrence) return store.eventWithIdentifier(id);

  var from = $.NSDate.dateWithTimeIntervalSince1970(occurrence - 172800);
  var to = $.NSDate.dateWithTimeIntervalSince1970(occurrence + 172800);
  var predicate = store.predicateForEventsWithStartDateEndDateCalendars(
    from,
    to,
    calendarsFor(store, null)
  );
  var events = store.eventsMatchingPredicate(predicate);
  for (var i = 0; i < events.count; i++) {
    var ev = events.objectAtIndex(i);
    if (
      ObjC.unwrap(ev.eventIdentifier) === id &&
      Math.abs(ev.startDate.timeIntervalSince1970 - occurrence) < 1
    ) {
      return ev;
    }
  }
  return store.eventWithIdentifier(id);
}

function saveEvent(store, args) {
  var ev;
  if (args.id) {
    ev = findEvent(store, args.id, args.occurrence);
    if (!ev || ev.isNil()) throw new Error('That event no longer exists in Calendar.');
    if (!ev.calendar.allowsContentModifications) {
      throw new Error('"' + ObjC.unwrap(ev.calendar.title) + '" is a read-only calendar.');
    }
  } else {
    ev = $.EKEvent.eventWithEventStore(store);
    var calendar = findCalendar(store, args.calendarId);
    if (!calendar || calendar.isNil()) throw new Error('No writable calendar to save into.');
    ev.calendar = calendar;
  }

  ev.title = args.title;
  ev.allDay = Boolean(args.allDay);
  ev.startDate = $.NSDate.dateWithTimeIntervalSince1970(args.start);
  ev.endDate = $.NSDate.dateWithTimeIntervalSince1970(args.end);
  if (args.location !== null && args.location !== undefined) ev.location = args.location;
  if (args.notes !== null && args.notes !== undefined) ev.notes = args.notes;

  var err = Ref();
  var ok = store.saveEventSpanCommitError(ev, SPAN_THIS, true, err);
  if (!ok) throw new Error(errorText(err, 'Calendar refused the save.'));
  return { id: ObjC.unwrap(ev.eventIdentifier) };
}

function removeEvent(store, args) {
  var ev = findEvent(store, args.id, args.occurrence);
  if (!ev || ev.isNil()) return { ok: true };
  var err = Ref();
  var ok = store.removeEventSpanCommitError(ev, SPAN_THIS, true, err);
  if (!ok) throw new Error(errorText(err, 'Calendar refused the delete.'));
  return { ok: true };
}

function run(argv) {
  var args = JSON.parse(argv[0]);
  var store = $.EKEventStore.alloc.init;

  var access = authorize(store);
  if (!access.ok) return JSON.stringify({ error: access.code });

  try {
    if (args.op === 'calendars') return JSON.stringify({ data: calendarsOf(store) });
    if (args.op === 'events') return JSON.stringify({ data: listEvents(store, args) });
    if (args.op === 'save') return JSON.stringify({ data: saveEvent(store, args) });
    if (args.op === 'remove') return JSON.stringify({ data: removeEvent(store, args) });
    return JSON.stringify({ error: 'Unknown operation: ' + args.op });
  } catch (e) {
    return JSON.stringify({ error: String(e && e.message ? e.message : e) });
  }
}
`

let scriptPath: string | null = null

/**
 * The bridge script is written under userData, not into the system temp dir.
 * `/tmp` is world-writable, and a script this process is about to hand to
 * osascript is a script another local process could swap out from under it
 * between the write and the exec.
 */
async function ensureScript(): Promise<string> {
  if (scriptPath) return scriptPath
  const dir = path.join(app.getPath('userData'), 'bridge')
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  const file = path.join(dir, 'eventkit.js')
  await fs.writeFile(file, JXA_SOURCE, { encoding: 'utf8', mode: 0o600 })
  scriptPath = file
  return file
}

export function isMac(): boolean {
  return process.platform === 'darwin'
}

export class MacCalendarError extends Error {
  constructor(
    message: string,
    readonly code: 'denied' | 'write-only' | 'timeout' | 'unavailable' | 'failed'
  ) {
    super(message)
  }
}

const SETTINGS_HINT = 'System Settings › Privacy & Security › Calendars'

/**
 * True once this process has completed a call without being asked to authorise.
 * The very first call can sit behind a modal system dialog for as long as the
 * person takes to read it, so it gets a much longer leash than the rest.
 */
let authorized = false

async function invoke<T>(args: Record<string, unknown>): Promise<T> {
  if (!isMac()) {
    throw new MacCalendarError('Apple Calendar is only available on macOS.', 'unavailable')
  }
  const script = await ensureScript()

  try {
    const { stdout } = await run('osascript', ['-l', 'JavaScript', script, JSON.stringify(args)], {
      timeout: authorized ? 90_000 : 260_000,
      maxBuffer: 32 * 1024 * 1024
    })

    const parsed = JSON.parse(stdout.trim()) as { data?: T; error?: string }

    if (parsed.error === 'DENIED') {
      throw new MacCalendarError(`Stone needs calendar access. Grant it in ${SETTINGS_HINT}.`, 'denied')
    }
    /*
     * macOS 14 split calendar access in two. Write-only lets an app add events
     * but read nothing back, and it is what the pre-Sonoma API now grants — so
     * this state has to be named, or the calendar just looks empty.
     */
    if (parsed.error === 'WRITEONLY') {
      throw new MacCalendarError(
        `Stone has write-only calendar access, so it cannot read your events. Switch it to full access in ${SETTINGS_HINT}.`,
        'write-only'
      )
    }
    if (parsed.error === 'NOPROMPT') {
      throw new MacCalendarError(
        'macOS would not show the calendar permission prompt. Quit and reopen Stone, then try ' +
          `again — or add it yourself under ${SETTINGS_HINT}.`,
        'denied'
      )
    }
    if (parsed.error === 'TIMEOUT') {
      throw new MacCalendarError(
        'The calendar permission prompt went unanswered. Try again, or grant access in ' +
          `${SETTINGS_HINT}.`,
        'timeout'
      )
    }
    if (parsed.error) throw new MacCalendarError(parsed.error, 'failed')

    authorized = true
    return parsed.data as T
  } catch (err) {
    if (err instanceof MacCalendarError) throw err
    throw new MacCalendarError((err as Error).message, 'failed')
  }
}

interface RawCalendar {
  id: string
  name: string
  color: string | null
  writable: boolean
}

interface RawEvent {
  id: string
  occurrence: number
  calendarId: string
  calendarName: string
  title: string
  start: number
  end: number
  allDay: boolean
  location: string | null
  notes: string | null
  color: string | null
  readOnly: boolean
}

function localISO(epochSeconds: number, allDay: boolean): string {
  const d = new Date(epochSeconds * 1000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  if (allDay) return date
  return `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Seconds since the epoch, reading a bare date as local midnight.
 *
 * `new Date('2026-08-09')` is parsed as UTC by specification, so west of
 * Greenwich every all-day event Stone wrote landed on the day before.
 */
function epochSeconds(value: string): number {
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  const date = bare
    ? new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3]))
    : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new MacCalendarError(`"${value}" is not a date Stone can write.`, 'failed')
  }
  return Math.floor(date.getTime() / 1000)
}

/**
 * `macos:<identifier>` for a one-off, `macos:<identifier>@<epoch>` for one
 * occurrence of a repeating event.
 */
function encodeId(raw: RawEvent): string {
  return `macos:${raw.id}@${raw.occurrence}`
}

function decodeId(id: string): { id: string; occurrence: number | null } {
  const bare = id.replace(/^macos:/, '')
  const at = bare.lastIndexOf('@')
  if (at === -1) return { id: bare, occurrence: null }
  const occurrence = Number(bare.slice(at + 1))
  if (!Number.isFinite(occurrence)) return { id: bare, occurrence: null }
  return { id: bare.slice(0, at), occurrence }
}

export async function listMacCalendars(): Promise<CalendarAccount[]> {
  const raw = await invoke<RawCalendar[]>({ op: 'calendars' })
  return raw.map((c) => ({
    id: c.id,
    source: 'macos' as const,
    name: c.name,
    color: c.color ?? '#8E8E93',
    writable: c.writable,
    enabled: true
  }))
}

export async function listMacEvents(
  startISO: string,
  endISO: string,
  calendarIds: string[]
): Promise<CalEvent[]> {
  const raw = await invoke<RawEvent[]>({
    op: 'events',
    start: Math.floor(new Date(startISO).getTime() / 1000),
    end: Math.floor(new Date(endISO).getTime() / 1000),
    calendarIds
  })
  return raw.map((e) => ({
    id: encodeId(e),
    accountId: e.calendarId,
    source: 'macos' as const,
    title: e.title,
    start: localISO(e.start, e.allDay),
    end: localISO(e.end, e.allDay),
    allDay: e.allDay,
    location: e.location,
    notes: e.notes,
    relPath: null,
    readOnly: e.readOnly,
    color: e.color
  }))
}

export async function saveMacEvent(input: {
  id?: string
  calendarId: string
  title: string
  start: string
  end: string
  allDay: boolean
  location?: string | null
  notes?: string | null
}): Promise<string> {
  const existing = input.id ? decodeId(input.id) : null
  const start = epochSeconds(input.start)
  let end = epochSeconds(input.end)

  // An all-day event given the same day for both ends is one day long, but
  // EventKit rejects an end that is not after the start.
  if (end <= start) end = input.allDay ? start + 86_399 : start + 1800

  const result = await invoke<{ id: string }>({
    op: 'save',
    id: existing?.id,
    occurrence: existing?.occurrence ?? null,
    calendarId: input.calendarId,
    title: input.title,
    start,
    end,
    allDay: input.allDay,
    location: input.location ?? null,
    notes: input.notes ?? null
  })

  // The occurrence is the start that was just written.
  return `macos:${result.id}@${start}`
}

export async function removeMacEvent(id: string): Promise<void> {
  const target = decodeId(id)
  await invoke<{ ok: boolean }>({ op: 'remove', id: target.id, occurrence: target.occurrence })
}
