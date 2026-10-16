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
  assert.match(csv, /record_type,status,uid,recurrence_id/);
  assert.match(csv, /exact_identity,changed,one@example\.test/);
  assert.match(csv, /uid_only,probable_uid_match,one@example\.test/);
  assert.doesNotMatch(csv, /unchanged/);
});

test('reports alarm changes inside an otherwise matching event', () => {
  const before = calendar([event(['UID:alarm@example.test', 'SUMMARY:Reminder', 'DTSTART:20261020T140000Z', 'BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', 'END:VALARM'])]);
  const after = calendar([event(['UID:alarm@example.test', 'SUMMARY:Reminder', 'DTSTART:20261020T140000Z', 'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'END:VALARM'])]);
  const report = compareIcs(before, after);
  assert.equal(report.summary.changed, 1);
  assert.deepEqual(report.events[0].changes.map(change => change.property), ['VALARM']);
});

test('warns about suspicious recurrence IDs reused across unrelated UIDs', () => {
  const recurrenceIds = ['20260101T140000Z', '20260108T140000Z'];
  const corruptedEvents = Array.from({ length: 12 }, (_, index) => recurrenceIds.map(recurrenceId => event([
    `UID:event-${index}@example.test`,
    `RECURRENCE-ID:${recurrenceId}`,
    `SUMMARY:Event ${index}`,
    `DTSTART:202610${String(index + 1).padStart(2, '0')}T140000Z`,
  ]))).flat();
  const normal = calendar([event(['UID:event-0@example.test', 'SUMMARY:Event 0', 'DTSTART:20261001T140000Z'])]);
  const report = compareIcs(calendar(corruptedEvents), normal);
  assert.equal(report.diagnostics.fileA.eventCount, 24);
  assert.equal(report.diagnostics.fileA.uniqueUids, 12);
  assert.equal(report.diagnostics.fileA.uniqueRecurrenceIds, 2);
  assert.equal(report.diagnostics.fileA.maxUidsSharingRecurrenceId, 12);
  assert.equal(report.diagnostics.fileA.warnings.length, 3);
});

test('provides a UID-only probable-match analysis when recurrence identities differ', () => {
  const before = calendar([
    event(['UID:shared@example.test', 'RECURRENCE-ID:20261001T140000Z', 'SUMMARY:Same title', 'DTSTART:20261020T140000Z']),
    event(['UID:only-a@example.test', 'SUMMARY:Only A', 'DTSTART:20261021T140000Z']),
  ]);
  const after = calendar([
    event(['UID:shared@example.test', 'SUMMARY:Same title', 'DTSTART:20261020T140000Z']),
    event(['UID:only-b@example.test', 'SUMMARY:Only B', 'DTSTART:20261022T140000Z']),
  ]);
  const probable = compareIcs(before, after).probableMatches;
  assert.equal(probable.sharedUids, 1);
  assert.equal(probable.sharedUidsWithMatchingTitle, 1);
  assert.equal(probable.onlyInA, 1);
  assert.equal(probable.onlyInB, 1);
  assert.equal(probable.details[0].eventCountA, 1);
  assert.equal(probable.details[0].eventCountB, 1);
});
