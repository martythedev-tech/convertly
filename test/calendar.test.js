import test from 'node:test';
import assert from 'node:assert/strict';
import { collectCalendarEvents, collectEmbeddedCalendarComponents, eventToIcs, icsBlob } from '../src/calendar.js';

test('finds events nested inside an exported folder', () => {
  const source = {
    folder: {
      items: [{
        title: 'Team sync',
        dt_start: { dt: '2026-01-12T13:00:00-06:00', tz: 'America/Chicago', has_time: true },
        dt_end: { dt: '2026-01-12T14:00:00-06:00', tz: 'America/Chicago', has_time: true },
      }],
    },
  };
  const events = collectCalendarEvents(source);
  assert.equal(events.length, 1);
  const ics = eventToIcs(events[0]);
  assert.match(ics, /DTSTART:20260112T190000Z/);
  assert.match(ics, /SUMMARY:Team sync/);
});

test('supports alternate field names and nested text values', () => {
  const events = collectCalendarEvents([{ subject: 'Appointment', start_at: '2026-10-20T09:00:00Z', place: { name: 'Office' } }]);
  const ics = eventToIcs(events[0]);
  assert.match(ics, /SUMMARY:Appointment/);
  assert.match(ics, /LOCATION:Office/);
});

test('writes all-day events as dates', () => {
  const ics = eventToIcs({ name: 'Holiday', date: '2026-12-25' });
  assert.match(ics, /DTSTART;VALUE=DATE:20261225/);
  assert.match(ics, /DTEND;VALUE=DATE:20261226/);
});

test('preserves every embedded event, recurrence rule, and timezone', async () => {
  const source = {
    appointments: [{
      ical_data: [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:series@example.test',
        'DTSTART;TZID=America/Chicago:20261020T090000',
        'RRULE:FREQ=WEEKLY;COUNT=4',
        'SUMMARY:Weekly meeting',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:series@example.test',
        'RECURRENCE-ID;TZID=America/Chicago:20261027T090000',
        'DTSTART;TZID=America/Chicago:20261027T100000',
        'SUMMARY:Moved meeting',
        'END:VEVENT',
        'BEGIN:VTIMEZONE',
        'TZID:America/Chicago',
        'BEGIN:STANDARD',
        'DTSTART:20261101T020000',
        'END:STANDARD',
        'END:VTIMEZONE',
        'END:VCALENDAR',
      ].join('\r\n'),
    }],
  };
  const components = collectEmbeddedCalendarComponents(source);
  assert.equal(components.events.length, 2);
  assert.equal(components.timezones.length, 1);
  const output = await icsBlob(components.events, components.timezones).text();
  assert.equal((output.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.match(output, /RRULE:FREQ=WEEKLY;COUNT=4/);
  assert.match(output, /RECURRENCE-ID;TZID=America\/Chicago/);
  assert.match(output, /BEGIN:VTIMEZONE/);
});
