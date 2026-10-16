const DISPLAY_NAME_KEYS = ['display_name', 'displayName', 'full_name', 'fullName', 'formatted_name', 'formattedName', 'fn', 'name'];
const GIVEN_NAME_KEYS = ['first_name', 'firstName', 'given_name', 'givenName', 'given'];
const FAMILY_NAME_KEYS = ['last_name', 'lastName', 'family_name', 'familyName', 'surname', 'family'];
const MIDDLE_NAME_KEYS = ['middle_name', 'middleName', 'additional_name', 'additionalName'];
const PREFIX_KEYS = ['name_prefix', 'namePrefix', 'prefix', 'honorific_prefix'];
const SUFFIX_KEYS = ['name_suffix', 'nameSuffix', 'suffix', 'honorific_suffix'];
const EMAIL_KEYS = ['email', 'email_2', 'email_2_address', 'secondary_email', 'emails', 'email_address', 'emailAddress', 'email_addresses', 'emailAddresses', 'email_1_value', 'email_2_value', 'email_3_value', 'mail', 'primary_email', 'primaryEmail', 'work_email', 'home_email'];
const PHONE_KEYS = ['phone', 'phone_2', 'secondary_phone', 'phones', 'phone_number', 'phoneNumber', 'phone_numbers', 'phoneNumbers', 'phone_1_value', 'phone_2_value', 'phone_3_value', 'telephone', 'tel', 'mobile', 'mobile_phone', 'mobilePhone', 'business_phone', 'business_phones', 'businessPhones', 'home_phone', 'home_phones', 'homePhones'];
const ORGANIZATION_KEYS = ['organization', 'organization_name', 'organisation', 'org', 'company', 'company_name', 'companyName'];
const JOB_TITLE_KEYS = ['job_title', 'jobTitle', 'organization_title', 'position', 'occupation', 'role'];
const ADDRESS_KEYS = ['address', 'addresses', 'postal_address', 'postalAddress', 'business_address', 'businessAddress', 'business_street', 'home_address', 'homeAddress', 'home_street', 'address_1_formatted', 'address_1_street'];
const BIRTHDAY_KEYS = ['birthday', 'birth_date', 'birthDate', 'date_of_birth', 'dateOfBirth', 'bday'];
const URL_KEYS = ['url', 'urls', 'website', 'websites', 'web_page', 'webPage', 'homepage'];
const NOTE_KEYS = ['notes', 'note', 'description', 'comments', 'body'];
const ID_KEYS = ['uid', 'id', 'contact_id', 'contactId', 'uuid'];

const canonicalKey = value => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');

function firstValue(object, keys) {
  if (!object || typeof object !== 'object') return undefined;
  const wanted = new Set(keys.map(canonicalKey));
  for (const [key, value] of Object.entries(object)) {
    if (wanted.has(canonicalKey(key)) && value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function matchingValues(object, keys) {
  if (!object || typeof object !== 'object') return [];
  const wanted = new Set(keys.map(canonicalKey));
  return Object.entries(object).filter(([key]) => wanted.has(canonicalKey(key))).map(([, value]) => value);
}

function textValue(value, nestedKeys = ['value', 'text', 'name', 'label', 'address', 'number']) {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (!value || typeof value !== 'object') return '';
  return textValue(firstValue(value, nestedKeys), nestedKeys);
}

function valuesFrom(value, nestedKeys) {
  const values = [];
  const visit = item => {
    if (Array.isArray(item)) return item.forEach(visit);
    const text = textValue(item, nestedKeys);
    if (text) values.push(text);
  };
  visit(value);
  return [...new Set(values)];
}

function addressValue(value, source) {
  const item = Array.isArray(value) ? value[0] : value;
  const object = item && typeof item === 'object' ? item : {};
  const street = textValue(firstValue(object, ['street', 'street_address', 'streetAddress', 'address_line', 'addressLine', 'line1'])) || (typeof item === 'string' ? item : '') || textValue(firstValue(source, ['street', 'street_address', 'streetAddress']));
  const extended = textValue(firstValue(object, ['extended', 'line2', 'address_line_2', 'addressLine2'])) || textValue(firstValue(source, ['address_line_2', 'addressLine2']));
  const city = textValue(firstValue(object, ['city', 'locality', 'town'])) || textValue(firstValue(source, ['city', 'locality', 'town', 'business_city', 'home_city', 'address_1_city']));
  const region = textValue(firstValue(object, ['state', 'region', 'province'])) || textValue(firstValue(source, ['state', 'region', 'province', 'business_state', 'home_state', 'address_1_region']));
  const postalCode = textValue(firstValue(object, ['postal_code', 'postalCode', 'postcode', 'zip', 'zip_code', 'zipCode'])) || textValue(firstValue(source, ['postal_code', 'postalCode', 'postcode', 'zip', 'zip_code', 'zipCode', 'business_postal_code', 'home_postal_code', 'address_1_postal_code']));
  const country = textValue(firstValue(object, ['country', 'country_name', 'countryName'])) || textValue(firstValue(source, ['country', 'country_name', 'countryName', 'business_country', 'business_country_region', 'home_country', 'address_1_country']));
  const formatted = textValue(firstValue(object, ['formatted', 'formatted_address', 'formattedAddress', 'value', 'text'])) || [street, extended, city, region, postalCode, country].filter(Boolean).join(', ');
  return { street: [street, extended].filter(Boolean).join('\n'), city, region, postalCode, country, formatted };
}

function normalizeBirthday(value) {
  const text = textValue(value, ['date', 'value', 'text']);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}${match[2]}${match[3]}` : text.replace(/-/g, '');
}

export function normalizeContact(source) {
  const givenName = textValue(firstValue(source, GIVEN_NAME_KEYS));
  const familyName = textValue(firstValue(source, FAMILY_NAME_KEYS));
  const middleName = textValue(firstValue(source, MIDDLE_NAME_KEYS));
  const prefix = textValue(firstValue(source, PREFIX_KEYS));
  const suffix = textValue(firstValue(source, SUFFIX_KEYS));
  const displayName = textValue(firstValue(source, DISPLAY_NAME_KEYS)) || [prefix, givenName, middleName, familyName, suffix].filter(Boolean).join(' ');
  const emails = valuesFrom(matchingValues(source, EMAIL_KEYS), ['address', 'email', 'mail', 'value', 'text']);
  const phones = valuesFrom(matchingValues(source, PHONE_KEYS), ['number', 'phone', 'telephone', 'value', 'text']);
  const organization = textValue(firstValue(source, ORGANIZATION_KEYS));
  const jobTitle = textValue(firstValue(source, JOB_TITLE_KEYS));
  const address = addressValue(firstValue(source, ADDRESS_KEYS), source);
  const birthday = normalizeBirthday(firstValue(source, BIRTHDAY_KEYS));
  const urls = valuesFrom(firstValue(source, URL_KEYS), ['url', 'uri', 'href', 'value', 'text']);
  const notes = textValue(firstValue(source, NOTE_KEYS), ['content', 'body', 'text', 'value']);
  const uid = textValue(firstValue(source, ID_KEYS));
  return { displayName, givenName, familyName, middleName, prefix, suffix, emails, phones, organization, jobTitle, address, birthday, urls, notes, uid };
}

function looksLikeContact(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
  const contact = normalizeContact(source);
  if (contact.emails.length || contact.phones.length) return true;
  if (contact.givenName || contact.familyName) return true;
  return Boolean(contact.displayName && (contact.organization || contact.jobTitle || contact.address.formatted || contact.birthday || contact.urls.length));
}

export function collectContacts(root) {
  const contacts = [];
  const visited = new WeakSet();
  function visit(value) {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) return value.forEach(visit);
    if (looksLikeContact(value)) {
      contacts.push(normalizeContact(value));
      return;
    }
    Object.values(value).forEach(visit);
  }
  visit(root);
  return contacts;
}

function escapeVcard(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

export function contactToVcard(contact) {
  const name = contact.displayName || contact.emails[0] || contact.phones[0] || 'Unnamed contact';
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${escapeVcard(name)}`,
    `N:${escapeVcard(contact.familyName)};${escapeVcard(contact.givenName)};${escapeVcard(contact.middleName)};${escapeVcard(contact.prefix)};${escapeVcard(contact.suffix)}`,
    contact.organization ? `ORG:${escapeVcard(contact.organization)}` : '',
    contact.jobTitle ? `TITLE:${escapeVcard(contact.jobTitle)}` : '',
    ...contact.emails.map((email, index) => `EMAIL;TYPE=INTERNET${index ? '' : ',PREF'}:${escapeVcard(email)}`),
    ...contact.phones.map((phone, index) => `TEL;TYPE=${index ? 'VOICE' : 'CELL,PREF'}:${escapeVcard(phone)}`),
    contact.address.formatted ? `ADR;TYPE=WORK:;;${escapeVcard(contact.address.street)};${escapeVcard(contact.address.city)};${escapeVcard(contact.address.region)};${escapeVcard(contact.address.postalCode)};${escapeVcard(contact.address.country)}` : '',
    contact.birthday ? `BDAY:${escapeVcard(contact.birthday)}` : '',
    ...contact.urls.map(url => `URL:${escapeVcard(url)}`),
    contact.notes ? `NOTE:${escapeVcard(contact.notes)}` : '',
    contact.uid ? `UID:${escapeVcard(contact.uid)}` : '',
    'END:VCARD',
  ];
  return lines.filter(Boolean).join('\r\n');
}

export function vcardsBlob(contacts) {
  return new Blob([`${contacts.map(contactToVcard).join('\r\n')}\r\n`], { type: 'text/vcard;charset=utf-8' });
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function contactsToCsv(contacts) {
  const headers = ['first_name', 'last_name', 'display_name', 'organization', 'job_title', 'email', 'email_2', 'phone', 'phone_2', 'address', 'city', 'state', 'postal_code', 'country', 'birthday', 'url', 'notes'];
  const rows = contacts.map(contact => [
    contact.givenName, contact.familyName, contact.displayName, contact.organization, contact.jobTitle,
    contact.emails[0], contact.emails[1], contact.phones[0], contact.phones[1], contact.address.street,
    contact.address.city, contact.address.region, contact.address.postalCode, contact.address.country,
    contact.birthday, contact.urls[0], contact.notes,
  ]);
  return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}

export function parseContactCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index], next = text[index + 1];
    if (character === '"' && quoted && next === '"') { field += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { row.push(field); field = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1;
      row.push(field); if (row.some(value => value !== '')) rows.push(row); row = []; field = '';
    } else field += character;
  }
  row.push(field); if (row.some(value => value !== '')) rows.push(row);
  const headers = rows.shift()?.map(header => header.trim()) || [];
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() || ''])));
}
