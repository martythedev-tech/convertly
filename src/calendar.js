const TITLE_KEYS = ['title', 'summary', 'name', 'subject', 'text', 'event_title'];
const START_KEYS = ['start', 'startDate', 'start_date', 'dt_start', 'start_at', 'starts_at', 'begin', 'begin_at', 'date'];
const END_KEYS = ['end', 'endDate', 'end_date', 'dt_end', 'end_at', 'ends_at', 'finish', 'finish_at'];
const DATE_VALUE_KEYS = ['dt', 'dateTime', 'date_time', 'datetime', 'iso', 'value', 'timestamp', 'time', 'date'];

function firstValue(object, keys) {
  if (!object || typeof object !== 'object') return undefined;
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null && object[key] !== '') return object[key];
  }
  return undefined;
}

function textValue(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (!value || typeof value !== 'object') return '';
  return textValue(firstValue(value, ['text', 'value', 'name', 'title', 'label', 'address']));
}

function dateValue(value) {
  if (value instanceof Date || typeof value === 'string' || typeof value === 'number') return value;
  return firstValue(value, DATE_VALUE_KEYS);
}

function eventTitle(event) {
  return textValue(firstValue(event, TITLE_KEYS));
}

function eventStart(event) {
  return firstValue(event, START_KEYS);
}

export function collectCalendarEvents(root) {
  const events = [];
  const visited = new WeakSet();

  function visit(value) {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) return value.forEach(visit);

    if (eventTitle(value) && dateValue(eventStart(value)) !== undefined) {
      events.push(value);
      return;
    }
    Object.values(value).forEach(visit);
  }

  visit(root);
  return events;
}

function normalizeLines(value) {
  return value.replace(/\r?\n/g, '\r\n').trim();
}

function componentIdentity(component) {
  const uid = component.match(/(?:^|\r?\n)UID(?:;[^:]*)?:(.*?)(?:\r?\n|$)/i)?.[1]?.trim();
  const recurrence = component.match(/(?:^|\r?\n)RECURRENCE-ID(?:;[^:]*)?:(.*?)(?:\r?\n|$)/i)?.[1]?.trim() || '';
  return uid ? `${uid}|${recurrence}` : normalizeLines(component);
}

export function collectEmbeddedCalendarComponents(root) {
  const eventMap = new Map();
  const zoneMap = new Map();
  const visited = new WeakSet();

  function addCalendar(calendar) {
    for (const event of calendar.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/gi) || []) {
      const normalized = normalizeLines(event);
      eventMap.set(componentIdentity(normalized), normalized);
    }
    for (const zone of calendar.match(/BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE/gi) || []) {
      const normalized = normalizeLines(zone);
      const tzid = normalized.match(/(?:^|\r?\n)TZID(?:;[^:]*)?:(.*?)(?:\r?\n|$)/i)?.[1]?.trim() || normalized;
      const existing = zoneMap.get(tzid);
      if (!existing || normalized.length > existing.length) zoneMap.set(tzid, normalized);
    }
  }

  function visit(value) {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value.ical_data === 'string' && /BEGIN:VCALENDAR/i.test(value.ical_data)) addCalendar(value.ical_data);
    Object.values(value).forEach(visit);
  }

  visit(root);
  return { events: [...eventMap.values()], timezones: [...zoneMap.values()] };
}

function numericDate(value) {
  if (typeof value !== 'number') return value;
  return new Date(value < 1e12 ? value * 1000 : value);
}

function temporalLine(label, source) {
  const raw = numericDate(dateValue(source));
  if (raw === undefined || raw === null || raw === '') throw new Error('One of the event dates is missing.');
  const rawText = raw instanceof Date ? '' : String(raw).trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(rawText) || (source && typeof source === 'object' && (source.has_time === false || source.all_day === true));
  if (dateOnly) return `${label};VALUE=DATE:${rawText.slice(0, 10).replace(/-/g, '')}`;

  const timezone = source && typeof source === 'object' ? textValue(firstValue(source, ['tz', 'timezone', 'time_zone', 'tzid'])) : '';
  const lacksOffset = typeof raw === 'string' && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  if (timezone && lacksOffset) {
    const local = raw.replace(/[-:]/g, '').replace(/\.\d+/, '').replace(/Z$/i, '');
    if (!/^\d{8}T\d{6}$/.test(local)) throw new Error(`The date “${raw}” is not valid.`);
    return `${label};TZID=${timezone.replace(/[^A-Za-z0-9_+\/-]/g, '')}:${local}`;
  }

  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error(`The date “${raw}” is not valid.`);
  return `${label}:${date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`;
}

function inferEnd(start) {
  const raw = dateValue(start);
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }
  const date = new Date(numericDate(raw));
  if (Number.isNaN(date.getTime())) throw new Error(`The date “${raw}” is not valid.`);
  date.setHours(date.getHours() + 1);
  return date;
}

function escapeIcs(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

export function eventToIcs(event, index = 0) {
  const title = eventTitle(event);
  const start = eventStart(event);
  if (!title || dateValue(start) === undefined) throw new Error(`Event ${index + 1} needs a title and start date.`);
  const end = firstValue(event, END_KEYS) ?? inferEnd(start);
  const description = textValue(firstValue(event, ['description', 'notes', 'note', 'details', 'body']));
  const location = textValue(firstValue(event, ['location', 'place', 'venue']));
  const url = textValue(firstValue(event, ['url', 'html_link', 'web_url', 'link']));
  const uid = textValue(firstValue(event, ['uid', 'id', 'event_id', 'uuid'])) || crypto.randomUUID();

  return [
    'BEGIN:VEVENT',
    `UID:${escapeIcs(uid)}@convertly.local`,
    temporalLine('DTSTAMP', new Date()),
    temporalLine('DTSTART', start),
    temporalLine('DTEND', end),
    `SUMMARY:${escapeIcs(title)}`,
    description ? `DESCRIPTION:${escapeIcs(description)}` : '',
    location ? `LOCATION:${escapeIcs(location)}` : '',
    url ? `URL:${escapeIcs(url)}` : '',
    'END:VEVENT',
  ].filter(Boolean).join('\r\n');
}

export function icsBlob(events, timezones = []) {
  const components = [...timezones, ...events].join('\r\n');
  return new Blob([`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Convertly//Calendar Export//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n${components}\r\nEND:VCALENDAR\r\n`], { type: 'text/calendar' });
}
