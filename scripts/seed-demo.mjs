// Seed the Supabase contacts store with demo data for demo@ntwrk.test.
// Usage: NODE_USE_ENV_PROXY=1 node scripts/seed-demo.mjs
// Idempotent: upserts on (owner_email, email). All people and companies are fictional.
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim();
const supabase = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

const OWNER = 'demo@ntwrk.test';
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

const { error } = await supabase.from('contacts').upsert(rows, { onConflict: 'owner_email,email' });
if (error) {
  // Older databases predate the Phase A/B columns; seed what fits instead of dying.
  const stripped = rows.map(({ met_at: _m, snoozed_until: _s, introduced_by: _i, ...rest }) => rest);
  const { error: retryError } = await supabase.from('contacts').upsert(stripped, { onConflict: 'owner_email,email' });
  if (retryError) throw new Error(retryError.message);
  console.warn('Contact columns met_at/snoozed_until/introduced_by missing; seeded without them.');
}
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
