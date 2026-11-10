// Seed the Supabase contacts store with demo data for demo@node.test.
// Usage: NODE_USE_ENV_PROXY=1 node scripts/seed-demo.mjs
// Idempotent: upserts on (owner_email, email). All people and companies are fictional.
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim();
const supabase = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

const OWNER = 'demo@node.test';
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const iso = (daysAgo) => new Date(now - daysAgo * DAY).toISOString();
const isoIn = (daysAhead) => new Date(now + daysAhead * DAY).toISOString();

// The event cluster: enough met-at overlap for the event chip and triage demo.
const EVENT = 'Foundry Demo Night';

// Deterministic pseudo-random so reseeding produces the same dataset
let seed = 42;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

const COMPANIES = [
  { domain: 'lumenworks.io',     company: 'Lumenworks',        industry: 'Software',           people: ['Ava Chen','Marcus Webb','Priya Nair','Tom Okafor','Elena Ruiz'] },
  { domain: 'northbeam.co',      company: 'Northbeam',         industry: 'Analytics',          people: ['Jordan Lee','Sofia Marino','Dev Patel'] },
  { domain: 'hartleycapital.com',company: 'Hartley Capital',   industry: 'Venture Capital',    people: ['Claire Hartley','Sam Oduya','Mia Tanaka','Lucas Berg'] },
  { domain: 'ospreyhealth.com',  company: 'Osprey Health',     industry: 'Healthcare',         people: ['Dr. Nina Kole','Raj Iyer','Hannah Faulkner'] },
  { domain: 'kitefield.ai',      company: 'Kitefield',         industry: 'Machine Learning',   people: ['Omar Haddad','Lily Zhang','Peter Novak','Grace Mbeki'] },
  { domain: 'bluefinlabs.dev',   company: 'Bluefin Labs',      industry: 'Developer Tools',    people: ['Felix Brandt','Yuki Mori'] },
  { domain: 'stonebridge.legal', company: 'Stonebridge Legal', industry: 'Legal Services',     people: ['Adaeze Obi','Mark Sullivan'] },
];
const PERSONAL = ['alex.rivera','jamie.fox','taylor.kim','morgan.yee','casey.lund'].map(n => ({
  email: `${n}@gmail.com`, name: n.split('.').map(w => w[0].toUpperCase()+w.slice(1)).join(' '),
}));
const NOISE = [
  { email: 'newsletter@dailybrew.news',    name: 'Daily Brew' },
  { email: 'no-reply@notifications.flighthub.travel', name: 'FlightHub' },
  { email: 'marketing@shopmail.store',     name: 'ShopMail Offers' },
  { email: 'updates@webinar-invites.events', name: 'Webinar Invites' },
  { email: 'noreply@billing.cloudstack.host', name: 'CloudStack Billing' },
];
const SUBJECTS = ['Quick intro','Following up from the event','Q3 planning sync','Deck feedback','Coffee next week?','Intro: you two should meet','Contract draft','Pilot kickoff','Notes from our call','Happy new year!'];

const rows = [];
function addContact({ email, name, company = null, industry = null, maxRecencyDays, touches, extras = {} }) {
  const interactions = [];
  const last = Math.floor(rand() * maxRecencyDays) + 1;
  let cursor = last;
  for (let i = 0; i < touches; i++) {
    interactions.push({
      date: iso(cursor),
      channel: 'email',
      type: 'sent',
      subject: SUBJECTS[Math.floor(rand() * SUBJECTS.length)],
      snippet: 'Hi, great talking earlier. Sharing the notes and next steps we discussed…',
    });
    cursor += Math.floor(rand() * 40) + 3;
    if (cursor > 360) break;
  }
  rows.push({
    owner_email: OWNER,
    email,
    name,
    company,
    industry,
    last_contacted: iso(last),
    interactions,
    custom_fields: extras.customFields ?? [],
    tags: extras.tags ?? [],
    notes: extras.notes ?? '',
    met_at: extras.metAt ?? null,
    snoozed_until: extras.snoozedUntil ?? null,
    introduced_by: extras.introducedBy ?? null,
    source: 'csv_import',
    enriched_by: company ? 'ai' : null,
    updated_at: new Date().toISOString(),
  });
}

for (const c of COMPANIES) {
  c.people.forEach((person, i) => {
    const email = person.toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/ +/g, '.') + '@' + c.domain;
    // Some companies left blank so the enrichment flow has work to do
    const enriched = !['bluefinlabs.dev', 'stonebridge.legal'].includes(c.domain);
    const extras = {};
    if (i === 0) {
      extras.tags = ['key-contact'];
      extras.notes = `Met at the ${c.company} partner dinner.`;
    }
    // Investors tag feeds the seeded "Investors" saved view
    if (c.domain === 'hartleycapital.com' && i < 2) {
      extras.tags = [...(extras.tags ?? []), 'investor'];
    }
    // Event cluster: the whole Kitefield and Bluefin crowd met at one event
    if (c.domain === 'kitefield.ai' || c.domain === 'bluefinlabs.dev') {
      extras.metAt = EVENT;
    }
    // Intro tracking examples for the Intros lens
    if (c.domain === 'kitefield.ai' && (i === 1 || i === 2)) extras.introducedBy = 'Omar Haddad';
    if (c.domain === 'hartleycapital.com' && i === 2) extras.introducedBy = 'Claire Hartley';
    // Snooze examples: one active (hidden from the queue), one just expired
    if (c.domain === 'stonebridge.legal' && i === 1) extras.snoozedUntil = isoIn(10);
    if (c.domain === 'ospreyhealth.com' && i === 2) extras.snoozedUntil = iso(3);
    addContact({
      email, name: person,
      company: enriched ? c.company : null,
      industry: enriched ? c.industry : null,
      maxRecencyDays: i === 0 ? 6 : [20, 45, 90, 200][Math.floor(rand() * 4)],
      touches: 2 + Math.floor(rand() * 10),
      extras,
    });
  });
}
for (const p of PERSONAL) addContact({ ...p, maxRecencyDays: 120, touches: 1 + Math.floor(rand() * 4) });
for (const n of NOISE) addContact({ ...n, maxRecencyDays: 10, touches: 1 });
// Duplicate pair: Ava Chen also writes from a personal address, so the
// duplicate-merge review has something to find out of the box.
addContact({
  email: 'avachen.sf@gmail.com', name: 'Ava Chen',
  maxRecencyDays: 150, touches: 2,
  extras: { notes: 'Personal address; uses this one outside work hours.' },
});
// One contact with a custom field for the custom-column demo
rows[0].custom_fields = [{ id: 'custom_where_we_met', label: 'Where we met', value: 'SF Climate Summit' }];

// Memory: what the model would read out of the mail for two contacts, so
// the rail's "You promised" line and the detail's memory section show
// without an OpenAI call. Real accounts read theirs on demand.
const memorySeed = {
  'ava.chen@lumenworks.io': {
    summary: 'Partner contact at Lumenworks; you are piloting their product and reviewing a deck together.',
    openLoops: [
      { text: 'send the revised deck', who: 'you', date: iso(9).slice(0, 10) },
      { text: 'confirm the pilot start date', who: 'them', date: iso(23).slice(0, 10) },
    ],
    sourceHash: 'seed',
    updatedAt: new Date().toISOString(),
  },
  'claire.hartley@hartleycapital.com': {
    summary: 'Investor at Hartley Capital; term sheet and diligence discussions, most recently on the diligence notes.',
    openLoops: [{ text: 'share the updated financial model', who: 'you', date: iso(14).slice(0, 10) }],
    sourceHash: 'seed',
    updatedAt: new Date().toISOString(),
  },
};
for (const [email, memory] of Object.entries(memorySeed)) {
  const row = rows.find(r => r.email === email);
  if (row) row.memory = memory;
}

// Orbit intents: two people the demo user has deliberately placed, so the
// map shows a hollow "where you want them" marker out of the box.
for (const [email, layer] of [['jordan.lee@northbeam.co', 2], ['felix.brandt@bluefinlabs.dev', 1]]) {
  const row = rows.find(r => r.email === email);
  if (row) row.intended_layer = layer;
}

// Columns added by later migrations, newest first. A database that is a
// migration or more behind rejects the unknown column; drop the newest
// optional columns one at a time until the upsert fits, and say what was left out.
const OPTIONAL_COLUMNS = ['memory', 'intended_layer', 'met_at', 'snoozed_until', 'introduced_by'];
let error = null;
for (let drop = 0; drop <= OPTIONAL_COLUMNS.length; drop++) {
  const dropped = new Set(OPTIONAL_COLUMNS.slice(0, drop));
  const payload = drop === 0
    ? rows
    : rows.map(r => Object.fromEntries(Object.entries(r).filter(([key]) => !dropped.has(key))));
  ({ error } = await supabase.from('contacts').upsert(payload, { onConflict: 'owner_email,email' }));
  if (!error) {
    if (drop > 0) console.warn(`Contact columns missing (${[...dropped].join(', ')}); seeded without them.`);
    break;
  }
}
if (error) throw new Error(error.message);
console.log(`Seeded ${rows.length} demo contacts for ${OWNER}`);

// A group and two saved views so the organization features demo out of the box.
const emailFor = (person, domain) => person.toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/ +/g, '.') + '@' + domain;
const groupSeed = [{
  owner_email: OWNER,
  id: 'seed-founder-dinner',
  name: 'Founder dinner crew',
  members: [emailFor('Ava Chen', 'lumenworks.io'), emailFor('Jordan Lee', 'northbeam.co'), emailFor('Omar Haddad', 'kitefield.ai')],
  updated_at: new Date().toISOString(),
}];
const { error: groupError } = await supabase.from('groups').upsert(groupSeed, { onConflict: 'owner_email,id' });
if (groupError) console.warn(`Groups not seeded (${groupError.message})`);
else console.log('Seeded 1 demo group');

const viewSeed = [
  { owner_email: OWNER, id: 'seed-view-investors', name: 'Investors', config: { filter: 'tag-investor' }, updated_at: new Date().toISOString() },
  { owner_email: OWNER, id: 'seed-view-cold-keys', name: 'Cold key contacts', config: { filter: 'tag-key-contact', sortKey: 'lastContacted', sortDirection: 'asc' }, updated_at: new Date().toISOString() },
];
const { error: viewError } = await supabase.from('views').upsert(viewSeed, { onConflict: 'owner_email,id' });
if (viewError) console.warn(`Views not seeded (${viewError.message})`);
else console.log('Seeded 2 demo views');
