const IGNORED_EVENT_PROPERTIES = new Set(['DTSTAMP', 'CREATED', 'LAST-MODIFIED']);

function unfoldIcs(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function splitContentLine(line) {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') quoted = !quoted;
    if (character === ':' && !quoted) return [line.slice(0, index), line.slice(index + 1)];
  }
  return [line, ''];
}

function parseProperty(line) {
  const [head, value] = splitContentLine(line);
  const parts = head.split(';');
  const name = parts.shift().trim().toUpperCase();
  const parameters = parts.map(parameter => {
    const separator = parameter.indexOf('=');
    return separator < 0
      ? [parameter.trim().toUpperCase(), '']
      : [parameter.slice(0, separator).trim().toUpperCase(), parameter.slice(separator + 1).trim()];
  }).sort(([left], [right]) => left.localeCompare(right));
  return { name, parameters, value: value.trim() };
}

function canonicalProperty(property) {
  const parameters = property.parameters.map(([name, value]) => `;${name}=${value}`).join('');
  return `${property.name}${parameters}:${property.value}`;
}

function propertyValues(component, name) {
  return component.properties.filter(property => property.name === name).map(canonicalProperty).sort();
}

function firstPropertyValue(component, name) {
  const property = component.properties.find(item => item.name === name);
  return property?.value || '';
}

function unescapeText(value) {
  return String(value).replace(/\\[nN]/g, ' ').replace(/\\([,;\\])/g, '$1');
}

function parseComponents(text) {
  const components = [];
  const stack = [];
  const warnings = [];

  for (const rawLine of unfoldIcs(text)) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const property = parseProperty(line);
    if (property.name === 'BEGIN') {
      stack.push({ type: property.value.toUpperCase(), properties: [], children: [] });
      continue;
    }
    if (property.name === 'END') {
      const component = stack.pop();
      if (!component || component.type !== property.value.toUpperCase()) {
        warnings.push(`Unbalanced END:${property.value || 'UNKNOWN'} line.`);
        continue;
      }
      if (stack.length) stack[stack.length - 1].children.push(component);
      else components.push(component);
      continue;
    }
    if (stack.length) stack[stack.length - 1].properties.push(property);
  }

  if (stack.length) warnings.push(`${stack.length} calendar component${stack.length === 1 ? '' : 's'} did not have a matching END line.`);
  return { components, warnings };
}

function walkComponents(components, result = []) {
  for (const component of components) {
    result.push(component);
    walkComponents(component.children, result);
  }
  return result;
}

function canonicalComponent(component, ignored = new Set()) {
  const properties = component.properties
    .filter(property => !ignored.has(property.name))
    .map(canonicalProperty)
    .sort();
  const children = component.children.map(child => canonicalComponent(child)).sort();
  return [`BEGIN:${component.type}`, ...properties, ...children, `END:${component.type}`].join('\n');
}

function eventIdentity(event, fallbackIndex) {
  const uid = firstPropertyValue(event, 'UID');
  const recurrence = propertyValues(event, 'RECURRENCE-ID')[0] || '';
  return uid ? `${uid}|${recurrence}` : `__missing_uid_${fallbackIndex}`;
}

function eventLabel(event) {
  return unescapeText(firstPropertyValue(event, 'SUMMARY')) || '(untitled event)';
}

function eventStart(event) {
  return propertyValues(event, 'DTSTART')[0] || '';
}

function indexEvents(events) {
  const groups = new Map();
  events.forEach((event, index) => {
    const key = eventIdentity(event, index);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  });
  return groups;
}

function indexEventsByUid(events) {
  const groups = new Map();
  for (const event of events) {
    const uid = firstPropertyValue(event, 'UID');
    if (!uid) continue;
    if (!groups.has(uid)) groups.set(uid, []);
    groups.get(uid).push(event);
  }
  return groups;
}

function calendarDiagnostics(events) {
  const uidGroups = indexEventsByUid(events);
  const recurrenceEvents = events.filter(event => firstPropertyValue(event, 'RECURRENCE-ID'));
  const masterEvents = events.filter(event => !firstPropertyValue(event, 'RECURRENCE-ID'));
  const recurrenceRules = events.filter(event => firstPropertyValue(event, 'RRULE'));
  const recurrenceUsage = new Map();
  for (const event of recurrenceEvents) {
    const recurrenceId = firstPropertyValue(event, 'RECURRENCE-ID');
    const uid = firstPropertyValue(event, 'UID');
    if (!recurrenceUsage.has(recurrenceId)) recurrenceUsage.set(recurrenceId, new Set());
    if (uid) recurrenceUsage.get(recurrenceId).add(uid);
  }
  const repeatedAcrossUids = [...recurrenceUsage.entries()]
    .map(([recurrenceId, uids]) => ({ recurrenceId, uidCount: uids.size }))
    .filter(item => item.uidCount > 1)
    .sort((left, right) => right.uidCount - left.uidCount);
  const groupsWithoutMaster = [...uidGroups.values()].filter(group => group.every(event => firstPropertyValue(event, 'RECURRENCE-ID'))).length;
  const duplicateEvents = [...uidGroups.values()].reduce((total, group) => total + Math.max(0, group.length - 1), 0);
  const warnings = [];
  if (events.length && recurrenceEvents.length === events.length && masterEvents.length === 0) {
    warnings.push('Every event has a RECURRENCE-ID, but the file has no master event without one. This is unusual and may indicate damaged recurrence data.');
  }
  if (repeatedAcrossUids[0]?.uidCount >= Math.max(10, Math.ceil(uidGroups.size * 0.1))) {
    warnings.push(`The same recurrence ID is reused across as many as ${repeatedAcrossUids[0].uidCount} unrelated UIDs. Exact event matching may overstate differences.`);
  }
  if (uidGroups.size && duplicateEvents >= uidGroups.size) {
    warnings.push(`${events.length} event components collapse to ${uidGroups.size} unique UIDs. Review the UID-only probable matches alongside the exact comparison.`);
  }
  return {
    eventCount: events.length,
    uniqueUids: uidGroups.size,
    missingUid: events.filter(event => !firstPropertyValue(event, 'UID')).length,
    eventsWithRecurrenceId: recurrenceEvents.length,
    uniqueRecurrenceIds: recurrenceUsage.size,
    eventsWithRrule: recurrenceRules.length,
    masterEvents: masterEvents.length,
    uidGroupsWithoutMaster: groupsWithoutMaster,
    duplicateEvents,
    maxUidsSharingRecurrenceId: repeatedAcrossUids[0]?.uidCount || 0,
    warnings,
  };
}

function probableUidMatches(eventsA, eventsB) {
  const groupsA = indexEventsByUid(eventsA);
  const groupsB = indexEventsByUid(eventsB);
  const sharedUids = [...groupsA.keys()].filter(uid => groupsB.has(uid));
  const details = sharedUids.map(uid => {
    const left = groupsA.get(uid);
    const right = groupsB.get(uid);
    const summariesA = [...new Set(left.map(eventLabel))];
    const summariesB = [...new Set(right.map(eventLabel))];
    const matchingTitles = summariesA.filter(summary => summariesB.includes(summary));
    return {
      uid,
      eventCountA: left.length,
      eventCountB: right.length,
      summariesA,
      summariesB,
      startsA: [...new Set(left.map(eventStart))],
      startsB: [...new Set(right.map(eventStart))],
      summaryMatch: matchingTitles.length > 0,
      matchingTitles,
    };
  }).sort((left, right) => Number(right.summaryMatch) - Number(left.summaryMatch) || (left.summariesB[0] || left.summariesA[0] || '').localeCompare(right.summariesB[0] || right.summariesA[0] || ''));
  return {
    uniqueUidsA: groupsA.size,
    uniqueUidsB: groupsB.size,
    sharedUids: sharedUids.length,
    onlyInA: [...groupsA.keys()].filter(uid => !groupsB.has(uid)).length,
    onlyInB: [...groupsB.keys()].filter(uid => !groupsA.has(uid)).length,
    sharedUidsWithMatchingTitle: details.filter(detail => detail.summaryMatch).length,
    details,
  };
}

function propertyMap(event) {
  const map = new Map();
  for (const property of event.properties) {
    if (IGNORED_EVENT_PROPERTIES.has(property.name)) continue;
    if (!map.has(property.name)) map.set(property.name, []);
    map.get(property.name).push(canonicalProperty(property));
  }
  for (const values of map.values()) values.sort();
  return map;
}

function propertyChanges(before, after) {
  const left = propertyMap(before);
  const right = propertyMap(after);
  const names = [...new Set([...left.keys(), ...right.keys()])].sort();
  const changes = names.flatMap(name => {
    const beforeValues = left.get(name) || [];
    const afterValues = right.get(name) || [];
    if (JSON.stringify(beforeValues) === JSON.stringify(afterValues)) return [];
    return [{ property: name, before: beforeValues, after: afterValues }];
  });
  const childTypes = new Set([...before.children.map(child => child.type), ...after.children.map(child => child.type)]);
  for (const type of childTypes) {
    const beforeValues = before.children.filter(child => child.type === type).map(child => canonicalComponent(child)).sort();
    const afterValues = after.children.filter(child => child.type === type).map(child => canonicalComponent(child)).sort();
    if (JSON.stringify(beforeValues) !== JSON.stringify(afterValues)) changes.push({ property: type, before: beforeValues, after: afterValues });
  }
  return changes;
}

function pairEventGroups(leftEvents, rightEvents, identity) {
  const results = [];
  const unmatchedRight = [...rightEvents];
  const unmatchedLeft = [];

  for (const left of leftEvents) {
    const canonical = canonicalComponent(left, IGNORED_EVENT_PROPERTIES);
    const exactIndex = unmatchedRight.findIndex(right => canonicalComponent(right, IGNORED_EVENT_PROPERTIES) === canonical);
    if (exactIndex >= 0) {
      const [right] = unmatchedRight.splice(exactIndex, 1);
      results.push(makeEventResult('unchanged', identity, left, right));
    } else {
      unmatchedLeft.push(left);
    }
  }

  while (unmatchedLeft.length && unmatchedRight.length) {
    results.push(makeEventResult('changed', identity, unmatchedLeft.shift(), unmatchedRight.shift()));
  }
  for (const event of unmatchedLeft) results.push(makeEventResult('removed', identity, event, null));
  for (const event of unmatchedRight) results.push(makeEventResult('added', identity, null, event));
  return results;
}

function makeEventResult(status, identity, before, after) {
  const event = after || before;
  return {
    status,
    identity,
    uid: firstPropertyValue(event, 'UID'),
    recurrenceId: propertyValues(event, 'RECURRENCE-ID')[0] || '',
    summary: eventLabel(event),
    start: eventStart(event),
    beforeSummary: before ? eventLabel(before) : '',
    afterSummary: after ? eventLabel(after) : '',
    beforeStart: before ? eventStart(before) : '',
    afterStart: after ? eventStart(after) : '',
    changes: before && after ? propertyChanges(before, after) : [],
  };
}

function compareNamedComponents(leftComponents, rightComponents, type, idProperty) {
  const left = new Map(leftComponents.filter(component => component.type === type).map((component, index) => [firstPropertyValue(component, idProperty) || `#${index + 1}`, component]));
  const right = new Map(rightComponents.filter(component => component.type === type).map((component, index) => [firstPropertyValue(component, idProperty) || `#${index + 1}`, component]));
  const details = [];
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    if (!left.has(key)) details.push({ id: key, status: 'added' });
    else if (!right.has(key)) details.push({ id: key, status: 'removed' });
    else details.push({ id: key, status: canonicalComponent(left.get(key)) === canonicalComponent(right.get(key)) ? 'unchanged' : 'changed' });
  }
  return {
    totalA: left.size,
    totalB: right.size,
    added: details.filter(item => item.status === 'added').length,
    removed: details.filter(item => item.status === 'removed').length,
    changed: details.filter(item => item.status === 'changed').length,
    unchanged: details.filter(item => item.status === 'unchanged').length,
    details,
  };
}

function countsFor(components) {
  return components.reduce((counts, component) => {
    counts[component.type] = (counts[component.type] || 0) + 1;
    return counts;
  }, {});
}

export function compareIcs(leftText, rightText, names = {}) {
  const parsedA = parseComponents(leftText);
  const parsedB = parseComponents(rightText);
  const allA = walkComponents(parsedA.components);
  const allB = walkComponents(parsedB.components);
  const eventsA = allA.filter(component => component.type === 'VEVENT');
  const eventsB = allB.filter(component => component.type === 'VEVENT');
  if (!eventsA.length && !eventsB.length) throw new Error('Neither file contains a VEVENT calendar event.');

  const groupsA = indexEvents(eventsA);
  const groupsB = indexEvents(eventsB);
  const events = [];
  for (const identity of new Set([...groupsA.keys(), ...groupsB.keys()])) {
    events.push(...pairEventGroups(groupsA.get(identity) || [], groupsB.get(identity) || [], identity));
  }
  const statusOrder = { changed: 0, removed: 1, added: 2, unchanged: 3 };
  events.sort((left, right) => statusOrder[left.status] - statusOrder[right.status] || left.summary.localeCompare(right.summary) || left.start.localeCompare(right.start));

  const summary = {
    totalA: eventsA.length,
    totalB: eventsB.length,
    added: events.filter(event => event.status === 'added').length,
    removed: events.filter(event => event.status === 'removed').length,
    changed: events.filter(event => event.status === 'changed').length,
    unchanged: events.filter(event => event.status === 'unchanged').length,
  };

  return {
    generatedAt: new Date().toISOString(),
    fileA: names.fileA || 'Calendar A',
    fileB: names.fileB || 'Calendar B',
    summary,
    componentCounts: { fileA: countsFor(allA), fileB: countsFor(allB) },
    timezones: compareNamedComponents(allA, allB, 'VTIMEZONE', 'TZID'),
    warnings: { fileA: parsedA.warnings, fileB: parsedB.warnings },
    diagnostics: { fileA: calendarDiagnostics(eventsA), fileB: calendarDiagnostics(eventsB) },
    probableMatches: probableUidMatches(eventsA, eventsB),
    ignoredProperties: [...IGNORED_EVENT_PROPERTIES],
    events,
  };
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function comparisonToCsv(report) {
  const rows = [['record_type', 'status', 'uid', 'recurrence_id', 'summary_before', 'summary_after', 'start_before', 'start_after', 'changed_properties', 'event_count_a', 'event_count_b']];
  for (const event of report.events.filter(item => item.status !== 'unchanged')) {
    rows.push([
      'exact_identity',
      event.status,
      event.uid,
      event.recurrenceId,
      event.beforeSummary,
      event.afterSummary,
      event.beforeStart,
      event.afterStart,
      event.changes.map(change => change.property).join('; '),
      '',
      '',
    ]);
  }
  for (const match of report.probableMatches.details) {
    rows.push([
      'uid_only',
      match.summaryMatch ? 'probable_title_match' : 'probable_uid_match',
      match.uid,
      '',
      match.summariesA.join(' | '),
      match.summariesB.join(' | '),
      match.startsA.join(' | '),
      match.startsB.join(' | '),
      '',
      match.eventCountA,
      match.eventCountB,
    ]);
  }
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
