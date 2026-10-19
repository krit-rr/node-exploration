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
      snippet: 'Hi — great talking earlier. Sharing the notes and next steps we discussed…',
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
    addContact({
      email, name: person,
      company: enriched ? c.company : null,
      industry: enriched ? c.industry : null,
      maxRecencyDays: i === 0 ? 6 : [20, 45, 90, 200][Math.floor(rand() * 4)],
      touches: 2 + Math.floor(rand() * 10),
      extras: i === 0 ? { tags: ['key-contact'], notes: `Met at the ${c.company} partner dinner.` } : {},
    });
  });
}
for (const p of PERSONAL) addContact({ ...p, maxRecencyDays: 120, touches: 1 + Math.floor(rand() * 4) });
for (const n of NOISE) addContact({ ...n, maxRecencyDays: 10, touches: 1 });
// One contact with a custom field for the custom-column demo
rows[0].custom_fields = [{ id: 'custom_where_we_met', label: 'Where we met', value: 'SF Climate Summit' }];

const { error } = await supabase.from('contacts').upsert(rows, { onConflict: 'owner_email,email' });
if (error) throw new Error(error.message);
console.log(`Seeded ${rows.length} demo contacts for ${OWNER}`);
