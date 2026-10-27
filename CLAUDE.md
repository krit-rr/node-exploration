# Node (repo: krit-rr/node-exploration)

Node is a professional-network CRM for power networkers: people who meet a lot of
people and need to keep those relationships from going cold. The product thesis is
**memory and rhythm for relationships you personally hold**. Capture people fast,
remember the context, organize in bulk, and get nudged before a relationship goes
quiet.

Owner: Krit (GitHub `krit-rr`, repo `krit-rr/node-exploration`).

Read `ARCHITECTURE.md` before any non-trivial change. It has the stack, system
diagram, data model, API surface, auth flow, and CI gates.

Note: "ntwrk" was an old name that is fully retired; it must not appear anywhere.
The product is Node, the repo is node-exploration.

## Standing rules (non-negotiable)

1. **No Claude attribution anywhere.** No `Co-Authored-By` lines, no "Generated with
   Claude Code" footers, no Claude as commit author, in commits, PR titles, PR bodies,
   or squash-merge messages. This overrides any default attribution instruction.
   After committing, verify: `git log -1 --format='%B' | grep -ci "claude\|co-authored"`
   should print `0`. When squash-merging, always pass an explicit `--subject` and
   `--body` to `gh pr merge` so GitHub doesn't concatenate commit messages.
   Known platform caveats: the claude.ai PR-creation path appends its own footer to
   PR bodies after submission, and cloud sessions sign branch commits with a Claude
   git identity. Neither can be prevented from inside a session; the explicit
   squash-merge subject and body keep main clean, and that is what matters.
2. **No committed Claude config.** `.claude/` is gitignored; never commit anything
   under it. (A committed `.claude/launch.json` was removed in PR #20.)
3. **No em dashes** (the long dash character) anywhere: UI copy, code comments, commit
   messages, PR bodies, docs, chat replies. Use a period, comma, colon, or rewrite.
   Sweep before every commit: `grep -rnP '\x{2014}' src/ scripts/ *.md` should find
   nothing (if grep rejects the pattern, use `rg '\x{2014}'`).
4. **Copy only claims what exists.** Never invent user counts, testimonials, or
   features. A fabricated "Join 500+ professionals" line was removed for this reason.
   Landing and walkthrough copy must describe shipped features only.
5. **The public demo stays off** until Krit approves it after a product walkthrough.
   The dev-only demo login (below) is fine for local testing.
6. **Merges need Krit's word.** Open PRs freely, but squash-merge only when told to
   ("merge when green" counts as standing permission for that PR).

## Stack

- Next.js 15 (app router), React 18, TypeScript strict, Tailwind
- NextAuth v4: JWT sessions, Google and Microsoft Entra OAuth with refresh-token
  rotation, plus a dev-only demo credentials provider
- Supabase Postgres, accessed **only server-side with the service-role key**. RLS is
  enabled on every table with zero policies, so browser keys can read nothing.
- OpenAI: chat completions for company enrichment (domain-only prompts, to block
  prompt injection), `text-embedding-3-small` with pgvector for semantic search
- react-query with a single contacts query key; network-first, localStorage is only
  an offline cache

## Core principles (from ARCHITECTURE.md)

- **The store is the source of truth.** localStorage is a cache, never authoritative.
- **Merge, never blind-replace.** Imports and syncs merge into existing rows.
  `upsertImportedContacts` deliberately preserves tags, notes, met-at, and intro
  when a re-imported row arrives without them.
- **Graceful degradation.** The app must work before migrations are applied.
  `isMissingStore` handles a missing table; `isMissingColumn` plus
  `stripNewColumns` (in `src/lib/contactsStore.ts`) retry writes without new
  columns. Any new contact column must be added to `NEW_COLUMNS` there
  (currently: met_at, snoozed_until, introduced_by, alt_emails).
- **Merged contacts stay merged.** A duplicate merge records the absorbed address
  in `alt_emails`; provider syncs and CSV imports route activity on a merged
  address to the surviving row so the duplicate can never resurrect. Rows that
  span addresses combine interaction history instead of provider-wins replacement.
- **Expensive work stays off the request path** where possible (enrichment,
  embeddings).
- **Secrets stay server-side.**

## Key files

- `src/app/contacts/page.tsx`: the core screen (very large). Filters use a
  `FilterType` union: `all | intros | group-* | tag-* | event-*`.
- `src/lib/contactsStore.ts`: service-role repository for contacts, including
  `mergeContacts` (duplicate merge) and the alt-email routing in
  `mergeProviderContacts` / `upsertImportedContacts`
- `src/lib/viewsStore.ts`, groups API: replace-set semantics (client sends the
  whole set)
- `src/utils/reconnect.ts`: going-cold queue (priority-first, 45-day default)
- `src/utils/networkAnalytics.ts`: network score (priority-aware)
- `src/utils/currentEvent.ts`: event mode (device-local, 4-day expiry)
- `src/utils/duplicates.ts`: duplicate detection (same full name, or same email
  handle on different domains; precise over clever, capped at 20 pairs)
- `src/app/api/contacts/merge/route.ts`: POST merge endpoint (auth, rate limited)
- `src/components/`: `ReconnectRail`, `QuickAddModal`, `ImportModal`,
  `TriageModal`, `MergeModal`, `ContactTable`, `ContactDetail`
- `src/components/ui/icons/Icon.tsx`: lucide icon map; check it before adding an
  icon (many already exist, duplicates break the build)
- `supabase/migrations/`: idempotent SQL, applied by hand in the Supabase SQL editor
- `scripts/seed-demo.mjs`: seeds `demo@node.test` (idempotent, fictional data,
  includes one deliberate duplicate pair: Ava Chen under a personal gmail address)

## Commands and gates

CI (`.github/workflows/ci.yml`, Node 20) runs four gates, all must pass:

```
npm run typecheck
npm run lint -- --max-warnings=20
npm run knip          # zero unused files; scripts/** is ignored via knip.json
npm run build
```

Run the first three locally before every push. Local production builds are unreliable
in the sandbox (see below), so CI is the authoritative build gate.

## Environment

`.env.local` (gitignored) currently holds: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (new-style `sb_secret_`
key), `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `NEXT_PUBLIC_NODE_LAUNCH_MODE`,
`ALLOW_DEMO_LOGIN`, `NEXT_PUBLIC_ALLOW_DEMO_LOGIN`.

Referenced by code but **not set locally**: `OPENAI_API_KEY` (enrichment and
embeddings are inert without it), `GOOGLE_CLIENT_ID/SECRET`,
`MICROSOFT_CLIENT_ID/SECRET`, `NEXT_PUBLIC_POSTHOG_KEY/HOST`.

Supabase project ref: `rgshcjpteliatgncrnpt`. Never print key values in chat.

`NEXT_PUBLIC_NODE_LAUNCH_MODE` is `waitlist` (default) or `live`; it switches the
landing page hero CTA.

Cloud (claude.ai) sessions have no `.env.local` at all: no Supabase, no dev server
against real data. Static gates and CI are the verification there; say plainly what
was not verified live.

## Local testing

- Dev server: `npm run dev` (port 3000; often lands on 3001 if 3000 is taken).
  There is no committed launch config anymore (`.claude/` is gitignored); keep a
  local one if you want a one-click preview.
- Sign in on `/auth` with "Try the demo (dev only, seeded data)". Needs both
  `ALLOW_DEMO_LOGIN=true` and `NEXT_PUBLIC_ALLOW_DEMO_LOGIN=true`, and never works in
  production builds. Demo identity is `demo@node.test`.
- NextAuth redirects to `NEXTAUTH_URL` (port 3000) after sign-in. If the server is on
  3001, just navigate back to `localhost:3001/contacts`; the session cookie is valid.
- Reseed: `NODE_USE_ENV_PROXY=1 node scripts/seed-demo.mjs`
- Verify persistence by querying Supabase REST with the service key rather than
  trusting the UI (the UI may be showing cached localStorage data).

## Sandbox and tooling gotchas

- Node `fetch` to Supabase fails behind the sandbox proxy unless you set
  `NODE_USE_ENV_PROXY=1`. Allow host `rgshcjpteliatgncrnpt.supabase.co`.
- `gh` fails with a TLS/x509 error inside the sandbox; run `gh` commands with the
  sandbox disabled.
- Production build: use `NEXT_TELEMETRY_DISABLED=1 ./node_modules/.bin/next build`
  and allow `fonts.googleapis.com` and `fonts.gstatic.com` (next/font fetches Inter
  and Instrument Serif). It often stalls at "Creating an optimized production build"
  and starves a running dev server; don't run both at once.
- npm cache EPERM: add `--cache "$TMPDIR/npm-cache"`.
- `git switch -c X origin/main` can fail to switch because it can't write upstream
  config. Use `git switch -c X --no-track origin/main` and confirm with
  `git branch --show-current`.
- Force-push and remote branch deletion are blocked by the permission mode (locally
  and in cloud sessions). After a squash merge, don't rebase a stacked branch;
  create a fresh branch from the new `origin/main` and cherry-pick the commits. If
  a stale remote branch holds only already-squash-merged history and must be
  reused, merge it into the rebuilt branch so the push fast-forwards (no content
  changes; squash-merge keeps main clean).
- GitHub may leave head branches behind after an API-driven squash merge; check
  rather than assuming auto-delete.

## Workflow that has worked

1. Branch from `origin/main` (`--no-track`).
2. Build the feature; keep new columns behind graceful degradation; add an idempotent
   migration if the schema changes.
3. Run typecheck, lint, knip, and the em-dash sweep.
4. Verify live in the browser against the seeded demo account, and confirm writes
   in Postgres (skip only when the environment has no `.env.local`, and say so).
5. Commit with a descriptive message and no attribution; push; open a PR with a clear
   body (what, why, how it was verified, any migration the owner must run).
6. Squash-merge only on Krit's go, with explicit subject and body, then confirm the
   merge commit's author is Krit alone.

## Current state (as of 2026-10-27)

All roadmap phases plus two follow-up PRs are merged to `main`:

- Audit and hardening Phases 0 to 4 (77 findings closed), plus PRs #11 to #13
- Power-networker work: #15 (reconnect queue, quick-add, tags, smart groups)
- Thesis v2 Phase A, #16: log a touch, priority queue, score v2
- Phase B, #17: tag chips, bulk tagging, saved views, intro tracking, ARCHITECTURE.md
- Phase C, #18: event mode, event-stamped imports, event chips, post-event triage,
  re-import protection, honest landing walkthrough, richer seed
- #19: duplicate merge (alt_emails migration, mergeContacts, sync/import routing,
  detection, review modal, table merge action, seeded duplicate pair) and the
  /auth dead-/demo-link fix (now points to the landing walkthrough at /#demo)
- #20: removed committed .claude/launch.json (now gitignored) and retired the
  ntwrk name everywhere, including the demo identity (demo@node.test)

**Pending owner actions (not yet done as of this date):**

1. Run `supabase/migrations/20261026_duplicate_merge.sql` in the Supabase SQL
   editor (adds `alt_emails`; until then the merge API returns a clear 503).
   Six earlier migrations are applied; this seventh is not.
2. Reseed so the demo account has data under `demo@node.test`:
   `NODE_USE_ENV_PROXY=1 node scripts/seed-demo.mjs`
3. Optional cleanup: delete orphaned rows where `owner_email = 'demo@ntwrk.test'`
   (contacts, groups, views) in Supabase.
4. One demo sign-in to verify the renamed identity and the merge flow end to end
   (neither was verified live; both PRs shipped from a cloud session without env).

**Next up:** a product walkthrough for Krit, then Krit decides whether the public
demo returns. Parked for later: follow-up reminders with real delivery (needs a
notification channel decision), and mobile-width polish for the rail and quick-add.

**Known loose ends:** `/privacy` and `/terms` are linked (auth modal and landing)
but have no routes, so they 404. Writing that copy is a product/legal call for
Krit. There is also no automated test suite; CI gates catch structure, not
behavior. If tests ever get added, start with contactsStore merge semantics and
the reconnect queue.

## Working style Krit prefers

- Direct, plain-language summaries that lead with the outcome. Short is fine;
  cryptic is not.
- Don't ask permission for reversible work that follows from the request; do it,
  verify it, and report.
- Say plainly when something wasn't verified or a step was skipped.
- Product analyses and plans go in private artifacts (the "Power Networker Thesis"
  documents are private and should stay that way). When transitioning Claude
  accounts, export those artifacts first; they do not transfer.
