import test from 'node:test';
import assert from 'node:assert/strict';
import { collectContacts, contactsToCsv, contactToVcard, parseContactCsv, vcardsBlob } from '../src/contacts.js';

test('finds nested contacts and normalizes common export fields', () => {
  const source = {
    folder: {
      contacts: [{
        display_name: 'Ada Lovelace',
        first_name: 'Ada',
        last_name: 'Lovelace',
        company_name: 'Analytical Engines',
        job_title: 'Mathematician',
        email_addresses: [{ address: 'ada@example.com' }, { address: 'ada@work.example' }],
        mobile_phone: '+1 555 0100',
        business_address: { street: '123 Computing Way', city: 'Chicago', state: 'IL', postal_code: '60601', country: 'USA' },
      }],
    },
  };
  const contacts = collectContacts(source);
  assert.equal(contacts.length, 1);
  assert.deepEqual(contacts[0].emails, ['ada@example.com', 'ada@work.example']);
  assert.equal(contacts[0].address.city, 'Chicago');
  assert.match(contactToVcard(contacts[0]), /FN:Ada Lovelace/);
  assert.match(contactToVcard(contacts[0]), /EMAIL;TYPE=INTERNET,PREF:ada@example.com/);
  assert.match(contactToVcard(contacts[0]), /ORG:Analytical Engines/);
});

test('preserves quoted CSV values and phone strings', () => {
  const rows = parseContactCsv('first_name,last_name,phone,notes\r\nSam,Lee,"001-555-0199","Friend, vendor"');
  assert.equal(rows[0].phone, '001-555-0199');
  assert.equal(rows[0].notes, 'Friend, vendor');
  const contacts = collectContacts(rows);
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].phones[0], '001-555-0199');
});

test('recognizes common Google and Outlook CSV column names', () => {
  const rows = parseContactCsv([
    'Given Name,Family Name,E-mail 1 - Value,E-mail 2 Address,Phone 1 - Value,Business Phone,Organization Name,Organization Title,Business City,Business Postal Code',
    'Grace,Hopper,grace@example.com,grace@work.example,+1 555 0100,+1 555 0101,Navy,Rear Admiral,Arlington,22201',
  ].join('\r\n'));
  const [contact] = collectContacts(rows);
  assert.deepEqual(contact.emails, ['grace@example.com', 'grace@work.example']);
  assert.deepEqual(contact.phones, ['+1 555 0100', '+1 555 0101']);
  assert.equal(contact.organization, 'Navy');
  assert.equal(contact.jobTitle, 'Rear Admiral');
  assert.equal(contact.address.city, 'Arlington');
});

test('creates a multi-contact VCF 3.0 address book', async () => {
  const contacts = collectContacts([
    { first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' },
    { name: 'Grace Hopper', phone: '+1 555 0110' },
  ]);
  const output = await vcardsBlob(contacts).text();
  assert.equal((output.match(/BEGIN:VCARD/g) || []).length, 2);
  assert.equal((output.match(/VERSION:3.0/g) || []).length, 2);
  assert.match(output, /N:Lovelace;Ada;;;/);
  assert.match(output, /FN:Grace Hopper/);
});

test('creates a normalized import-ready CSV', () => {
  const contacts = collectContacts([{ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', email_2: 'ada@work.example', phone: '001-555-0100', phone_2: '001-555-0101', company: 'Example, Inc.', address: '123 Main St', city: 'Chicago', state: 'IL', postal_code: '60601' }]);
  const output = contactsToCsv(contacts);
  assert.match(output, /^first_name,last_name,display_name,/);
  assert.match(output, /Ada,Lovelace,Ada Lovelace,"Example, Inc\."/);
  const [roundTripped] = collectContacts(parseContactCsv(output));
  assert.deepEqual(roundTripped.emails, ['ada@example.com', 'ada@work.example']);
  assert.deepEqual(roundTripped.phones, ['001-555-0100', '001-555-0101']);
  assert.equal(roundTripped.address.city, 'Chicago');
  assert.equal(roundTripped.address.postalCode, '60601');
});
