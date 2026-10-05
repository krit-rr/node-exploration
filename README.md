# ntwrk

A modern professional network management platform that helps you organize and maintain your relationships effectively.

## Features

### 🔄 Automatic Contact Import
Connect your email and instantly import your professional network. Works with Gmail, with Outlook support coming soon.

### 👥 Smart Groups
Automatically organize your contacts based on:
- Organizations and domains
- Interaction frequency
- Communication patterns
- Custom groupings

### 🔎 Semantic Search (vector database)
Contacts and recent email subjects/snippets are embedded (OpenAI
`text-embedding-3-small`) and stored in Supabase Postgres with the pgvector
extension. This powers:
- **Semantic contact search** — when the literal text filter on the contacts
  page finds nothing, the search falls back to meaning-based matching
  (`GET /api/search?q=...`)
- **Interaction memory** — search what you last discussed with someone
  (`GET /api/search?q=...&scope=interactions&contact=a@b.com`)
- **Similar contacts** — nearest neighbors of any contact, with no model call
  (`GET /api/contacts/similar?email=a@b.com`)

Setup: run `supabase/migrations/20261005_vector_search.sql` in your Supabase
SQL editor, and set `SUPABASE_SERVICE_ROLE_KEY` (see below). Embeddings sync
automatically (`POST /api/embeddings/sync`) whenever the contacts page loads
fresh data; only changed contacts are re-embedded.


## Getting Started

### Prerequisites
- Node.js (v18.0.0 or higher)
- npm (v9.0.0 or higher)

### Installation

1. Clone the repository
```bash
git clone https://github.com/yourusername/ntwrk.git
cd ntwrk
```

2. Install dependencies
```bash
npm install
```

3. Create a `.env.local` file in the root directory:
```env
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-key
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# AI enrichment + semantic search
OPENAI_API_KEY=your-openai-key
# OPENAI_EMBED_MODEL=text-embedding-3-small   # optional; must be a text-embedding-3 model

# Supabase (waitlist + vector search)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
# Server-only: bypasses RLS, never expose to the browser
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.


