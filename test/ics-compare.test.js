import test from 'node:test';
import assert from 'node:assert/strict';
import { compareIcs, comparisonToCsv } from '../src/ics-compare.js';

const calendar = events => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR'].join('\r\n');
const event = lines => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');

test('matches events by UID and recurrence ID while ignoring harmless metadata', () => {
  const before = calendar([
    event(['UID:series@example.test', 'RECURRENCE-ID:20261020T140000Z', 'DTSTAMP:20261001T120000Z', 'SUMMARY:Team sync', 'DTSTART:20261020T140000Z']),
  ]);
  const after = calendar([
    event(['DTSTART:20261020T140000Z', 'SUMMARY:Team sync', 'DTSTAMP:20261015T120000Z', 'RECURRENCE-ID:20261020T140000Z', 'UID:series@example.test']),
  ]);
  const report = compareIcs(before, after);
  assert.deepEqual(report.summary, { totalA: 1, totalB: 1, added: 0, removed: 0, changed: 0, unchanged: 1 });
});

test('reports added, removed, and property-level event changes', () => {
  const before = calendar([
    event(['UID:keep@example.test', 'SUMMARY:Old title', 'DTSTART:20261020T140000Z']),
    event(['UID:removed@example.test', 'SUMMARY:Removed', 'DTSTART:20261021T140000Z']),
  ]);
  const after = calendar([
    event(['UID:keep@example.test', 'SUMMARY:New title', 'DTSTART:20261020T150000Z']),
    event(['UID:added@example.test', 'SUMMARY:Added', 'DTSTART:20261022T140000Z']),
  ]);
  const report = compareIcs(before, after, { fileA: 'before.ics', fileB: 'after.ics' });
  assert.equal(report.summary.changed, 1);
  assert.equal(report.summary.removed, 1);
  assert.equal(report.summary.added, 1);
  const changed = report.events.find(item => item.status === 'changed');
  assert.deepEqual(changed.changes.map(change => change.property), ['DTSTART', 'SUMMARY']);
});

test('unfolds content lines and compares timezone definitions', () => {
  const before = calendar([
    ['BEGIN:VTIMEZONE', 'TZID:America/Chicago', 'X-LIC-LOCATION:America/', ' Chicago', 'END:VTIMEZONE'].join('\r\n'),
    event(['UID:one@example.test', 'SUMMARY:One', 'DTSTART;TZID=America/Chicago:20261020T090000']),
  ]);
  const after = calendar([
    ['BEGIN:VTIMEZONE', 'TZID:America/Chicago', 'X-LIC-LOCATION:US/Central', 'END:VTIMEZONE'].join('\r\n'),
    event(['UID:one@example.test', 'SUMMARY:One', 'DTSTART;TZID=America/Chicago:20261020T090000']),
  ]);
  const report = compareIcs(before, after);
  assert.equal(report.summary.unchanged, 1);
  assert.equal(report.timezones.changed, 1);
});

test('exports only differences to CSV', () => {
  const before = calendar([event(['UID:one@example.test', 'SUMMARY:Before', 'DTSTART:20261020T140000Z'])]);
  const after = calendar([event(['UID:one@example.test', 'SUMMARY:After', 'DTSTART:20261020T140000Z'])]);
  const csv = comparisonToCsv(compareIcs(before, after));
  assert.match(csv, /status,uid,recurrence_id/);
  assert.match(csv, /changed,one@example\.test/);
  assert.doesNotMatch(csv, /unchanged/);
});

test('reports alarm changes inside an otherwise matching event', () => {
  const before = calendar([event(['UID:alarm@example.test', 'SUMMARY:Reminder', 'DTSTART:20261020T140000Z', 'BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', 'END:VALARM'])]);
  const after = calendar([event(['UID:alarm@example.test', 'SUMMARY:Reminder', 'DTSTART:20261020T140000Z', 'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'END:VALARM'])]);
  const report = compareIcs(before, after);
  assert.equal(report.summary.changed, 1);
  assert.deepEqual(report.events[0].changes.map(change => change.property), ['VALARM']);
});
