# Raid Log Coach

Paste a Warcraft Logs report and find out what killed you, whether you could have avoided it, and why your DPS is behind similar players.

## Setup

1. Create a Warcraft Logs API client at https://www.warcraftlogs.com/api/clients (any redirect URL works for now).
2. `npm install`
3. `specific dev`. You'll be prompted for `wcl_client_id` and `wcl_client_secret`, which are stored in `specific.local` (gitignored).

## Useful commands

- `npm test`: unit tests (vitest)
- `npm run typecheck`
- `specific exec web -- npm run spike -- <report link>`: prints the boss pulls and deaths for a report. This is the Phase 0 API check.

## Layout

```
apps/web        Next.js site (UI + API routes)
packages/wcl    Warcraft Logs v2 GraphQL client, queries, report-link parsing
specific.hcl    Infrastructure (specific.dev)
```

Coming later: `apps/worker`, `packages/analysis`, `packages/encounters`, Postgres and Redis.
