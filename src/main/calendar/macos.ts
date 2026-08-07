import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
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

function pump(isDone, timeoutSeconds) {
  var deadline = $.NSDate.dateWithTimeIntervalSinceNow(timeoutSeconds);
  while (!isDone() && $.NSDate.date.compare(deadline) < 0) {
    $.NSRunLoop.currentRunLoop.runModeBeforeDate(
      $.NSDefaultRunLoopMode,
      $.NSDate.dateWithTimeIntervalSinceNow(0.02)
    );
  }
}

function authorize(store) {
  var state = { done: false, granted: false };
  var handler = function (granted) {
    state.granted = granted;
    state.done = true;
  };
  if (typeof store.requestFullAccessToEventsCompletion === 'function') {
    store.requestFullAccessToEventsCompletion(handler);
  } else {
    store.requestAccessToEntityTypeCompletion($.EKEntityTypeEvent, handler);
  }
  pump(function () { return state.done; }, 60);
  return state.granted;
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
  var list = store.calendarsForEntityType($.EKEntityTypeEvent);
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
  var list = store.calendarsForEntityType($.EKEntityTypeEvent);
  for (var i = 0; i < list.count; i++) {
    var cal = list.objectAtIndex(i);
    if (ObjC.unwrap(cal.calendarIdentifier) === id) return cal;
  }
  return store.defaultCalendarForNewEvents;
}

function listEvents(store, args) {
  var start = $.NSDate.dateWithTimeIntervalSince1970(args.start);
  var end = $.NSDate.dateWithTimeIntervalSince1970(args.end);
  var all = store.calendarsForEntityType($.EKEntityTypeEvent);
  var wanted = $.NSMutableArray.alloc.init;

  for (var i = 0; i < all.count; i++) {
    var cal = all.objectAtIndex(i);
    var id = ObjC.unwrap(cal.calendarIdentifier);
    if (!args.calendarIds || args.calendarIds.length === 0 || args.calendarIds.indexOf(id) !== -1) {
      wanted.addObject(cal);
    }
  }
  if (wanted.count === 0) return [];

  var predicate = store.predicateForEventsWithStartDateEndDateCalendars(start, end, wanted);
  var events = store.eventsMatchingPredicate(predicate);
  var out = [];

  for (var j = 0; j < events.count; j++) {
    var ev = events.objectAtIndex(j);
    if (!ev.startDate || !ev.endDate) continue;
    out.push({
      id: ObjC.unwrap(ev.eventIdentifier),
      calendarId: ObjC.unwrap(ev.calendar.calendarIdentifier),
      calendarName: ObjC.unwrap(ev.calendar.title),
      title: ObjC.unwrap(ev.title) || '(no title)',
      start: ev.startDate.timeIntervalSince1970,
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

function saveEvent(store, args) {
  var ev;
  if (args.id) {
    ev = store.eventWithIdentifier(args.id);
    if (!ev) throw new Error('That event no longer exists in Calendar.');
  } else {
    ev = $.EKEvent.eventWithEventStore(store);
    ev.calendar = findCalendar(store, args.calendarId);
  }
  ev.title = args.title;
  ev.startDate = $.NSDate.dateWithTimeIntervalSince1970(args.start);
  ev.endDate = $.NSDate.dateWithTimeIntervalSince1970(args.end);
  ev.allDay = Boolean(args.allDay);
  if (args.location !== null && args.location !== undefined) ev.location = args.location;
  if (args.notes !== null && args.notes !== undefined) ev.notes = args.notes;

  var err = $();
  var ok = store.saveEventSpanCommitError(ev, $.EKSpanThisEvent, true, err);
  if (!ok) throw new Error('Calendar refused the save.');
  return { id: ObjC.unwrap(ev.eventIdentifier) };
}

function removeEvent(store, args) {
  var ev = store.eventWithIdentifier(args.id);
  if (!ev) return { ok: true };
  var err = $();
  var ok = store.removeEventSpanCommitError(ev, $.EKSpanThisEvent, true, err);
  if (!ok) throw new Error('Calendar refused the delete.');
  return { ok: true };
}

function run(argv) {
  var args = JSON.parse(argv[0]);
  var store = $.EKEventStore.alloc.init;

  if (!authorize(store)) {
    return JSON.stringify({ error: 'DENIED' });
  }

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

async function ensureScript(): Promise<string> {
  if (scriptPath) return scriptPath
  const dir = path.join(os.tmpdir(), 'stone-bridge')
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, 'eventkit.js')
  await fs.writeFile(file, JXA_SOURCE, 'utf8')
  scriptPath = file
  return file
}

export function isMac(): boolean {
  return process.platform === 'darwin'
}

export class MacCalendarError extends Error {
  constructor(
    message: string,
    readonly code: 'denied' | 'unavailable' | 'failed'
  ) {
    super(message)
  }
}

async function invoke<T>(args: Record<string, unknown>): Promise<T> {
  if (!isMac()) throw new MacCalendarError('Apple Calendar is only available on macOS.', 'unavailable')
  const script = await ensureScript()
  try {
    const { stdout } = await run('osascript', ['-l', 'JavaScript', script, JSON.stringify(args)], {
      timeout: 90_000,
      maxBuffer: 32 * 1024 * 1024
    })
    const parsed = JSON.parse(stdout.trim()) as { data?: T; error?: string }
    if (parsed.error === 'DENIED') {
      throw new MacCalendarError(
        'Stone needs calendar access. Grant it in System Settings › Privacy & Security › Calendars.',
        'denied'
      )
    }
    if (parsed.error) throw new MacCalendarError(parsed.error, 'failed')
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
    id: `macos:${e.id}`,
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
  const result = await invoke<{ id: string }>({
    op: 'save',
    id: input.id?.replace(/^macos:/, ''),
    calendarId: input.calendarId,
    title: input.title,
    start: Math.floor(new Date(input.start).getTime() / 1000),
    end: Math.floor(new Date(input.end).getTime() / 1000),
    allDay: input.allDay,
    location: input.location ?? null,
    notes: input.notes ?? null
  })
  return `macos:${result.id}`
}

export async function removeMacEvent(id: string): Promise<void> {
  await invoke<{ ok: boolean }>({ op: 'remove', id: id.replace(/^macos:/, '') })
}
